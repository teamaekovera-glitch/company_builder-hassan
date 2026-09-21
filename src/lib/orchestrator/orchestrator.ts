/**
 * Run orchestration (T7) — the only component that decides what runs next.
 *
 * Lifecycle: the Run API validates config and creates a `queued` run with a
 * pre-flight estimate; the operator's explicit confirmation starts the T6
 * pipeline runner in-process (no queue, no external worker — one Node server
 * runs the pipeline and the browser only watches). Every store mutation the
 * runner makes flows to the SSE hub through `EventedRunStore`, so what is
 * broadcast is exactly what was persisted.
 *
 * Failure semantics (spec): stage failures are contained by the runner and
 * the run continues; a run found `running` at process boot is marked
 * `interrupted` — the operator re-runs; resuming mid-run is a v1 non-goal.
 */

import { createAdapterFromEnv } from "../llm/factory";
import type { CompletionRequest, LLMAdapter } from "../llm/types";
import {
  DEFAULT_RUN_CONFIG,
  DEFAULT_SCORE_THRESHOLD,
  WINNING_ARTIFACT_KIND,
  buildSystemPrompt,
  composePersistedPrompt,
  runPipeline,
  type PipelineRunResult,
  type RunConfig,
} from "../pipeline/executor";
import { DEPTHS, type Depth } from "../pipeline/graph/depth";
import type { StageNode } from "../pipeline/graph/stages";
import { LANGUAGES, type Language } from "../pipeline/graph/plan";
import type { RunRow, RunStatus, RunTotals, StageStatusRow } from "../store/schema";
import { newId, type RunStore } from "../store/store";
import type { PreflightEstimate, StageDetailData } from "../dashboard/types";
import { costFromTokens, estimateRun } from "./estimate";
import { synthesizeReplayEvents, type PublishableEvent } from "./events";
import { buildStageDetail } from "./stage-detail";
import { buildDossierMarkdown, runLogSections as buildRunLogSections } from "./exports";

/** Strategy angles for alternative-company runs (spec RunConfig). */
export const STRATEGY_ANGLES = ["bootstrapped", "vc-scale", "enterprise-first"] as const;
export type StrategyAngle = (typeof STRATEGY_ANGLES)[number];

/** Spec: the stricter re-run raises the gate from 9.0 to 9.5 in a fresh run. */
export const STRICTER_SCORE_THRESHOLD = 9.5;

/** stageId/role under which the 3-alternatives comparison call is recorded. */
export const COMPARISON_STAGE_ID = "alternatives-comparison";
export const COMPARISON_ROLE = "comparison";

/** Result of the single alternatives comparison call. */
export interface ComparisonResult {
  stageId: string;
  /** The comparison response, verbatim. */
  comparison: string;
}

/** Max length of the operator's one-line idea. */
export const MAX_IDEA_LENGTH = 2_000;

/** Validated run request body. */
export interface RunInput {
  idea: string;
  depth: Depth;
  languages: Language[];
  scoreThreshold: number;
  strategyAngle?: StrategyAngle;
}

/** Thrown when the request body fails field validation; names every bad field. */
export class RunValidationError extends Error {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(`invalid run config — check: ${fields.join(", ")}`);
    this.name = "RunValidationError";
    this.fields = fields;
  }
}

/** Thrown when the run does not exist. */
export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`run ${runId} not found`);
    this.name = "RunNotFoundError";
  }
}

/** Thrown when a run cannot be confirmed (not queued, or already executing). */
export class RunNotQueuedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunNotQueuedError";
  }
}

/**
 * Validates and normalizes a raw request body. Absent optional fields take
 * the executor's spec defaults; present-but-invalid values are errors, never
 * silently corrected.
 */
