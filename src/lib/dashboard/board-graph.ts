/**
 * Board projection of the pipeline DAG — the static structure the live board
 * renders. Importing the graph into client components is safe: stages.ts is
 * pure data, no I/O, no provider code.
 */

import { loopCap, type Depth } from "@/lib/pipeline/graph/depth";
import { STAGE_NODES, type StageId } from "@/lib/pipeline/graph/stages";

export const WAVE_LABELS: Record<number, string> = {
  1: "Wave 1 — Research",
  2: "Wave 2 — Product",
  3: "Wave 3 — Foundation",
  4: "Wave 4 — Build",
  5: "Wave 5 — Risk & pitch",
  6: "Wave 6 — Adversarial passes",
  7: "Wave 7 — Synthesis & formats",
};

/** Highest wave number in the DAG (7). */
export const WAVE_COUNT = Math.max(...STAGE_NODES.map((node) => node.wave));

export interface BoardNode {
  stageId: StageId;
  title: string;
  waveIndex: number;
  /** Loop stages run the 7-call quality loop; pass nodes run fixed call lists. */
  kind: "stage" | "pass";
  deps: StageId[];
  /** Display cap for the card's loop figure; pass nodes show 0/1 (they don't loop). */
  loopCap: number;
}

/** All stages as board nodes, loop caps resolved for the depth. */
export function boardNodes(depth: Depth): BoardNode[] {
  const cap = loopCap(depth);
  return STAGE_NODES.map((node) => ({
    stageId: node.id,
    title: node.title,
    waveIndex: node.wave,
    kind: node.kind,
    deps: [...node.deps],
    loopCap: node.kind === "stage" ? cap : 1,
  }));
}
