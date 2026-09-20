/**
 * Test-only support for orchestrator suites. Not imported by production code.
 *
 * Why a node subset instead of the full 39-stage graph: every stage prompt
 * threads all prior artifacts verbatim, and the validated fixture body is
 * ~2,100 words (~25 KB). Measured on this repo (2026-09-20 probe): after the
 * first two waves (8 nodes) a run had made 96 calls with a 3.9 MB max prompt,
 * 165 MB of cumulative prompt bytes and ~670 MB RSS; a full standard-depth
 * run exceeds container memory and is OOM-killed. `PipelineRunOptions.nodes`
 * is the executor's documented seam for exactly this, so the orchestrator
 * exposes the same passthrough and the tests drive a deterministic two-wave
 * slice with the full production validation, persistence, and loop machinery.
 */

import type { CompletionRequest, CompletionResult, LLMAdapter } from "../llm/types";
import { STAGE_NODES, type StageNode } from "../pipeline/graph/stages";

/** Deterministic slice: all wave-1 stages, then every wave-2 stage whose deps are all wave-1. */
export const ORCHESTRATION_TEST_NODES: StageNode[] = (() => {
  const wave1 = STAGE_NODES.filter((node) => node.wave === 1);
  const wave1Ids = new Set(wave1.map((node) => node.id));
  const wave2 = STAGE_NODES.filter(
    (node) => node.wave === 2 && node.deps.every((dep) => wave1Ids.has(dep)),
  );
  return [...wave1, ...wave2];
})();

export interface GatedAdapter extends LLMAdapter {
  /** Highest number of calls observed in flight at once. */
  readonly maxObserved: number;
  /** Opens the gate for all waiting and future calls. */
  release: () => void;
}

/**
 * Wraps an adapter so its `complete` calls block at a gate until `want` calls
 * are concurrently in flight, then releases them. Proves the scheduler
 * actually launched `want` concurrent provider calls: with a serial
 * scheduler the gate never opens and the timeout fires.
 */
export function gateConcurrency(inner: LLMAdapter, want: number, timeoutMs = 10_000): GatedAdapter {
  let inFlight = 0;
  let maxObserved = 0;
  let released = false;
  let openGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });

  return {
    model: inner.model,
    get maxObserved(): number {
      return maxObserved;
    },
    release: (): void => {
      released = true;
      openGate();
    },
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      inFlight += 1;
      maxObserved = Math.max(maxObserved, inFlight);
      try {
        if (!released) {
          if (inFlight >= want) {
            released = true;
            openGate();
          } else {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error(`gateConcurrency: only ${inFlight} call(s) in flight, wanted ${want}`)),
                timeoutMs,
              );
              gate.then(() => {
                clearTimeout(timer);
                resolve();
              });
            });
          }
        }
      } finally {
        inFlight -= 1;
      }
      return inner.complete(req);
    },
  };
}
