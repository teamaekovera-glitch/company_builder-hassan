import { describe, expect, it } from "vitest";

import {
  applyBlocking,
  createRunState,
  isWaveClosed,
  isWaveOpen,
  readyNodes,
  simulate,
  stagesInWave,
  waveIndexOf,
} from "./schedule";
import { ALL_CORE_STAGES, STAGE_NODES, type StageId } from "./stages";

/** Dependencies of `id` that have not finished yet. */
function unfinishedDeps(id: StageId, order: StageId[]): StageId[] {
  const deps = STAGE_NODES.find((n) => n.id === id)?.deps ?? [];
  return deps.filter((dep) => !order.includes(dep));
}

describe("wave ordering", () => {
  it("completes all 39 stages in a healthy run", () => {
    const { order, states } = simulate();
    expect(order).toHaveLength(39);
    expect(Object.values(states).every((s) => s === "done")).toBe(true);
  });

  it("runs each stage only after all of its dependencies", () => {
    const { order } = simulate();
    for (const id of order) {
      expect(unfinishedDeps(id, order)).toEqual([]);
    }
  });

  it("runs the five core waves strictly in order", () => {
    const { order } = simulate();
    const positions = order.map((id) => waveIndexOf(id));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1]);
    }
    // Wave 3's parallel variants all appear before any wave-4 stage.
    const lastWave3 = Math.max(...stagesInWave(3).map((id) => order.indexOf(id)));
    const firstWave4 = Math.min(...stagesInWave(4).map((id) => order.indexOf(id)));
    expect(lastWave3).toBeLessThan(firstWave4);
  });

  it("does not open a wave until every node of the previous wave is terminal", () => {
    const state = createRunState();
    expect(isWaveOpen(1, state)).toBe(true);
    expect(isWaveOpen(2, state)).toBe(false);

    // Complete wave 1 except one stage: wave 2 must stay closed.
    for (const id of stagesInWave(1)) {
      if (id !== "expert-roundtable") state[id] = "done";
    }
    expect(isWaveClosed(1, state)).toBe(false);
    expect(isWaveOpen(2, state)).toBe(false);

    state["expert-roundtable"] = "done";
    expect(isWaveClosed(1, state)).toBe(true);
    expect(isWaveOpen(2, state)).toBe(true);
  });

  it("reports wave-1 nodes ready first, then wave-2 nodes", () => {
    const initial = createRunState();
    expect(readyNodes(initial)).toEqual(stagesInWave(1));

    const state = createRunState();
    for (const id of stagesInWave(1)) state[id] = "done";
    const advanced = applyBlocking(state);
    expect(readyNodes(advanced)).toEqual(stagesInWave(2));
  });
});

describe("dependency resolution and blocking", () => {
  it("propagates failure transitively while unrelated branches continue", () => {
    const { states } = simulate(["market-analysis"]);
    expect(states["market-analysis"]).toBe("failed");

    // Devil's advocate needs ALL core stages, so the whole wave-6/7 chain blocks.
    const blocked: StageId[] = [
      "devils-advocate",
      "rebuttal",
      "devils-advocate-2",
      "final-rebuttal",
      "red-team-blue-team",
      "executive-synthesis",
      "summary-ladder",
      "auto-rerun",
      "localisation",
      "persona-rewrites",
      "output-formats",
    ];
    for (const id of blocked) expect(states[id]).toBe("blocked");

    // The consistency audit only depends on audit-pair stages, so it still runs.
    expect(states["consistency-audit"]).toBe("done");
    // Meta-score depends on ALL core stages — including the failed one — so it blocks.
    expect(states["meta-score"]).toBe("blocked");
    // All other core stages complete despite the failure.
    expect(ALL_CORE_STAGES.filter((id) => id !== "market-analysis").every((id) => states[id] === "done")).toBe(true);
  });

  it("blocks same-wave dependents when a wave-5 dependency fails", () => {
    const { states } = simulate(["financial-model"]);
    expect(states["board-reports"]).toBe("blocked");
    expect(states["risk-assessment"]).toBe("done");
    expect(states["consistency-audit"]).toBe("blocked");
  });

  it("never marks blocked stages ready", () => {
    const { states } = simulate(["financial-model"]);
    const readyIds = readyNodes(applyBlocking(states));
    for (const [id, stageState] of Object.entries(states)) {
      if (stageState === "blocked") expect(readyIds).not.toContain(id as StageId);
    }
  });
});
