/**
 * Pre-flight estimate math: call counts come from the graph's static plan,
 * token/cost/hours from the documented planning constants. These tests pin
 * the formula end to end so a price-table or matrix change is a reviewable
 * diff, not a silent drift.
 */

import { describe, expect, it } from "vitest";
import { planCallCounts } from "../pipeline/graph/plan";
import { LOOP_CAPS } from "../pipeline/graph/depth";
import {
  DEFAULT_PRICE_TABLE,
  ESTIMATE_INPUT_TOKENS_PER_CALL,
  ESTIMATE_OUTPUT_TOKENS_PER_CALL,
  ESTIMATED_SECONDS_PER_CALL,
  costFromTokens,
  estimateRun,
} from "./estimate";

describe("estimateRun", () => {
  it("scales calls strictly with depth", () => {
    const standard = estimateRun({ depth: "standard" });
    const deep = estimateRun({ depth: "deep" });
    const extreme = estimateRun({ depth: "extreme" });
    expect(standard.estimatedCalls).toBeLessThan(deep.estimatedCalls);
    expect(deep.estimatedCalls).toBeLessThan(extreme.estimatedCalls);
  });

  it("derives calls from the max-round static plan", () => {
    for (const depth of ["standard", "deep", "extreme"] as const) {
      const estimate = estimateRun({ depth });
      const plan = planCallCounts({ depth, rounds: LOOP_CAPS[depth] });
      expect(estimate.estimatedCalls).toBe(plan.totals.total);
      expect(estimate.loopCap).toBe(LOOP_CAPS[depth]);
    }
  });

  it("applies the planning token pair and price table", () => {
    const estimate = estimateRun({ depth: "extreme" });
    const calls = estimate.estimatedCalls;
    const inputTokens = calls * ESTIMATE_INPUT_TOKENS_PER_CALL;
    const outputTokens = calls * ESTIMATE_OUTPUT_TOKENS_PER_CALL;

    expect(estimate.estimatedTokens).toBe(inputTokens + outputTokens);
    expect(estimate.estimatedCostUsd).toBe(
      Math.round(costFromTokens({ inputTokens, outputTokens }) * 100) / 100,
    );
    expect(estimate.estimatedHours).toBe(
      Math.round(((calls * ESTIMATED_SECONDS_PER_CALL) / 3_600) * 10) / 10,
    );
  });

  it("localisation volume follows the selected languages", () => {
    const allFive = estimateRun({ depth: "extreme" });
    const englishOnly = estimateRun({ depth: "extreme", languages: ["en"] });
    const two = estimateRun({ depth: "extreme", languages: ["en", "es"] });
    expect(englishOnly.languageCount).toBe(1);
    expect(englishOnly.estimatedCalls).toBeLessThan(two.estimatedCalls);
    expect(two.estimatedCalls).toBeLessThan(allFive.estimatedCalls);
  });

  it("is pure — same config, same estimate", () => {
    expect(estimateRun({ depth: "deep", languages: ["en", "de"] })).toEqual(
      estimateRun({ depth: "deep", languages: ["en", "de"] }),
    );
  });
});

describe("costFromTokens", () => {
  it("prices input and output at the table's per-million rates", () => {
    expect(costFromTokens({ inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(12.5);
  });

  it("honours a custom price table", () => {
    const prices = { inputUsdPerMTok: 1, outputUsdPerMTok: 2 };
    expect(costFromTokens({ inputTokens: 500_000, outputTokens: 250_000 }, prices)).toBe(1);
  });

  it("defaults match DEFAULT_PRICE_TABLE", () => {
    expect(DEFAULT_PRICE_TABLE).toEqual({ inputUsdPerMTok: 2.5, outputUsdPerMTok: 10.0 });
  });
});