export function validateRunInput(raw: unknown): RunInput {
  const fields: string[] = [];
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  if (idea.length === 0 || idea.length > MAX_IDEA_LENGTH) fields.push("idea");

  let depth: Depth = DEFAULT_RUN_CONFIG.depth;
  if (body.depth !== undefined) {
    if (typeof body.depth !== "string" || !DEPTHS.includes(body.depth as Depth)) fields.push("depth");
    else depth = body.depth as Depth;
  }

  let languages: Language[] = [...DEFAULT_RUN_CONFIG.languages];
  if (body.languages !== undefined) {
    const valid =
      Array.isArray(body.languages) &&
      body.languages.length > 0 &&
      body.languages.every((l) => LANGUAGES.includes(l as Language));
    if (!valid) fields.push("languages");
    else languages = [...new Set(body.languages as Language[])];
  }

  let scoreThreshold = DEFAULT_SCORE_THRESHOLD;
  if (body.scoreThreshold !== undefined) {
    const v = body.scoreThreshold;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 10) fields.push("scoreThreshold");
    else scoreThreshold = v;
  }

  let strategyAngle: StrategyAngle | undefined;
  if (body.strategyAngle !== undefined) {
    if (typeof body.strategyAngle === "string" && (STRATEGY_ANGLES as readonly string[]).includes(body.strategyAngle)) {
      strategyAngle = body.strategyAngle as StrategyAngle;
    } else {
      fields.push("strategyAngle");
    }
  }

  if (fields.length > 0) throw new RunValidationError(fields);
  return { idea, depth, languages, scoreThreshold, ...(strategyAngle ? { strategyAngle } : {}) };
}

/** Full run snapshot served by `GET /api/runs/:id`. */
export interface RunSnapshot {
  id: string;
  idea: string;
  status: RunStatus;
  createdAt: number;
  config: RunConfig;
  /** Recomputed from the stored config — estimates are pure, never persisted. */
  estimate: PreflightEstimate;
  /** Header totals reconciled against the calls table, cost from usage. */
  totals: RunTotals & { costUsd: number };
  stages: StageStatusRow[];
}

export interface OrchestratorOptions {
  store: RunStore;
  /** Builds the transport at confirm time; defaults to the env-configured provider. */
  adapterFactory?: () => LLMAdapter;
  /**
   * Test seam: subset of graph nodes to execute, passed straight to
   * `runPipeline` (which documents the same option for the same reason —
   * exercising scheduling without simulating hundreds of full-context
   * calls). Production callers never set this.
   */
  nodes?: readonly StageNode[];
}

/** Result of creating a run: not yet executing — confirmation is a separate, explicit act. */
export interface CreatedRun {
  runId: string;
  estimate: PreflightEstimate;
  snapshot: RunSnapshot;
}

export class Orchestrator {
  private readonly store: RunStore;
  private readonly adapterFactory: () => LLMAdapter;
  private readonly nodes?: readonly StageNode[];
  /** Runs executing in this process, for double-confirmation guards. */
  private readonly inFlight = new Map<string, Promise<PipelineRunResult>>();

  constructor(options: OrchestratorOptions) {
    this.store = options.store;
    this.adapterFactory = options.adapterFactory ?? (() => createAdapterFromEnv());
    this.nodes = options.nodes;
  }

  /**
   * Validates config, computes the pre-flight estimate, and creates the run
   * row in `queued`. Execution starts only on `confirmRun`.
   */
  createRun(raw: unknown): CreatedRun {
    const input = validateRunInput(raw);
    const config: RunConfig = {
      depth: input.depth,
      languages: input.languages,
      scoreThreshold: input.scoreThreshold,
      ...(input.strategyAngle ? { strategyAngle: input.strategyAngle } : {}),
    };
    const runId = newId();
    // RunConfig is a plain record; the store's config column is schemaless.
    this.store.createRun({ id: runId, idea: input.idea, config: { ...input } as Record<string, unknown> });
    return { runId, estimate: estimateRun(config), snapshot: this.getSnapshot(runId) as RunSnapshot };
  }

