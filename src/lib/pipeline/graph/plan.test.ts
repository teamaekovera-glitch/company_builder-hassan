import { describe, expect, it } from "vitest";

import { LOOP_CAPS } from "./depth";
import type { Depth } from "./depth";
import { LANGUAGES, LOCALISATION_DOCUMENT_COUNT, enumerateCalls, minMaxPlan, planCallCounts } from "./plan";
import { ALL_CORE_STAGES, STAGE_NODES } from "./stages";

/**
 * Expected totals, derived from the spec's engine table and depth matrix:
 * - Loop: 26 core stages × (4 generation calls + 8 per critique round).
 * - Expansions: the depth matrix's call-generating rows (Extreme = the brief
 *   verbatim: 12 deep-dives, 12 personas, 12 screens, 15 blogs, 25 help
 *   articles, 20 job descriptions, 30/20/50 ads/emails/social, 5 black
 *   swans, 8 ADRs + fixed extras).
 * - Passes: 5 adversarial + 6 audit pairs + 1 synthesis + 6 ladder +
 *   1 meta-score + rerun (5 × loop + rechecked passes) + localisation
 *   (26 documents × languages + 2 per language) + 6 personas + 6 formats.
 */
const EXPECTED_TOTALS: Record<Depth, { min: number; max: number }> = {
  standard: { min: 723, max: 723 },
  deep: { min: 785, max: 1033 },
  extreme: { min: 858, max: 1354 },
};

describe("call-count plans (verification row 9)", () => {
  it.each(["standard", "deep", "extreme"] as const)("plans exact minimum-round calls for %s", (depth) => {
    const plan = planCallCounts({ depth, rounds: 1 });
    expect(plan.totals.total).toBe(EXPECTED_TOTALS[depth].min);
  });

  it.each(["standard", "deep", "extreme"] as const)("plans exact maximum-round calls for %s", (depth) => {
    const plan = planCallCounts({ depth }); // rounds defaults to the depth's cap
    expect(plan.rounds).toBe(LOOP_CAPS[depth]);
    expect(plan.totals.total).toBe(EXPECTED_TOTALS[depth].max);
  });

  it("defaults to Extreme with five languages", () => {
    expect(minMaxPlan().max).toBe(EXPECTED_TOTALS.extreme.max);
    expect(LANGUAGES).toHaveLength(5);
  });

  it("localises exactly the selected languages at every depth", () => {
    const enOnly = planCallCounts({ depth: "extreme", languages: ["en"], rounds: 1 });
    const allFive = planCallCounts({ depth: "extreme", rounds: 1 });
    // Dropping four languages removes 4 × (26 documents + 2) calls.
    expect(allFive.totals.total - enOnly.totals.total).toBe(4 * (LOCALISATION_DOCUMENT_COUNT + 2));
  });

  it("scales loop calls with the depth's critique-loop cap", () => {
    for (const depth of ["standard", "deep", "extreme"] as const) {
      const perStage = planCallCounts({ depth, rounds: 1 }).perStage.find((s) => s.stageId === "market-analysis");
      const perStageMax = planCallCounts({ depth }).perStage.find((s) => s.stageId === "market-analysis");
      expect(perStage?.loopCalls).toBe(12);
      expect(perStageMax?.loopCalls).toBe(4 + 8 * LOOP_CAPS[depth]);
    }
  });
});

describe("full-graph dry run", () => {
  it("enumerates every planned call for the default Extreme plan", () => {
    const manifest = enumerateCalls({ depth: "extreme" });
    const plan = planCallCounts({ depth: "extreme" });
    expect(manifest).toHaveLength(plan.totals.total);
  });

  it("enumerates the exact expected stage/role set at minimum rounds (Extreme)", () => {
    const manifest = enumerateCalls({ depth: "extreme", rounds: 1 });
    // Every one of the 39 stages appears.
    const stages = new Set(manifest.map((c) => c.stageId));
    expect(stages.size).toBe(39);

    // Core stages run the full loop: 3 generators, merger, 3 critics,
    // improver, 3 judges, reconciler.
    const market = manifest.filter((c) => c.stageId === "market-analysis");
    expect(market.map((c) => c.role)).toEqual([
      "gen-a",
      "gen-b",
      "gen-c",
      "merger",
      "critic:pessimistic-vc",
      "critic:enterprise-buyer",
      "critic:senior-engineer",
      "improver",
      "judge:harsh",
      "judge:balanced",
      "judge:generous",
      "reconciler",
    ]);

    // Expansion fan-outs carry their expansion role, one entry per call.
    const deepDives = manifest.filter((c) => c.stageId === "competitor-analysis" && c.role === "competitor-deep-dive");
    expect(deepDives).toHaveLength(12);
    const helpArticles = manifest.filter((c) => c.stageId === "support-pack" && c.role === "help-article");
    expect(helpArticles).toHaveLength(25);
    const socialPosts = manifest.filter((c) => c.stageId === "marketing-plan" && c.role === "social-post");
    expect(socialPosts).toHaveLength(50);
    const translations = manifest.filter((c) => c.stageId === "localisation" && c.role === "translation");
    expect(translations).toHaveLength(LOCALISATION_DOCUMENT_COUNT * LANGUAGES.length);

    // The adversarial chain and its rebuttals appear exactly once each.
    for (const role of ["devils-advocate", "rebuttal", "devils-advocate-2", "final-rebuttal", "red-team-blue-team"]) {
      expect(manifest.filter((c) => c.stageId !== "auto-rerun" && c.role === role)).toHaveLength(1);
    }
  });

  it("runs entirely offline and deterministically", () => {
    const manifest = enumerateCalls({ depth: "extreme", rounds: 1 });
    expect(manifest.length).toBeGreaterThan(0);
    // Two runs produce identical manifests — pure data, no provider.
    expect(enumerateCalls({ depth: "extreme", rounds: 1 })).toEqual(manifest);
  });

  it("accounts for every call in every stage's plan", () => {
    for (const depth of ["standard", "deep", "extreme"] as const) {
      for (const rounds of [1, LOOP_CAPS[depth]]) {
        const plan = planCallCounts({ depth, rounds });
        const manifest = enumerateCalls({ depth, rounds });
        for (const stage of plan.perStage) {
          const enumerated = manifest.filter((c) => c.stageId === stage.stageId).length;
          expect(enumerated).toBe(stage.total);
        }
      }
    }
  });

  it("keeps the 26 core stages as the loop/document set", () => {
    expect(ALL_CORE_STAGES).toHaveLength(26);
    expect(STAGE_NODES.filter((n) => n.kind === "stage")).toHaveLength(26);
    expect(LOCALISATION_DOCUMENT_COUNT).toBe(26);
  });
});
