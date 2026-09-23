/**
 * Stage executor — the 7-call quality loop and the pass/expansion fan-outs
 * (spec "engine" section).
 *
 * Per core stage: three independent drafts in parallel (gen-a ∥ gen-b ∥
 * gen-c) → one merge → per critique round: three critics in parallel → one
 * improver → three judges in parallel → one reconciler. The critique round
 * repeats while the reconciled score sits below the run's threshold, at most
 * `loopCap(depth)` rounds (3 at Extreme); a stage still below threshold at
 * the cap completes with its best-scoring iteration and is flagged. The
 * merger runs once regardless. After the loop, the stage's depth-scaled
 * expansion fan-outs run in definition order (T10).
 *
 * Pass nodes (T10 wiring): the fixed `passCalls` run in definition order
 * with data-dependent counts resolved from recorded artifacts (one
 * resolution call per `CONTRADICTION:` line the pair audits reported);
 * stage 36 re-loops the five weakest stages under the strict 9.5 gate —
 * recorded under `auto-rerun` with `rerun:<stageId>:` prefixes, winners
 * overwriting the weak stages' deliverables — then re-runs the downstream
 * passes under `recheck:` prefixes; language fan-outs (translation,
 * localisation QA, cultural adaptation) run per selected language with
 * translations stored on their source stage. All pass work goes through
 * the same call machinery — threading, validation, persistence, retries.
 *
 * Global call rules enforced here:
 * 2. Context threading — every prompt embeds the complete text of every
 *    artifact persisted before the prompt was built (`store.listRunArtifacts`
 *    in production order). Nothing is ever trimmed; an oversized request
 *    fails loudly through the retry path.
 * 3. Validation — every response must clear the word/assumptions floor,
 *    enforced inside `callWithRetry` (T2), consuming the attempt budget.
 * 4. Persistence — every attempt (prompt + response/error verbatim) is
 *    recorded through the run store (T3) the moment it settles.
 */

import { callWithRetry, RetryExhaustedError, type AttemptRecord, type RetryOptions } from "../../llm/retry";
import type { CompletionRequest, CompletionResult, LLMAdapter } from "../../llm/types";
import { newId, type RunStore } from "../../store/store";
import type { StageArtifactRow } from "../../store/schema";
import { loopCap } from "../graph/depth";
import {
  CRITIC_ROLES,
  GENERATOR_ROLES,
  IMPROVER_ROLE,
  JUDGE_ROLES,
  MERGER_ROLE,
  RECONCILER_ROLE,
} from "../graph/roles";
import {
  STAGE_NODES,
  type LoopStage,
  type PassStage,
  type StageId,
  type StageNode,
} from "../graph/stages";
import type { RunConfig } from "./config";
import { StageFailedError, describeError } from "./errors";
import {
  expansionCallDetail,
  expansionCallCount,
  documentStages,
  localisationCallDetail,
  parseContradictions,
  passCallDetail,
  selectWeakStages,
} from "./expansions";
import { buildSystemPrompt, buildUserPrompt, composePersistedPrompt, extractReconciledScore } from "./prompt";

/** Canonical artifact kind for a stage's deliverable (the winning improved draft). */
export const WINNING_ARTIFACT_KIND = "improved";

/**
 * The auto re-run's strict gate (spec stage 36): re-looped stages must clear
 * 9.5 — above the run's default 9.0 threshold — or exhaust the loop cap.
 */
export const AUTO_RERUN_THRESHOLD = 9.5;

/** Per-round artifact kinds are suffixed so every iteration survives (`improved:r2`). */
function roundKind(kind: string, round: number): string {
  return `${kind}:r${round}`;
}

/** Shared inputs for one node execution. */
export interface StageRunOptions {
  runId: string;
  idea: string;
  config: RunConfig;
  /** Raw transport — the executor applies the retry/validation policy itself. */
  adapter: LLMAdapter;
  store: RunStore;
  /** Test seam: override backoff/sleep; production uses the defaults. */
  retry?: RetryOptions;
}

/** Result of one node execution; failed stages carry the verbatim error. */
export interface StageRunResult {
  status: "done" | "failed";
  /** Critique rounds executed (0 for pass nodes). */
  rounds: number;
  /** Winning reconciled score; null for pass nodes and failures. */
  finalScore: number | null;
  /** True when the stage completed below threshold at the loop cap. */
  flagged: boolean;
  /** Verbatim terminal error when the stage failed. */
  error?: string;
}

