import { describe, expect, it } from "vitest";

import { RunStore } from "../../store/store";
import { loopStageNode, stageNode, type StageNode } from "../graph/stages";
import { createScriptedAdapter } from "./fixtures";
import { runPipeline } from "./runner";
import { runLoopStage } from "./stage";
import { StageFailedError } from "./errors";

const IDEA = "Fault-injection probe run";
const NODE = loopStageNode("market-analysis");
const CONFIG = { depth: "extreme" as const, languages: ["en" as const], scoreThreshold: 9.0 };
const NO_DELAY = { sleep: async () => {} };

describe("retry and failure integration", () => {
  it("recovers from a transient provider failure and records every attempt verbatim", async () => {
    const store = new RunStore(":memory:");
    store.createRun({ id: "r-retry", idea: IDEA, config: {} });
    const adapter = createScriptedAdapter({
      scores: [9.5],
      onAttempt: ({ role, attempt }) => (role === "gen-a" && attempt === 1 ? "fail" : "ok"),
    });

    const result = await runLoopStage({
      runId: "r-retry",
      node: NODE,
      idea: IDEA,
      config: CONFIG,
      adapter,
      store,
      retry: NO_DELAY,
    });

    expect(result.status).toBe("done");
    // gen-a burned two attempts: verbatim error, then verbatim response.
    const genA = store.getStageCalls("r-retry", NODE.id).filter((c) => c.role === "gen-a");
    expect(genA.map((c) => c.attempt)).toEqual([1, 2]);
    expect(genA[0]?.error).toBe("ProviderError: Provider error 502: upstream reset");
    expect(genA[0]?.response).toBeNull();
    expect(genA[1]?.response).toBe(adapter.calls.find((c) => c.role === "gen-a")?.response);
    expect(genA[1]?.error).toBeNull();
    // Usage arrives only on the successful attempt (snake_case on read).
    expect(genA[1]?.input_tokens).toBe(100);
    expect(genA[0]?.input_tokens).toBeNull();
  });

  it("fails the stage with the verbatim provider error after 3 attempts", async () => {
    const store = new RunStore(":memory:");
    store.createRun({ id: "r-fail", idea: IDEA, config: {} });
    const adapter = createScriptedAdapter({
      scores: [],
      onAttempt: ({ role }) => (role === "gen-a" ? "fail" : "ok"),
    });

    const promise = runLoopStage({
      runId: "r-fail",
      node: NODE,
      idea: IDEA,
      config: CONFIG,
      adapter,
      store,
      retry: NO_DELAY,
    });

    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StageFailedError);
    // The verbatim provider error surfaces in the stage failure message.
    expect((err as StageFailedError).message).toContain("Provider error 502: upstream reset");
    expect((err as StageFailedError).stageId).toBe(NODE.id);

    // All 3 attempts recorded, none succeeded.
    const genA = store.getStageCalls("r-fail", NODE.id).filter((c) => c.role === "gen-a");
    expect(genA.map((c) => c.attempt)).toEqual([1, 2, 3]);
    expect(genA.every((c) => c.error !== null && c.response === null)).toBe(true);
    // The failed stage still persists the siblings that succeeded (gen-b,
    // gen-c): every completed call is recorded, nothing silently dropped.
    const kinds = store.listRunArtifacts("r-fail").map((a) => a.kind).sort();
    expect(kinds).toEqual(["gen-b", "gen-c"]);
    expect(store.getStageStatus("r-fail", NODE.id)?.status).toBe("failed");
  });

  it("retries on a validation miss without weakening the production floor", async () => {
    const store = new RunStore(":memory:");
    store.createRun({ id: "r-short", idea: IDEA, config: {} });
    const adapter = createScriptedAdapter({
      scores: [9.5],
      onAttempt: ({ role, attempt }) => (role === "improver" && attempt === 1 ? "short" : "ok"),
    });

    const result = await runLoopStage({
      runId: "r-short",
      node: NODE,
      idea: IDEA,
      config: CONFIG,
      adapter,
      store,
      retry: NO_DELAY,
    });

    expect(result.status).toBe("done");
    const improver = store.getStageCalls("r-short", NODE.id).filter((c) => c.role === "improver");
    expect(improver.map((c) => c.attempt)).toEqual([1, 2]);
    // The verbatim validation reason (the real production floor, unmodified).
    expect(improver[0]?.error).toContain("response under 2000 words");
    expect(improver[1]?.response).not.toBeNull();
  });

  it("contains a terminal stage failure: dependents blocked, the rest of the run continues", async () => {
    // Mini-DAG on the real scheduler: market-analysis (fails terminally) →
    // competitor-analysis (its dependent, must end blocked) and
    // expert-roundtable (independent, must finish done). Full-graph runs
    // belong to the E2E tier — this proves the containment machinery.
    const market = stageNode("market-analysis");
    const competitor = stageNode("competitor-analysis");
    const roundtable = stageNode("expert-roundtable");
    const miniDag: StageNode[] = [
      market,
      { ...competitor, deps: ["market-analysis"] },
      { ...roundtable, deps: [] },
    ];

    const store = new RunStore(":memory:");
    store.createRun({ id: "r-run", idea: IDEA, config: { scoreThreshold: 9.0 } });
    const adapter = createScriptedAdapter({
      scores: () => 9.5,
      onAttempt: ({ role, user }) =>
        role === "gen-a" && user.includes("Stage 1 — Market Analysis") ? "fail" : "ok",
    });

    const result = await runPipeline({
      runId: "r-run",
      idea: IDEA,
      config: CONFIG,
      adapter,
      store,
      retry: NO_DELAY,
      nodes: miniDag,
    });

    expect(result.status).toBe("failed");
    expect(result.states["market-analysis"]).toBe("failed");
    expect(result.states["competitor-analysis"]).toBe("blocked");
    expect(result.states["expert-roundtable"]).toBe("done");
    // Persisted run status reflects the failure.
    expect(store.getRun("r-run")?.status).toBe("failed");
    // The failing stage's verbatim provider error landed in the call log.
    const genA = store.getStageCalls("r-run", market.id).filter((c) => c.role === "gen-a");
    expect(genA).toHaveLength(3);
    expect(genA.every((c) => c.error?.includes("Provider error 502: upstream reset") ?? false)).toBe(true);
  });
});
