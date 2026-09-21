/** Live-run reducer — event accounting, blocked derivation, projections. */

import { describe, expect, it } from "vitest";
import type { OrchestratorEvent } from "@/lib/orchestrator/events";
import { applyRunEvent, initialLiveState, runMetrics, snapshotToState, stageCards } from "./live-model";

const RUN_ID = "r-test1234";
let seq = 0;
function base(): { seq: number; ts: number; runId: string } {
  seq += 1;
  return { seq, ts: 1_000 + seq, runId: RUN_ID };
}

const runEvent = (status: "queued" | "running" | "completed" | "failed" | "interrupted"): OrchestratorEvent => ({
  kind: "run",
  ...base(),
  status,
});

const stageEvent = (
  stageId: string,
  status: "pending" | "running" | "done" | "failed" | "blocked",
  loop = 0,
  score: number | null = null,
): OrchestratorEvent => ({
  kind: "stage",
  ...base(),
  stageId,
  status,
  loop,
  score,
});

const callEvent = (
  stageId: string,
  opts: Partial<{
    ok: boolean;
    inputTokens: number | null;
    outputTokens: number | null;
    ms: number | null;
    error: string | null;
    role: string;
    loop: number;
    attempt: number;
  }> = {},
): OrchestratorEvent => ({
  kind: "call",
  ...base(),
  stageId,
  role: opts.role ?? "researcher",
  loop: opts.loop ?? 0,
  attempt: opts.attempt ?? 1,
  ok: opts.ok ?? true,
  inputTokens: opts.inputTokens ?? null,
  outputTokens: opts.outputTokens ?? null,
  ms: opts.ms ?? null,
  error: opts.error ?? null,
});

describe("applyRunEvent", () => {
  it("counts every call attempt (failed included) toward calls", () => {
    let state = initialLiveState();
    state = applyRunEvent(state, callEvent("market-research"));
    state = applyRunEvent(state, callEvent("market-research", { ok: false, error: "boom" }));
    state = applyRunEvent(state, callEvent("market-research", { inputTokens: null, outputTokens: null }));
    const stage = state.stages.get("market-research");
    expect(stage?.calls).toBe(3);
    expect(state.totals.calls).toBe(3);
  });

  it("accumulates tokens and ms only for attempts that reported usage", () => {
    let state = initialLiveState();
    state = applyRunEvent(state, callEvent("s1", { inputTokens: 100, outputTokens: 200, ms: 500 }));
    state = applyRunEvent(state, callEvent("s1", { inputTokens: null, outputTokens: null, ms: null }));
    state = applyRunEvent(state, callEvent("s1", { inputTokens: 10, outputTokens: 20, ms: 100 }));
    const stage = state.stages.get("s1");
    expect(stage?.tokens).toBe(330);
    expect(stage?.ms).toBe(600);
    expect(state.totals.tokens).toBe(330);
    expect(state.totals.ms).toBe(600);
    expect(state.totals.inputTokens).toBe(110);
    expect(state.totals.outputTokens).toBe(220);
  });

  it("keeps the verbatim error of the latest failed attempt", () => {
    let state = initialLiveState();
    state = applyRunEvent(state, callEvent("s1", { ok: false, error: "first failure" }));
    state = applyRunEvent(state, callEvent("s1", { ok: true, inputTokens: 5, outputTokens: 5 }));
    state = applyRunEvent(state, callEvent("s1", { ok: false, error: "rate limited: 429" }));
    expect(state.stages.get("s1")?.lastError).toBe("rate limited: 429");
    expect(state.stages.get("s1")?.status).toBe("pending");
  });

  it("overwrites stage rows from stage events (authoritative merged row)", () => {
    let state = initialLiveState();
    state = applyRunEvent(state, stageEvent("s1", "running"));
    state = applyRunEvent(state, stageEvent("s1", "done", 1, 9.4));
    const stage = state.stages.get("s1");
    expect(stage?.status).toBe("done");
    expect(stage?.loop).toBe(1);
    expect(stage?.score).toBe(9.4);
  });

  it("tracks the run lifecycle from run events", () => {
    let state = initialLiveState();
    expect(state.runStatus).toBe("unknown");
    state = applyRunEvent(state, runEvent("queued"));
    state = applyRunEvent(state, runEvent("running"));
    state = applyRunEvent(state, runEvent("completed"));
    expect(state.runStatus).toBe("completed");
  });

  it("does not mutate the input state", () => {
    const before = initialLiveState();
    const after = applyRunEvent(before, callEvent("s1", { inputTokens: 10, outputTokens: 10 }));
    expect(before.stages.size).toBe(0);
    expect(before.totals.calls).toBe(0);
    expect(after.stages.size).toBe(1);
  });
});

