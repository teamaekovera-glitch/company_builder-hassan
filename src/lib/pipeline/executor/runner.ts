/**
 * Pipeline runner — drives the whole 39-stage DAG offline-first.
 *
 * Scheduling policy (from the merged T4 scheduler): waves execute strictly in
 * order; every node inside an open wave starts as soon as its own
 * dependencies are done; a failed stage marks its transitive dependents
 * blocked while everything else continues. The runner applies exactly those
 * primitives (`readyNodes`, `applyBlocking`) to real executions: stages run
 * concurrently, each failure is contained to its own stage, and the run
 * completes `completed` only when every stage finished done.
 *
 * Persistence contract: the caller creates the run row (T7 Run API owns run
 * creation and pre-flight confirmation); the runner flips it to `running`
 * and then to `completed`/`failed` at the end. SSE broadcasting is likewise
 * layered on top by T7 — the store is written before anything is broadcast,
 * by construction of the executor.
 */

import type { LLMAdapter } from "../../llm/types";
import type { RunStore } from "../../store/store";
import type { RetryOptions } from "../../llm/retry";
import { STAGE_NODES, type StageId, type StageNode } from "../graph/stages";
import { applyBlocking, createRunState, readyNodes, type RunState } from "../graph/schedule";
import type { RunConfig } from "./config";
import { StageFailedError } from "./errors";
import { runLoopStage, runPassNode, type StageRunResult } from "./stage";

export interface PipelineRunOptions {
  runId: string;
  idea: string;
  config: RunConfig;
  adapter: LLMAdapter;
  store: RunStore;
  retry?: RetryOptions;
  /**
   * Node subset to execute; defaults to the complete 39-stage graph. The
   * orchestrator (T7) never passes this — it exists so tests can exercise
   * scheduling and failure containment on a small DAG without simulating
   * hundreds of full-context calls.
   */
  nodes?: readonly StageNode[];
}

export interface PipelineRunResult {
  status: "completed" | "failed";
  /** Final in-memory state of every stage. */
  states: RunState;
  /** Outcomes for every stage that actually ran (failed stages carry `error`). */
  outcomes: Map<StageId, StageRunResult>;
}

/**
 * Executes every stage of the DAG. Never throws for stage failures — stage
 * failures are results (the run continues elsewhere); only a scheduler
 * invariant break throws.
 */
export async function runPipeline(opts: PipelineRunOptions): Promise<PipelineRunResult> {
  const { runId, idea, config, adapter, store } = opts;
  const retry = opts.retry ?? {};
  const nodes = opts.nodes ?? STAGE_NODES;
  store.setRunStatus(runId, "running");

  let state = createRunState(nodes);
  const nodeById = new Map<StageId, StageNode>(nodes.map((node) => [node.id, node]));
  const outcomes = new Map<StageId, StageRunResult>();
  const running = new Map<StageId, Promise<void>>();

  const launch = (id: StageId): void => {
    const node = nodeById.get(id);
    if (!node) throw new Error(`runPipeline: launched node ${id} is not in the node set`);
    state[id] = "running";
    const task =
      node.kind === "stage"
        ? runLoopStage({ runId, node, idea, config, adapter, store, retry })
        : runPassNode({ runId, node, idea, config, adapter, store, retry });
    // The tracked promise settles only after the state/outcome bookkeeping
    // has run, so the scheduler loop below never observes a stale map.
    const settled = task
      .then((result) => {
        state[id] = "done";
        outcomes.set(id, result);
      })
      .catch((err: unknown) => {
        // A stage failure never escapes the runner: record it, let
        // applyBlocking cascade to dependents, keep everything else going.
        state[id] = "failed";
        const rounds = err instanceof StageFailedError ? err.rounds ?? 0 : 0;
        const message = err instanceof Error ? err.message : String(err);
        outcomes.set(id, { status: "failed", rounds, finalScore: null, flagged: false, error: message });
      });
    running.set(id, settled);
    void settled.finally(() => {
      running.delete(id);
    });
  };

  // Every stage launches at most once, so this loop is bounded; the guard
  // turns a scheduling-invariant break into a loud error instead of a hang.
  for (let guard = 0; guard <= nodes.length * 2 + 2; guard++) {
    for (const id of readyNodes(state, nodes)) launch(id);
    if (running.size === 0) break;
    await Promise.race(running.values());
  }
  if (running.size > 0) {
    throw new Error("runPipeline: scheduler failed to converge — stages left running");
  }

  state = applyBlocking(state, nodes);
  const completed = nodes.every((node) => state[node.id] === "done");
  store.setRunStatus(runId, completed ? "completed" : "failed");
  return { status: completed ? "completed" : "failed", states: state, outcomes };
}