interface PhaseCall {
  role: string;
  /** Default artifact kind on the executing stage. */
  kind: string;
  user: string;
  /**
   * Overrides where the result is persisted — translations land on their
   * source stage with a kind-encoded language; QA/adaptation artifacts
   * carry the target language in the language column.
   */
  artifact?: { stageId: string; kind: string; language?: string };
}

interface PhaseContext {
  store: RunStore;
  runId: string;
  stageId: string;
  adapter: LLMAdapter;
  retry: RetryOptions;
  loop: number;
  onResult?: (call: PhaseCall, result: CompletionResult) => void;
}

/** Default artifact recording for a phase: host stage, call kind, "en". */
function defaultOnResult(
  store: RunStore,
  runId: string,
  stageId: string,
): (call: PhaseCall, result: CompletionResult) => void {
  return (call, result) => {
    store.putArtifact({
      runId,
      stageId: call.artifact?.stageId ?? stageId,
      kind: call.artifact?.kind ?? call.kind,
      language: call.artifact?.language ?? "en",
      text: result.text,
      score: null,
    });
  };
}

/**
 * Runs one logical call (with retries + validation) and persists every
 * attempt verbatim — prompt composed once per call, response or error quoted
 * exactly as the transport/validation layer produced it.
 */
async function runCall(
  ctx: Pick<PhaseContext, "store" | "runId" | "stageId" | "adapter" | "retry">,
  role: string,
  loop: number,
  req: CompletionRequest,
): Promise<CompletionResult> {
  const prompt = composePersistedPrompt(req);
  const record = (rec: AttemptRecord, result?: CompletionResult): void => {
    ctx.store.recordCall({
      id: newId(),
      runId: ctx.runId,
      stageId: ctx.stageId,
      role,
      loop,
      attempt: rec.attempt,
      prompt,
      response: rec.ok ? rec.response ?? null : null,
      error: rec.ok ? null : rec.error ?? null,
      // Usage arrives only with the successful result (T2 contract); failed
      // attempts — transport errors and validation misses — carry none.
      inputTokens: rec.ok ? result?.inputTokens ?? null : null,
      outputTokens: rec.ok ? result?.outputTokens ?? null : null,
      ms: rec.ms,
    });
  };

  try {
    const { result, attempts } = await callWithRetry(ctx.adapter, req, ctx.retry);
    attempts.forEach((rec, i) => record(rec, i === attempts.length - 1 ? result : undefined));
    return result;
  } catch (err) {
    if (err instanceof RetryExhaustedError) {
      for (const rec of err.attempts) record(rec);
      throw new StageFailedError(
        ctx.stageId,
        `stage ${ctx.stageId}, call ${role}: ${err.message}`,
        { cause: err },
      );
    }
    throw err;
  }
}

/**
 * Runs a phase's calls in parallel. Every user prompt is built by the caller
 * BEFORE the phase starts (one synchronous artifact snapshot for all
 * siblings — a parallel call never sees a peer's output), then all calls
 * settle: successful results are handed to `onResult` as they land, and the
 * first rejection is rethrown only after every sibling has finished, so no
 * attempt goes unrecorded.
 */
async function runPhase(ctx: PhaseContext, calls: readonly PhaseCall[]): Promise<void> {
  const requests: Array<{ call: PhaseCall; req: CompletionRequest }> = calls.map((call) => ({
    call,
    req: { system: buildSystemPrompt(call.role), user: call.user },
  }));

  const settled = await Promise.allSettled(
    requests.map(({ call, req }) =>
      runCall(ctx, call.role, ctx.loop, req).then((result) => {
        ctx.onResult?.(call, result);
        return result;
      }),
    ),
  );

  const failure = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
  if (failure) {
    const reason: unknown = failure.reason;
    throw reason;
  }
}

/** Runs one non-parallel call (merger, improver, reconciler). */
async function runSingleCall(
  ctx: Omit<PhaseContext, "onResult">,
  call: { role: string; user: string },
): Promise<CompletionResult> {
  return runCall(ctx, call.role, ctx.loop, {
    system: buildSystemPrompt(call.role),
    user: call.user,
  });
}