  /**
   * Explicit operator confirmation — the gate between "estimated" and
   * "spending money". Starts the pipeline runner in-process and returns its
   * promise; the promise rejects only on a scheduler invariant break (stage
   * failures are contained inside the runner).
   */
  confirmRun(runId: string): Promise<PipelineRunResult> {
    const run = this.requireRun(runId);
    if (this.inFlight.has(runId)) throw new RunNotQueuedError(`run ${runId} is already executing`);
    if (run.status !== "queued") {
      throw new RunNotQueuedError(`run ${runId} is ${run.status} — only queued runs can be confirmed`);
    }
    const config = JSON.parse(run.config_json) as RunConfig;
    const promise = runPipeline({
      runId,
      idea: run.idea,
      config,
      adapter: this.adapterFactory(),
      store: this.store,
      ...(this.nodes ? { nodes: this.nodes } : {}),
    }).finally(() => {
      this.inFlight.delete(runId);
    });
    this.inFlight.set(runId, promise);
    return promise;
  }

  /** Full snapshot or undefined for an unknown id. */
  getSnapshot(runId: string): RunSnapshot | undefined {
    const run = this.store.getRun(runId);
    if (!run) return undefined;
    const config = JSON.parse(run.config_json) as RunConfig;
    const totals = this.store.getRunTotals(runId);
    return {
      id: run.id,
      idea: run.idea,
      status: run.status,
      createdAt: run.created_at,
      config,
      estimate: estimateRun(config),
      totals: { ...totals, costUsd: costFromTokens(totals) },
      stages: this.store.listStageStatus(runId),
    };
  }

  /**
   * Full tab history for one stage over real store rows, or undefined when
   * the run or the stage id is unknown.
   */
  stageDetail(runId: string, stageId: string): StageDetailData | undefined {
    return buildStageDetail(this.store, runId, stageId);
  }

  /**
   * Rerun with a stricter gate (spec global actions): a fresh full pipeline
   * at threshold 9.5 with the source's idea and remaining config. The source
   * run and its artifacts are never touched.
   */
  rerunStricter(sourceRunId: string): CreatedRun {
    const source = this.requireRun(sourceRunId);
    const config = JSON.parse(source.config_json) as RunConfig;
    return this.createRun({
      idea: source.idea,
      depth: config.depth,
      languages: config.languages,
      scoreThreshold: STRICTER_SCORE_THRESHOLD,
      ...(config.strategyAngle ? { strategyAngle: config.strategyAngle } : {}),
    });
  }

  /**
   * 3-alternatives mode (spec global actions): three fresh full pipelines,
   * one per strategy angle, injected into every prompt. Comparison is a
   * separate explicit act once all three complete — see compareAlternatives.
   */
  rerunAlternatives(sourceRunId: string): CreatedRun[] {
    const source = this.requireRun(sourceRunId);
    const config = JSON.parse(source.config_json) as RunConfig;
    return STRATEGY_ANGLES.map((angle) =>
      this.createRun({
        idea: source.idea,
        depth: config.depth,
        languages: config.languages,
        scoreThreshold: config.scoreThreshold,
        strategyAngle: angle,
      }),
    );
  }

