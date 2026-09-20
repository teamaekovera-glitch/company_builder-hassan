import { afterEach, describe, expect, it } from "vitest";

import { RunStore } from "../../store/store";
import { loopStageNode } from "../graph/stages";
import { createScriptedAdapter } from "./fixtures";
import { runLoopStage } from "./stage";

const IDEA = "Loop-cap termination probe";
const NODE = loopStageNode("market-analysis");
const NO_DELAY = { sleep: async () => {} };

const stores: RunStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function setup(id: string): RunStore {
  const store = new RunStore(":memory:");
  store.createRun({ id, idea: IDEA, config: { scoreThreshold: 9.0 } });
  stores.push(store);
  return store;
}

describe("loop cap termination", () => {
  it("terminates at exactly 3 rounds at Extreme when scores never reach the threshold", async () => {
    const store = setup("r-cap-extreme");
    const adapter = createScriptedAdapter({ scores: () => 7.0 });
    const result = await runLoopStage({
      runId: "r-cap-extreme",
      node: NODE,
      idea: IDEA,
      config: { depth: "extreme", languages: ["en"], scoreThreshold: 9.0 },
      adapter,
      store,
      retry: NO_DELAY,
    });

    // Hard stop at the Extreme cap — no runaway loop, flagged for review.
    expect(result.rounds).toBe(3);
    expect(result.flagged).toBe(true);
    expect(result.finalScore).toBe(7.0);
    expect(adapter.calls.filter((c) => c.role === "reconciler")).toHaveLength(3);

    // Best-scoring iteration wins at the cap: scores 7.2 / 7.5 / 7.4.
    const store2 = setup("r-cap-best");
    const adapter2 = createScriptedAdapter({ scores: [7.2, 7.5, 7.4] });
    const result2 = await runLoopStage({
      runId: "r-cap-best",
      node: NODE,
      idea: IDEA,
      config: { depth: "extreme", languages: ["en"], scoreThreshold: 9.0 },
      adapter: adapter2,
      store: store2,
      retry: NO_DELAY,
    });

    expect(result2.rounds).toBe(3);
    expect(result2.flagged).toBe(true);
    expect(result2.finalScore).toBe(7.5);
    const winner = store2.getArtifact("r-cap-best", NODE.id, "improved");
    const round2 = store2.getArtifact("r-cap-best", NODE.id, "improved:r2");
    const round1 = store2.getArtifact("r-cap-best", NODE.id, "improved:r1");
    expect(winner?.text).toBe(round2?.text);
    expect(winner?.text).not.toBe(round1?.text);
    expect(winner?.score).toBe(7.5);
  });

  it("runs at most one round at Standard depth", async () => {
    const store = setup("r-cap-standard");
    const adapter = createScriptedAdapter({ scores: () => 5.0 });
    const result = await runLoopStage({
      runId: "r-cap-standard",
      node: NODE,
      idea: IDEA,
      config: { depth: "standard", languages: ["en"], scoreThreshold: 9.0 },
      adapter,
      store,
      retry: NO_DELAY,
    });

    expect(result.rounds).toBe(1);
    expect(result.flagged).toBe(true);
    expect(adapter.calls.filter((c) => c.role === "reconciler")).toHaveLength(1);
  });
});