function failStage(stageId: string, err: unknown, rounds: number): StageFailedError {
  if (err instanceof StageFailedError) {
    err.rounds = rounds;
    return err;
  }
  return new StageFailedError(stageId, `stage ${stageId} failed: ${describeError(err)}`, {
    cause: err,
    rounds,
  });
}

function stageTitleOf(stageId: string): string {
  return STAGE_NODES.find((node) => node.id === (stageId as StageId))?.title ?? stageId;
}

/**
 * Records a quality loop's calls/artifacts under a (possibly prefixed)
 * identity: plain loops record on the stage itself; the auto re-run's
 * re-loops record under `auto-rerun` with `rerun:<stageId>:` prefixes so the
 * original iteration history stays intact.
 */
interface RecordAs {
  stageId: string;
  rolePrefix: string;
  kindPrefix: string;
}

interface QualityLoopOptions extends StageRunOptions {
  node: LoopStage;
  /** Recording identity; default: the node's own stage, unprefixed. */
  recordAs?: RecordAs;
  /** Overrides the run's score gate (the auto re-run's strict gate). */
  thresholdOverride?: number;
  /** Appended to every call prompt as the "# Call detail" section. */
  detail?: string;
  /** Stage whose progress row tracks loop rounds (default: recording stage). */
  progressStageId?: string;
  /**
   * Whether the winner is persisted under kind `improved` on the looped
   * stage and its progress row finalized (default true). The auto re-run
   * writes the winner itself — the weak stage's row plus the audit trail.
   */
  writeWinner?: boolean;
  /** Round bookkeeping for the caller's failure semantics. */
  onRound?: (round: number) => void;
}

interface QualityLoopResult extends StageRunResult {
  winnerText: string;
}

/**
 * The seven-call quality loop itself (spec steps 1–8): drafts, merge, and
 * score-gated critique rounds with best-iteration selection. Reused verbatim
 * by the auto re-run (stage 36) under a prefixed recording identity and the
 * strict gate.
 */
async function runQualityLoop(opts: QualityLoopOptions): Promise<QualityLoopResult> {
  const { runId, node, idea, config, adapter, store } = opts;
  const retry = opts.retry ?? {};
  const threshold = opts.thresholdOverride ?? config.scoreThreshold;
  const recordStageId = opts.recordAs?.stageId ?? node.id;
  const rolePrefix = opts.recordAs?.rolePrefix ?? "";
  const kindPrefix = opts.recordAs?.kindPrefix ?? "";
  const progressStageId = opts.progressStageId ?? recordStageId;

  // Context threading reads the store, not a local cache: artifacts from
  // dependency stages AND every earlier phase of this stage are included.
  const context = (): StageArtifactRow[] => store.listRunArtifacts(runId);
  const build = (role: string): string => buildUserPrompt(node, role, idea, config, context(), opts.detail);
  const ctx = (loop: number): Omit<PhaseContext, "onResult"> => ({
    store,
    runId,
    stageId: recordStageId,
    adapter,
    retry,
    loop,
  });
  const putArtifact = (kind: string, text: string, score?: number): void => {
    store.putArtifact({
      runId,
      stageId: recordStageId,
      kind: `${kindPrefix}${kind}`,
      language: "en",
      text,
      score: score ?? null,
    });
  };
  const recRole = (role: string): string => `${rolePrefix}${role}`;

  let round = 0;
  // Steps 1–2: three independent drafts in parallel, then one merge.
  await runPhase(
    { ...ctx(0), onResult: (call, r) => putArtifact(call.kind, r.text) },
    GENERATOR_ROLES.map((role) => ({ role: recRole(role), kind: role, user: build(recRole(role)) })),
  );
  const merged = await runSingleCall(ctx(0), { role: recRole(MERGER_ROLE), user: build(recRole(MERGER_ROLE)) });
  putArtifact(MERGER_ROLE, merged.text);

  // Steps 3–6, repeated while below threshold, at most `cap` rounds.
  let best: { round: number; score: number; text: string } | undefined;
  let cleared = false;
  while (round < loopCap(config.depth) && !cleared) {
    round += 1;
    opts.onRound?.(round);
    store.updateStageProgress(runId, progressStageId, { loop: round });

    await runPhase(
      { ...ctx(round), onResult: (call, r) => putArtifact(call.kind, r.text) },
      CRITIC_ROLES.map((role) => ({ role: recRole(role), kind: roundKind(role, round), user: build(recRole(role)) })),
    );
    const improved = await runSingleCall(ctx(round), { role: recRole(IMPROVER_ROLE), user: build(recRole(IMPROVER_ROLE)) });
    putArtifact(roundKind("improved", round), improved.text);
    await runPhase(
      { ...ctx(round), onResult: (call, r) => putArtifact(call.kind, r.text) },
      JUDGE_ROLES.map((role) => ({ role: recRole(role), kind: roundKind(role, round), user: build(recRole(role)) })),
    );
    const reconciled = await runSingleCall(ctx(round), { role: recRole(RECONCILER_ROLE), user: build(recRole(RECONCILER_ROLE)) });
    const score = extractReconciledScore(reconciled.text);
    putArtifact(roundKind(RECONCILER_ROLE, round), reconciled.text, score);

    if (!best || score > best.score) best = { round, score, text: improved.text };
    cleared = score >= threshold;
  }
  if (!best) {
    // Unreachable while LOOP_CAPS >= 1; guards the winner write below.
    throw new Error(`stage ${node.id} completed zero critique rounds`);
  }

  // The best-scoring iteration is the deliverable. When the gate cleared,
  // that is the clearing round by construction (earlier rounds sat below
  // the threshold this round just met).
  if (opts.writeWinner ?? true) {
    putArtifact(WINNING_ARTIFACT_KIND, best.text, best.score);
    store.updateStageProgress(runId, progressStageId, { status: "done", loop: round, score: best.score });
  }
  return { status: "done", rounds: round, finalScore: best.score, flagged: !cleared, winnerText: best.text };
}

