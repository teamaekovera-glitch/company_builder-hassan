/**
 * Stage executor — the 7-call quality loop (spec "engine" section).
 *
 * Per core stage: three independent drafts in parallel (gen-a ∥ gen-b ∥
 * gen-c) → one merge → per critique round: three critics in parallel → one
 * improver → three judges in parallel → one reconciler. The critique round
 * repeats while the reconciled score sits below the run's threshold, at most
 * `loopCap(depth)` rounds (3 at Extreme); a stage still below threshold at
 * the cap completes with its best-scoring iteration and is flagged. The
 * merger runs once regardless.
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
 *
 * Pass nodes run their fixed `passCalls` with the same threading and
 * persistence; data-dependent fan-out counts (audit resolutions, the auto
 * re-run's weak-stage list, localisation volumes) are wired by the T7
 * orchestrator and treated as zero here. Expansion fan-outs (the depth-
 * scaled per-stage call lists) are likewise orchestrated above these
 * primitives — this module owns the quality loop and the failure semantics.
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
import type { LoopStage, PassStage } from "../graph/stages";
import type { RunConfig } from "./config";
import { StageFailedError, describeError } from "./errors";
import { buildSystemPrompt, buildUserPrompt, composePersistedPrompt, extractReconciledScore } from "./prompt";

/** Canonical artifact kind for a stage's deliverable (the winning improved draft). */
export const WINNING_ARTIFACT_KIND = "improved";

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
  /** Artifact kind the call's result is stored under. */
  kind: string;
  user: string;
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

/**
 * Executes a core stage's full quality loop against the store. Resolves with
 * the stage outcome or rejects with `StageFailedError` (after the stage row
 * is marked failed) — the pipeline runner catches that per stage and keeps
 * the rest of the run going.
 */
export async function runLoopStage(opts: StageRunOptions & { node: LoopStage }): Promise<StageRunResult> {
  const { runId, node, idea, config, adapter, store } = opts;
  const retry = opts.retry ?? {};
  const stageId = node.id;
  const cap = loopCap(config.depth);

  // Context threading reads the store, not a local cache: artifacts from
  // dependency stages AND every earlier phase of this stage are included.
  const context = (): StageArtifactRow[] => store.listRunArtifacts(runId);
  const build = (role: string): string => buildUserPrompt(node, role, idea, config, context());
  const ctx = (loop: number): Omit<PhaseContext, "onResult"> => ({
    store,
    runId,
    stageId,
    adapter,
    retry,
    loop,
  });
  const putArtifact = (kind: string, text: string, score?: number): void => {
    store.putArtifact({ runId, stageId, kind, language: "en", text, score: score ?? null });
  };

  store.updateStageProgress(runId, stageId, { status: "running", loop: 0 });
  let round = 0;
  try {
    // Steps 1–2: three independent drafts in parallel, then one merge.
    await runPhase(
      { ...ctx(0), onResult: (call, r) => putArtifact(call.kind, r.text) },
      GENERATOR_ROLES.map((role) => ({ role, kind: role, user: build(role) })),
    );
    const merged = await runSingleCall(ctx(0), { role: MERGER_ROLE, user: build(MERGER_ROLE) });
    putArtifact(MERGER_ROLE, merged.text);

    // Steps 3–6, repeated while below threshold, at most `cap` rounds.
    let best: { round: number; score: number; text: string } | undefined;
    let cleared = false;
    while (round < cap && !cleared) {
      round += 1;
      store.updateStageProgress(runId, stageId, { loop: round });

      await runPhase(
        { ...ctx(round), onResult: (call, r) => putArtifact(call.kind, r.text) },
        CRITIC_ROLES.map((role) => ({ role, kind: roundKind(role, round), user: build(role) })),
      );
      const improved = await runSingleCall(ctx(round), { role: IMPROVER_ROLE, user: build(IMPROVER_ROLE) });
      putArtifact(roundKind("improved", round), improved.text);
      await runPhase(
        { ...ctx(round), onResult: (call, r) => putArtifact(call.kind, r.text) },
        JUDGE_ROLES.map((role) => ({ role, kind: roundKind(role, round), user: build(role) })),
      );
      const reconciled = await runSingleCall(ctx(round), { role: RECONCILER_ROLE, user: build(RECONCILER_ROLE) });
      const score = extractReconciledScore(reconciled.text);
      putArtifact(roundKind(RECONCILER_ROLE, round), reconciled.text, score);

      if (!best || score > best.score) best = { round, score, text: improved.text };
      cleared = score >= config.scoreThreshold;
    }
    if (!best) {
      // Unreachable while LOOP_CAPS >= 1; guards the winner write below.
      throw new Error(`stage ${stageId} completed zero critique rounds (cap ${cap})`);
    }

    // The best-scoring iteration is the deliverable. When the gate cleared,
    // that is the clearing round by construction (earlier rounds sat below
    // the threshold this round just met).
    putArtifact(WINNING_ARTIFACT_KIND, best.text, best.score);
    store.updateStageProgress(runId, stageId, { status: "done", loop: round, score: best.score });
    return { status: "done", rounds: round, finalScore: best.score, flagged: !cleared };
  } catch (err) {
    store.updateStageProgress(runId, stageId, { status: "failed" });
    throw failStage(stageId, err, round);
  }
}

/**
 * Executes a pass node: its fixed passCalls in definition order, each
 * phase's calls in parallel, same threading/persistence/failure semantics as
 * the loop. Data-dependent counts resolve to zero here (T7 wires them).
 */
export async function runPassNode(opts: StageRunOptions & { node: PassStage }): Promise<StageRunResult> {
  const { runId, node, idea, config, adapter, store } = opts;
  const retry = opts.retry ?? {};
  const stageId = node.id;

  // Pass-call prompts thread the full run context exactly like loop prompts.
  const context = (): StageArtifactRow[] => store.listRunArtifacts(runId);
  const putArtifact = (kind: string, text: string): void => {
    store.putArtifact({ runId, stageId, kind, language: "en", text });
  };

  store.updateStageProgress(runId, stageId, { status: "running", loop: 0 });
  try {
    for (let loop = 0; loop < node.passCalls.length; loop++) {
      const def = node.passCalls[loop];
      if (!def) continue;
      const count = def.dataDependent ? 0 : def.count ?? 1;
      const calls: PhaseCall[] = [];
      for (let i = 1; i <= count; i++) {
        calls.push({
          role: def.role,
          kind: count > 1 ? `${def.role}:${i}` : def.role,
          user: buildUserPrompt(node, def.role, idea, config, context()),
        });
      }
      await runPhase(
        { store, runId, stageId, adapter, retry, loop, onResult: (call, r) => putArtifact(call.kind, r.text) },
        calls,
      );
    }
    store.updateStageProgress(runId, stageId, { status: "done" });
    return { status: "done", rounds: 0, finalScore: null, flagged: false };
  } catch (err) {
    store.updateStageProgress(runId, stageId, { status: "failed" });
    throw failStage(stageId, err, 0);
  }
}
