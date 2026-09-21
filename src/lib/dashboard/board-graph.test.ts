/** Board projection of the DAG — structure, caps, and ordering. */

import { describe, expect, it } from "vitest";
import { loopCap } from "@/lib/pipeline/graph/depth";
import { STAGE_NODES } from "@/lib/pipeline/graph/stages";
import { WAVE_COUNT, WAVE_LABELS, boardNodes } from "./board-graph";

describe("boardNodes", () => {
  it("projects every DAG node exactly once", () => {
    expect(boardNodes("standard")).toHaveLength(STAGE_NODES.length);
    expect(boardNodes("standard")).toHaveLength(39);
  });

  it("resolves loop caps per depth for loop stages and pins passes at 1", () => {
    for (const depth of ["standard", "deep", "extreme"] as const) {
      for (const node of boardNodes(depth)) {
        if (node.kind === "stage") expect(node.loopCap).toBe(loopCap(depth));
        else expect(node.loopCap).toBe(1);
      }
    }
  });

  it("copies dependency lists (no shared array references with the DAG)", () => {
    const nodes = boardNodes("standard");
    for (const node of nodes) {
      const source = STAGE_NODES.find((n) => n.id === node.stageId);
      expect(source).toBeDefined();
      expect(node.deps).not.toBe(source?.deps);
      expect(node.deps).toEqual(source?.deps);
    }
  });
});

describe("wave columns", () => {
  it("covers waves 1..7 in order", () => {
    expect(WAVE_COUNT).toBe(7);
    const waves = new Set(boardNodes("standard").map((n) => n.waveIndex));
    expect([...waves].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("labels every wave", () => {
    for (let wave = 1; wave <= WAVE_COUNT; wave++) {
      expect(WAVE_LABELS[wave]).toMatch(new RegExp(`Wave ${wave}`));
    }
  });
});