/**
 * Executes a core stage's full quality loop plus its depth-scaled expansion
 * fan-outs. Resolves with the stage outcome or rejects with
 * `StageFailedError` (after the stage row is marked failed) — the pipeline
 * runner catches that per stage and keeps the rest of the run going.
 */
export async function runLoopStage(opts: StageRunOptions & { node: LoopStage }): Promise<StageRunResult> {
  const { runId, node, idea, config, adapter, store } = opts;
  const retry = opts.retry ?? {};
  const stageId = node.id;

  store.updateStageProgress(runId, stageId, { status: "running", loop: 0 });
  let round = 0;
  try {
    const result = await runQualityLoop({ runId, idea, config, adapter, store, retry, node, onRound: (r) => (round = r) });
    await runLoopExpansions({ runId, idea, config, adapter, store, retry }, node, result.rounds);
    return result;
  } catch (err) {
    store.updateStageProgress(runId, stageId, { status: "failed" });
    throw failStage(stageId, err, round);
  }
}

/** The depth-scaled fan-outs of a core stage, in definition order. */
async function runLoopExpansions(
  base: StageRunOptions,
  node: LoopStage,
  loop: number,
): Promise<void> {
  const { runId, idea, config, adapter, store } = base;
  const retry: RetryOptions = base.retry ?? {};
  const context = (): StageArtifactRow[] => store.listRunArtifacts(runId);
  for (const expansion of node.expansions) {
    if (!("count" in expansion) && !("perDepth" in expansion)) continue;
    const total = expansionCallCount(expansion, config);
    if (total <= 0) continue;
    const calls: PhaseCall[] = [];
    for (let i = 1; i <= total; i++) {
      const role = expansion.role;
      calls.push({
        role,
        kind: total > 1 ? `${role}:${i}` : role,
        user: buildUserPrompt(node, role, idea, config, context(), expansionCallDetail(role, i - 1, total)),
      });
    }
    await runPhase(
      { store, runId, stageId: node.id, adapter, retry, loop, onResult: defaultOnResult(store, runId, node.id) },
      calls,
    );
  }
}

/**
 * Executes a pass node (T10 wiring): fixed `passCalls` in definition order
 * with data-dependent counts resolved from recorded artifacts, the stage-36
 * auto re-run (weak-stage re-loops at the strict gate + downstream
 * rechecks), and language fan-outs — all through the same call machinery as
 * the core loop.
 */
