import { describe, expect, it } from "vitest";

import { RunStore } from "../../store/store";
import { loopStageNode } from "../graph/stages";
import { createScriptedAdapter } from "./fixtures";
import { runLoopStage } from "./stage";

const IDEA = "A solar-powered bike-share network for monsoon cities";
const NODE = loopStageNode("market-analysis");
const STORE = new RunStore(":memory:");
STORE.createRun({ id: "r-score-gate", idea: IDEA, config: { scoreThreshold: 9.0 } });

/** Minimal config: Extreme depth, 9.0 gate (the verbatim brief). */
const CONFIG = { depth: "extreme" as const, languages: ["en" as const], scoreThreshold: 9.0 };
const NO_DELAY = { sleep: async () => {} };

describe("runLoopStage score gate", () => {
  it("runs exactly the spec'd rounds for 8.2/8.8/9.1 and the best iteration wins", async () => {
    const adapter = createScriptedAdapter({ scores: [8.2, 8.8, 9.1] });
    const result = await runLoopStage({
      runId: "r-score-gate",
      node: NODE,
      idea: IDEA,
      config: CONFIG,
      adapter,
      store: STORE,
      retry: NO_DELAY,
    });

    // Threshold 9.0: rounds 1 and 2 sit below, round 3 clears — no fourth round.
    expect(result.status).toBe("done");
    expect(result.rounds).toBe(3);
    expect(result.finalScore).toBe(9.1);
    expect(result.flagged).toBe(false);

    // Call accounting: 3 generators + merger + 3 × (3 critics + improver + 3 judges + reconciler).
    const reconciles = adapter.calls.filter((c) => c.role === "reconciler");
    expect(reconciles).toHaveLength(3);
    expect(adapter.calls.filter((c) => c.role === "merger")).toHaveLength(1);
    expect(adapter.calls.filter((c) => c.role === "gen-a")).toHaveLength(1);

    // Persisted per-round scores, in order.
    const artifacts = STORE.listRunArtifacts("r-score-gate");
    const reconcilerRows = artifacts.filter((a) => a.kind.startsWith("reconciler:"));
    expect(reconcilerRows.map((r) => r.score)).toEqual([8.2, 8.8, 9.1]);

    // The winning deliverable is the round-3 improved draft (score 9.1).
    const winner = STORE.getArtifact("r-score-gate", NODE.id, "improved");
    const round3 = STORE.getArtifact("r-score-gate", NODE.id, "improved:r3");
    const round2 = STORE.getArtifact("r-score-gate", NODE.id, "improved:r2");
    expect(winner?.text).toBe(round3?.text);
    expect(round3?.text).not.toBe(round2?.text);
    expect(winner?.score).toBe(9.1);

    // The winning iteration is persisted as a separate row — every iteration survives.
    expect(artifacts.filter((a) => a.kind === "improved")).toHaveLength(1);
  });

  it("stops after the first round when the threshold clears immediately", async () => {
    STORE.createRun({ id: "r-clear-first", idea: IDEA, config: { scoreThreshold: 9.0 } });
    const adapter = createScriptedAdapter({ scores: [9.5] });
    const result = await runLoopStage({
      runId: "r-clear-first",
      node: NODE,
      idea: IDEA,
      config: CONFIG,
      adapter,
      store: STORE,
      retry: NO_DELAY,
    });

    expect(result.rounds).toBe(1);
    expect(result.finalScore).toBe(9.5);
    expect(result.flagged).toBe(false);
    expect(adapter.calls.filter((c) => c.role === "reconciler")).toHaveLength(1);
    expect(adapter.calls.filter((c) => c.role === "improver")).toHaveLength(1);
  });
});
