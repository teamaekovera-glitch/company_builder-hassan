/**
 * Pre-flight token/cost estimate — "computed from the depth matrix × the
 * price table" (spec: surfaced, not hidden, because a full run is the app's
 * own largest operational risk).
 *
 * Call counts come from the graph's static plan at the max-round setting
 * (every stage burns the depth's critique-loop cap — the honest upper bound
 * an operator is confirming). Tokens-per-call is a documented planning pair,
 * not a measurement: the global call rules floor every response at 2,000
 * words (~2,700 tokens) plus a ~300-word assumptions section, and context
 * threading grows inputs run-long; the pair below is a deliberate round
 * approximation over that shape. Price defaults are a config surface, not
 * ground truth — the real bill is always computed from provider usage
 * (`costFromTokens` over the calls table), never from this estimate.
 */

import type { PreflightEstimate } from "../dashboard/types";
import { loopCap, type Depth } from "../pipeline/graph/depth";
import { LANGUAGES, planCallCounts, type Language } from "../pipeline/graph/plan";

/** Planning approximation: average input tokens per provider call. */
export const ESTIMATE_INPUT_TOKENS_PER_CALL = 2_900;

/** Planning approximation: average output tokens per provider call. */
export const ESTIMATE_OUTPUT_TOKENS_PER_CALL = 3_000;

/** Planning approximation: wall-clock seconds per provider call (sequential worst case). */
export const ESTIMATED_SECONDS_PER_CALL = 25;

/** Per-million-token price table used for both estimates and actuals. */
export interface PriceTable {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

/** Default price table; a provider/model switch updates this one constant. */
export const DEFAULT_PRICE_TABLE: PriceTable = {
  inputUsdPerMTok: 2.5,
  outputUsdPerMTok: 10.0,
};

export interface EstimateConfig {
  depth: Depth;
  /** Localisation targets; defaults to all five (plan module's spec default). */
  languages?: readonly Language[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Actual token/cost accounting from provider usage — the same price table
 * applied to the calls table's summed usage (spec: "token/cost accounting
 * from provider usage").
 */
export function costFromTokens(
  totals: { inputTokens: number; outputTokens: number },
  prices: PriceTable = DEFAULT_PRICE_TABLE,
): number {
  return (
    (totals.inputTokens / 1_000_000) * prices.inputUsdPerMTok +
    (totals.outputTokens / 1_000_000) * prices.outputUsdPerMTok
  );
}

/**
 * Pre-flight estimate for a config: max-round call plan × planning token
 * pair × price table. Pure — same inputs, same estimate, no I/O.
 */
export function estimateRun(config: EstimateConfig, prices: PriceTable = DEFAULT_PRICE_TABLE): PreflightEstimate {
  const languages = config.languages ?? LANGUAGES;
  const cap = loopCap(config.depth);
  const plan = planCallCounts({ depth: config.depth, languages, rounds: cap });
  const calls = plan.totals.total;
  const inputTokens = calls * ESTIMATE_INPUT_TOKENS_PER_CALL;
  const outputTokens = calls * ESTIMATE_OUTPUT_TOKENS_PER_CALL;

  return {
    estimatedCalls: calls,
    estimatedTokens: inputTokens + outputTokens,
    estimatedCostUsd: round2(costFromTokens({ inputTokens, outputTokens }, prices)),
    estimatedHours: round1((calls * ESTIMATED_SECONDS_PER_CALL) / 3_600),
    loopCap: cap,
    languageCount: languages.length,
  };
}