export async function runPassNode(opts: StageRunOptions & { node: PassStage }): Promise<StageRunResult> {
  const { runId, node, idea, config, adapter, store } = opts;
  const retry = opts.retry ?? {};
  const stageId = node.id;
  const base: StageRunOptions = { runId, idea, config, adapter, store, retry };

  store.updateStageProgress(runId, stageId, { status: "running", loop: 0 });
  try {
    await runPassCallGroups(base, node, undefined);
    if (node.rerun) await runAutoRerun(base, node, node.rerun);
    await runPassExpansions(base, node);
    store.updateStageProgress(runId, stageId, { status: "done" });
    return { status: "done", rounds: 0, finalScore: null, flagged: false };
  } catch (err) {
    store.updateStageProgress(runId, stageId, { status: "failed" });
    throw failStage(stageId, err, 0);
  }
}

/**
 * Runs one pass node's passCalls against a recording identity. Data-
 * dependent counts parse the source role's recorded artifacts — for the
 * consistency audit, one resolution call per `CONTRADICTION:` line the pair
 * audits actually reported; for a recheck, the recheck's own pair audits.
 */
async function runPassCallGroups(
  base: StageRunOptions,
  host: PassStage,
  recordAs: RecordAs | undefined,
): Promise<void> {
  const { runId, idea, config, adapter, store } = base;
  const retry: RetryOptions = base.retry ?? {};
  const stageId = recordAs?.stageId ?? host.id;
  const rolePrefix = recordAs?.rolePrefix ?? "";
  const kindPrefix = recordAs?.kindPrefix ?? "";
  const context = (): StageArtifactRow[] => store.listRunArtifacts(runId);

  for (let loop = 0; loop < host.passCalls.length; loop++) {
    const def = host.passCalls[loop];
    if (!def) continue;
    let count = def.count ?? 1;
    let contradictions: string[] | null = null;
    if (def.dataDependent) {
      const sourceKind = `${kindPrefix}${def.countFrom ?? def.role}`;
      contradictions = store
        .listStageArtifacts(runId, stageId)
        .filter((row) => row.kind === sourceKind || row.kind.startsWith(`${sourceKind}:`))
        .flatMap((row) => parseContradictions(row.text));
      count = contradictions.length;
    }
    if (count <= 0) continue;
    const calls: PhaseCall[] = [];
    for (let i = 1; i <= count; i++) {
      const role = `${rolePrefix}${def.role}`;
      const suffixed = count > 1 || def.dataDependent === true;
      const detail =
        def.dataDependent && contradictions
          ? `Resolve contradiction ${i} of ${count} as reported by the pair audits: "${contradictions[i - 1]}".`
          : passCallDetail(def.role, i - 1, count);
      calls.push({
        role,
        kind: `${kindPrefix}${def.role}${suffixed ? `:${i}` : ""}`,
        user: buildUserPrompt(host, role, idea, config, context(), detail),
      });
    }
    await runPhase({ store, runId, stageId, adapter, retry, loop, onResult: defaultOnResult(store, runId, stageId) }, calls);
  }
}

/**
 * Stage 36 — the auto re-run: select the weakest stages from the persisted
 * scores, re-loop each under the strict gate (recorded here, winner
 * overwriting the weak stage's deliverable), then re-run the downstream
 * passes under `recheck:` prefixes.
 */
