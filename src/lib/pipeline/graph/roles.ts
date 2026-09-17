/**
 * Canonical role names for the pipeline's call structure.
 *
 * Every loop stage runs the same 7-step furnace: three generators, a merger,
 * then per critique round three critics, an improver, three judges and a
 * reconciler. Role strings double as artifact `kind` keys in the run store
 * (`critique:vc`, `judge:harsh`, …), so they live here as the single source
 * of truth shared by the graph, the executor, and the dashboard tabs.
 */

/** Three independent full drafts per stage: canonical, contrarian, third lens. */
export const GENERATOR_ROLES = ["gen-a", "gen-b", "gen-c"] as const;

/** Single call combining A, B and C into a superset document. */
export const MERGER_ROLE = "merger";

/** The critique panel: three independent 20-point critiques (60 points total). */
export const CRITIC_ROLES = [
  "critic:pessimistic-vc",
  "critic:enterprise-buyer",
  "critic:senior-engineer",
] as const;

/** Rewrites the merged draft addressing all 60 critique points. */
export const IMPROVER_ROLE = "improver";

/** The judge panel: harsh, balanced, generous — 12 criteria each, 0–10. */
export const JUDGE_ROLES = [
  "judge:harsh",
  "judge:balanced",
  "judge:generous",
] as const;

/** Averages the three judges into the reconciled score. */
export const RECONCILER_ROLE = "reconciler";

/** Calls made once per loop stage, before the first critique round. */
export const GENERATION_PHASE_ROLES: readonly string[] = [
  ...GENERATOR_ROLES,
  MERGER_ROLE,
];

/** Calls made in every critique round (steps 5–7 of the 7-call loop). */
export const ROUND_ROLES: readonly string[] = [
  ...CRITIC_ROLES,
  IMPROVER_ROLE,
  ...JUDGE_ROLES,
  RECONCILER_ROLE,
];

/** Calls per loop stage after `rounds` critique rounds: 4 + 8 × rounds. */
export function loopCallCount(rounds: number): number {
  return GENERATION_PHASE_ROLES.length + ROUND_ROLES.length * rounds;
}