describe("runMetrics", () => {
  it("derives header figures, cost, and tokens/sec from totals", () => {
    let state = initialLiveState();
    state = applyRunEvent(state, runEvent("running"));
    state = applyRunEvent(state, callEvent("s1", { inputTokens: 1_000, outputTokens: 500, ms: 1_500 }));
    const metrics = runMetrics(state);
    expect(metrics.status).toBe("running");
    expect(metrics.tokens).toBe(1_500);
    expect(metrics.calls).toBe(1);
    expect(metrics.elapsedMs).toBe(1_500);
    expect(metrics.tokensPerSec).toBe(1_000);
    expect(metrics.costUsd).toBeCloseTo((1_000 * 2.5 + 500 * 10) / 1_000_000, 10);
  });

  it("maps store statuses onto the header vocabulary", () => {
    const metricsFor = (status: "unknown" | "queued" | "running" | "completed" | "failed" | "interrupted") =>
      runMetrics({ ...initialLiveState(), runStatus: status }).status;
    expect(metricsFor("unknown")).toBe("empty");
    expect(metricsFor("queued")).toBe("queued");
    expect(metricsFor("completed")).toBe("done");
    expect(metricsFor("failed")).toBe("failed");
    expect(metricsFor("interrupted")).toBe("failed");
  });

  it("reports zero tokens/sec before any duration is known", () => {
    expect(runMetrics(initialLiveState()).tokensPerSec).toBe(0);
  });
});

describe("snapshotToState", () => {
  it("hydrates stage rows and totals from a snapshot", () => {
    const state = snapshotToState({
      id: RUN_ID,
      idea: "coffee boxes",
      status: "failed",
      createdAt: 1,
      config: { depth: "standard", languages: ["en"], scoreThreshold: 9 },
      estimate: {
        estimatedCalls: 1,
        estimatedTokens: 1,
        estimatedCostUsd: 1,
        estimatedHours: 1,
        loopCap: 1,
        languageCount: 1,
      },
      totals: { calls: 4, inputTokens: 300, outputTokens: 200, tokens: 500, ms: 2_000, costUsd: 0.01 },
      stages: [
        { stage_id: "s1", status: "done", loop: 1, score: 9.1, calls: 4, tokens: 500, run_id: RUN_ID },
        { stage_id: "s2", status: "pending", loop: 0, score: null, calls: 0, tokens: 0, run_id: RUN_ID },
      ],
    });
    expect(state.runStatus).toBe("failed");
    expect(state.totals.tokens).toBe(500);
    expect(state.stages.get("s1")?.calls).toBe(4);
    expect(state.stages.get("s2")?.status).toBe("pending");
  });
});

describe("stageCards", () => {
  it("renders untouched stages as queued with zero figures", () => {
    const waves = stageCards(initialLiveState(), "standard");
    expect(waves).toHaveLength(7);
    for (const wave of waves) {
      for (const card of wave.stages) {
        expect(card.status).toBe("queued");
        expect(card.calls).toBe(0);
        expect(card.errorMessage).toBeUndefined();
        expect(card.blockedBy).toBeUndefined();
      }
    }
  });

  it("renders a failed stage with its verbatim error", () => {
    let state = initialLiveState();
    state = applyRunEvent(state, stageEvent("competitor-analysis", "failed"));
    state = applyRunEvent(state, callEvent("competitor-analysis", { ok: false, error: "connection refused by provider" }));
    const cards = stageCards(state, "standard").flatMap((w) => w.stages);
    const failed = cards.find((c) => c.stageId === "competitor-analysis");
    expect(failed?.status).toBe("failed");
    expect(failed?.errorMessage).toBe("connection refused by provider");
  });

  it("derives blocked dependents with the failed dependency named", () => {
    let state = initialLiveState();
    state = applyRunEvent(state, stageEvent("market-analysis", "failed"));
    const cards = stageCards(state, "standard").flatMap((w) => w.stages);
    const dependent = cards.find((c) => c.blockedBy !== undefined);
    expect(dependent).toBeDefined();
    expect(dependent?.status).toBe("blocked");
    expect(dependent?.blockedBy).toBe("market-analysis");
    const blocker = cards.find((c) => c.stageId === dependent?.blockedBy);
    expect(blocker?.status).toBe("failed");
  });
});