async function runAutoRerun(base: StageRunOptions, host: PassStage, rerun: { weakStages: number; recheckedPasses: StageId[] }): Promise<void> {
  const { runId, store } = base;
  const weak = selectWeakStages(
    store.listStageStatus(runId).map((row) => ({ stageId: row.stage_id, score: row.score })),
    STAGE_NODES.map((node) => node.id),
    rerun.weakStages,
  );
  store.putArtifact({
    runId,
    stageId: host.id,
    kind: "rerun-selection",
    language: "en",
    score: null,
    text: [
      `Weakest stages selected for re-run under the strict ${AUTO_RERUN_THRESHOLD} gate:`,
      ...weak.map((entry, i) => `${i + 1}. ${stageTitleOf(entry.stageId)} (${entry.stageId}) — reconciled score ${entry.score}`),
    ].join("\n"),
  });

  for (const { stageId: weakId, score: before } of weak) {
    const weakNode: StageNode | undefined = STAGE_NODES.find((node) => node.id === weakId);
    if (!weakNode || weakNode.kind !== "stage") {
      throw new Error(`auto re-run selected non-loop stage ${weakId}`);
    }
    const outcome = await runQualityLoop({
      ...base,
      node: weakNode,
      thresholdOverride: AUTO_RERUN_THRESHOLD,
      recordAs: { stageId: host.id, rolePrefix: `rerun:${weakId}:`, kindPrefix: `rerun:${weakId}:` },
      progressStageId: host.id,
      writeWinner: false,
      detail: `Re-run of stage ${weakNode.number} (${weakNode.title}) under the Auto Re-run pass: execute the whole stage again under the strict ${AUTO_RERUN_THRESHOLD} gate.`,
    });
    const after = outcome.finalScore ?? before;
    store.putArtifact({
      runId,
      stageId: host.id,
      kind: `rerun-outcome:${weakId}`,
      language: "en",
      score: after,
      text: [
        `Re-run outcome for stage ${weakNode.number} — ${weakNode.title}:`,
        `Before: ${before} · After: ${after} · Rounds: ${outcome.rounds} · Gate: ${AUTO_RERUN_THRESHOLD}`,
        outcome.flagged
          ? "The re-run ended at the loop cap below the strict gate; the best-scoring iteration was adopted."
          : "The re-run cleared the strict gate.",
      ].join("\n"),
    });
    // The re-run winner replaces the weak stage's deliverable and score —
    // the dossier and meta-scores read the improved row, so the improvement
    // must land there, with the audit trail kept on this stage.
    store.putArtifact({
      runId,
      stageId: weakId,
      kind: WINNING_ARTIFACT_KIND,
      language: "en",
      text: outcome.winnerText,
      score: after,
    });
    store.putArtifact({
      runId,
      stageId: host.id,
      kind: `rerun:${weakId}:${WINNING_ARTIFACT_KIND}`,
      language: "en",
      text: outcome.winnerText,
      score: after,
    });
    store.updateStageProgress(runId, weakId, { score: after });
  }

  for (const passId of rerun.recheckedPasses) {
    const passNode: StageNode | undefined = STAGE_NODES.find((node) => node.id === passId);
    if (!passNode || passNode.kind !== "pass") {
      throw new Error(`auto re-run recheck target ${passId} is not a pass stage`);
    }
    await runPassCallGroups(base, passNode, {
      stageId: host.id,
      rolePrefix: `recheck:${passId}:`,
      kindPrefix: `recheck:${passId}:`,
    });
  }
}

/**
 * Pass-stage language fan-outs (stage 37): one translation per improved
 * document × language (stored on the source stage per the store convention),
 * then localisation QA and cultural adaptation per language.
 */
async function runPassExpansions(base: StageRunOptions, host: PassStage): Promise<void> {
  const { runId, idea, config, adapter, store } = base;
  const retry: RetryOptions = base.retry ?? {};
  const stageId = host.id;
  const context = (): StageArtifactRow[] => store.listRunArtifacts(runId);

  for (let loop = 0; loop < host.expansions.length; loop++) {
    const expansion = host.expansions[loop];
    if ("perLanguageDocuments" in expansion) {
      const docs = documentStages();
      for (const language of config.languages) {
        const calls: PhaseCall[] = docs.map((doc) => ({
          role: expansion.role,
          kind: `translation:${language}:${doc.id}`,
          user: buildUserPrompt(host, expansion.role, idea, config, context(), localisationCallDetail(expansion.role, language, doc.id)),
          artifact: { stageId: doc.id, kind: `translation:${language}`, language: "en" },
        }));
        await runPhase(
          { store, runId, stageId, adapter, retry, loop, onResult: defaultOnResult(store, runId, stageId) },
          calls,
        );
      }
    } else if ("perLanguage" in expansion) {
      const calls: PhaseCall[] = config.languages.map((language) => ({
        role: expansion.role,
        kind: `${expansion.role}:${language}`,
        user: buildUserPrompt(host, expansion.role, idea, config, context(), localisationCallDetail(expansion.role, language, undefined)),
        artifact: { stageId, kind: `${expansion.role}:${language}`, language },
      }));
      await runPhase(
        { store, runId, stageId, adapter, retry, loop, onResult: defaultOnResult(store, runId, stageId) },
        calls,
      );
    }
  }
}
