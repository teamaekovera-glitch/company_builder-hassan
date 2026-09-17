/**
 * The depth model: Standard / Deep / Extreme.
 *
 * Depth scales artifact fan-out counts and the critique-loop cap — nothing
 * else. "Extreme" reproduces the operator's brief verbatim and is the default
 * (spec: "Extreme (default)"). Language selection is orthogonal: the
 * localisation pass runs for exactly the selected languages at every depth.
 *
 * Transcribed from the spec's depth matrix:
 *
 * | Parameter                              | Standard | Deep     | Extreme (default) |
 * |----------------------------------------|----------|----------|-------------------|
 * | Competitor deep-dives                  | 4        | 8        | 12                |
 * | Personas (interview + JTBD + journeys) | 4        | 8        | 12                |
 * | UI screen mockups + a11y audits        | 6        | 9        | 12                |
 * | Blog posts (1,500 words each)          | 5        | 10       | 15                |
 * | Help-centre articles                   | 12       | 18       | 25                |
 * | Job descriptions                       | 8        | 14       | 20                |
 * | Ads / emails / social posts            | 15/12/25 | 20/16/35 | 30/20/50          |
 * | Critique-loop cap (rounds of 3–6)      | 1        | 2        | 3                 |
 * | ADRs (minimum)                         | 8        | 8        | 8                 |
 * | Risks / black swans                    | 20/3     | 30/4     | 40/5              |
 */

import type { DepthScaledKey } from "./stages";

export type Depth = "standard" | "deep" | "extreme";

/** "Extreme" reproduces the operator's brief verbatim. */
export const DEFAULT_DEPTH: Depth = "extreme";

export const DEPTHS: readonly Depth[] = ["standard", "deep", "extreme"];

/** Maximum critique-loop rounds (steps 3–6) per stage, by depth. */
export const LOOP_CAPS: Record<Depth, number> = { standard: 1, deep: 2, extreme: 3 };

/** Depth-scaled values that generate additional provider calls. */
export type CallMatrix = Record<DepthScaledKey, number>;

/**
 * The call-generating slice of the depth matrix. In-loop content volume (SEO
 * keyword clusters, landing briefs, objection handlers, outreach sequences,
 * the risk-matrix rows) is scaled by the matrix in the spec but lives inside
 * the loop calls, so it does not appear here — see `CONTENT_VOLUME`.
 */
export const DEPTH_MATRIX: Record<Depth, CallMatrix> = {
  standard: {
    competitorDeepDives: 4,
    personas: 4,
    uiScreens: 6,
    blogPosts: 5,
    helpArticles: 12,
    jobDescriptions: 8,
    blackSwans: 3,
    ads: 15,
    sequenceEmails: 12,
    socialPosts: 25,
    minAdrs: 8,
  },
  deep: {
    competitorDeepDives: 8,
    personas: 8,
    uiScreens: 9,
    blogPosts: 10,
    helpArticles: 18,
    jobDescriptions: 14,
    blackSwans: 4,
    ads: 20,
    sequenceEmails: 16,
    socialPosts: 35,
    minAdrs: 8,
  },
  extreme: {
    competitorDeepDives: 12,
    personas: 12,
    uiScreens: 12,
    blogPosts: 15,
    helpArticles: 25,
    jobDescriptions: 20,
    blackSwans: 5,
    ads: 30,
    sequenceEmails: 20,
    socialPosts: 50,
    minAdrs: 8,
  },
};

/** In-loop content volume by depth — produced inside the 7-call loop calls. */
export const CONTENT_VOLUME: Record<
  Depth,
  {
    keywordClusters: number;
    landingBriefs: number;
    riskMatrix: number;
    objections: number;
    coldSequences: number;
    linkedinSequences: number;
  }
> = {
  standard: { keywordClusters: 40, landingBriefs: 8, riskMatrix: 20, objections: 15, coldSequences: 5, linkedinSequences: 5 },
  deep: { keywordClusters: 70, landingBriefs: 14, riskMatrix: 30, objections: 20, coldSequences: 7, linkedinSequences: 7 },
  extreme: { keywordClusters: 100, landingBriefs: 20, riskMatrix: 40, objections: 30, coldSequences: 10, linkedinSequences: 10 },
};

/** Call-count fan-outs for `depth`, keyed by `DepthScaledKey`. */
export function depthMatrix(depth: Depth): CallMatrix {
  return DEPTH_MATRIX[depth];
}

/** Critique-loop cap for `depth`: rounds of loop steps 3–6 (1/2/3). */
export function loopCap(depth: Depth): number {
  return LOOP_CAPS[depth];
}
