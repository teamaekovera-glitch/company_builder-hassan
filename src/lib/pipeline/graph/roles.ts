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

// ── Pass-stage roles ─────────────────────────────────────────────────────────
// Values MUST match the role strings in graph/stages.ts pass definitions —
// stages.ts is intentionally import-free pure data, so the executor and the
// exporters import these constants and the stage-graph tests cross-check both.

/** The adversarial gauntlet (stages 27–31), one call per stage, in brief order. */
export const ADVERSARIAL_ROLES = [
  "devils-advocate",
  "rebuttal",
  "devils-advocate-2",
  "final-rebuttal",
  "red-team-blue-team",
] as const;

/** Cross-stage contradiction scan: one call per related stage pair. */
export const AUDIT_PAIR_ROLE = "audit-pair";

/** One resolution call per contradiction the pair audits actually found. */
export const AUDIT_RESOLUTION_ROLE = "audit-resolution";

/** Executive synthesis: the dossier narrative plus a 100+ term glossary. */
export const EXECUTIVE_SYNTHESIS_ROLE = "executive-synthesis";

/** The six-rung executive summary ladder (stage 34). */
export const SUMMARY_LADDER_ROLE = "summary-ladder";

/** Ranks every stage by reconciled score and names the weakest. */
export const META_SCORE_ROLE = "meta-score";

/** One rewrite of the executive synthesis per audience (stage 38). */
export const PERSONA_REWRITE_ROLE = "persona-rewrite";

/** One dossier output format per call (stage 39). */
export const OUTPUT_FORMAT_ROLE = "output-format";

/** Localisation roles (stage 37): translation, per-language QA, per-language adaptation. */
export const TRANSLATION_ROLE = "translation";
export const LOCALISATION_QA_ROLE = "localisation-qa";
export const CULTURAL_ADAPTATION_ROLE = "cultural-adaptation";

/** True when `role` is (or is prefixed as, for re-runs/rechecks) the reconciler. */
export function isReconcilerRole(role: string): boolean {
  return role === RECONCILER_ROLE || role.endsWith(`:${RECONCILER_ROLE}`);
}
