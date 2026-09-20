/**
 * Run configuration (spec §6 "Run configuration"): depth, languages, the
 * reconciled-score threshold, and the optional strategy angle. Every prompt
 * the executor builds carries these values; the score gate compares against
 * `scoreThreshold` and the loop cap comes from `depth`.
 */

import { DEFAULT_DEPTH, type Depth } from "../graph/depth";
import type { Language } from "../graph/plan";

/** Per-run execution configuration, created by the Run API (T7). */
export interface RunConfig {
  depth: Depth;
  /** Localisation targets; loop stages always produce English. */
  languages: readonly Language[];
  /** Reconciled score a stage must reach to clear the quality loop. */
  scoreThreshold: number;
  /** Optional 3-alternatives-mode angle, injected into every prompt. */
  strategyAngle?: string;
}

/** Spec default: the 9.0 gate (stricter re-runs use 9.5 in a fresh run). */
export const DEFAULT_SCORE_THRESHOLD = 9.0;

/** Spec defaults: Extreme depth (the verbatim brief), English, 9.0 gate. */
export const DEFAULT_RUN_CONFIG: RunConfig = {
  depth: DEFAULT_DEPTH,
  languages: ["en"],
  scoreThreshold: DEFAULT_SCORE_THRESHOLD,
};