  /**
   * The one comparison call of 3-alternatives mode: after every member run
   * completed, a single call across the three dossiers. Recorded verbatim on
   * the source run under the alternatives-comparison stage (additive rows —
   * no run or artifact is overwritten), so it shows up in the run log and
   * the run's stage detail like any other call.
   */
  async compareAlternatives(sourceRunId: string, memberRunIds: readonly string[]): Promise<ComparisonResult> {
    this.requireRun(sourceRunId);
    const notCompleted = memberRunIds
      .map((id) => this.store.getRun(id))
      .filter((run) => !run || run.status !== "completed");
    if (notCompleted.length > 0) {
      const ids = notCompleted.map((run) => run?.id ?? "unknown").join(", ");
      throw new RunNotQueuedError(`alternatives comparison needs every member run completed — not completed: ${ids}`);
    }

    // One section per member: the angle plus every improved artifact it produced.
    const sections = memberRunIds.map((id) => {
      const run = this.store.getRun(id);
      const config = JSON.parse(run?.config_json ?? "{}") as RunConfig;
      const improved = this.store
        .listRunArtifacts(id)
        .filter((row) => row.kind === WINNING_ARTIFACT_KIND)
        .map((row) => `### ${row.stage_id}\n\n${row.text}`)
        .join("\n\n");
      return `# Alternative — ${config.strategyAngle ?? id}\n\n${improved}`;
    });
    const user = [
      "Three alternative companies were generated for the same idea, each under a strategy angle injected into every prompt.",
      "Compare the three dossiers and recommend one direction: positioning, differentiation, riskiest assumption, and first hire.",
      "",
      ...sections,
    ].join("\n");
    const req: CompletionRequest = { system: buildSystemPrompt(COMPARISON_ROLE), user };
    const prompt = composePersistedPrompt(req);

    const adapter = this.adapterFactory();
    const started = Date.now();
    try {
      const result = await adapter.complete(req);
      this.store.recordCall({
        id: newId(),
        runId: sourceRunId,
        stageId: COMPARISON_STAGE_ID,
        role: COMPARISON_ROLE,
        loop: 0,
        attempt: 1,
        prompt,
        response: result.text,
        error: null,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        ms: Date.now() - started,
      });
      this.store.putArtifact({
        runId: sourceRunId,
        stageId: COMPARISON_STAGE_ID,
        kind: COMPARISON_ROLE,
        text: result.text,
      });
      return { stageId: COMPARISON_STAGE_ID, comparison: result.text };
    } catch (err) {
      // The failed comparison attempt is recorded verbatim (spec: nothing
      // fails silently; the run log holds the failure), then rethrown — the
      // operator sees the error and can retry the comparison.
      this.store.recordCall({
        id: newId(),
        runId: sourceRunId,
        stageId: COMPARISON_STAGE_ID,
        role: COMPARISON_ROLE,
        loop: 0,
        attempt: 1,
        prompt,
        response: null,
        error: err instanceof Error ? err.message : String(err),
        inputTokens: null,
        outputTokens: null,
        ms: Date.now() - started,
      });
      throw err;
    }
  }

  /**
   * Rebuilds the run's event history from the persisted store — the cold-hub
   * case after a process restart, when the SSE hub's in-memory replay log is
   * empty but the run's durable state is intact. Empty for an unknown id.
   */
  replayEvents(runId: string): PublishableEvent[] {
    const run = this.store.getRun(runId);
    if (!run) return [];
    return synthesizeReplayEvents(
      runId,
      run.status,
      this.store.listStageStatus(runId),
      this.store.iterateRunCalls(runId),
    );
  }

  /**
   * Boot semantics (spec failure table): any run found `running` at process
   * start is marked `interrupted` — its process died mid-flight; the
   * operator re-runs. Returns the interrupted run ids. Idempotent.
   */
  markInterruptedRuns(): string[] {
    const running = this.store.listRuns().filter((row) => row.status === "running");
    for (const row of running) this.store.setRunStatus(row.id, "interrupted");
    return running.map((row) => row.id);
  }

  listRuns(): RunRow[] {
    return this.store.listRuns();
  }

  /** dossier.md (spec global actions) — pure builder over the store. */
  dossierMarkdown(runId: string): string {
    return buildDossierMarkdown(this.store, this.requireRun(runId));
  }

  /**
   * run-log.md (spec global actions) — verbatim sections, lazily generated.
   * The run row resolves eagerly (RunNotFoundError surfaces before streaming
   * starts); sections materialize one call at a time — late-pipeline prompts
   * thread every upstream artifact and reach megabytes each, so a materialized
   * document can exceed the Node heap (observed: 1.2 GB of call text on a
   * completed mock run).
   */
  runLogSections(runId: string): Generator<string> {
    return buildRunLogSections(this.store, this.requireRun(runId));
  }

  private requireRun(runId: string): RunRow {
    const run = this.store.getRun(runId);
    if (!run) throw new RunNotFoundError(runId);
    return run;
  }
}
