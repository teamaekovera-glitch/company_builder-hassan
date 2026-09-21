// Static fixture data for the dashboard components and the preview page.
// Mirrors the spec's wave map (5 build waves + later passes collapsed into a
// "Passes 27–39" column) and every consequential state a card can show.

import { LANGUAGE_LABELS, type LanguageOption } from "./types";
import type {
  DepthOption,
  PreflightEstimate,
  RunConfigDraft,
  RunMetrics,
  StageCardData,
  StageDetailData,
  WaveColumnData,
} from "./types";

export const DEPTH_OPTIONS: DepthOption[] = [
  { value: "standard", label: "Standard", description: "Lean counts, 1 critique loop", loopCap: 1 },
  { value: "deep", label: "Deep", description: "Doubled counts, 2 critique loops", loopCap: 2 },
  { value: "extreme", label: "Extreme", description: "Full brief verbatim, 3 critique loops", loopCap: 3 },
];

export const LANGUAGE_OPTIONS: LanguageOption[] = (
  Object.entries(LANGUAGE_LABELS) as [keyof typeof LANGUAGE_LABELS, { label: string; nativeLabel: string }][]
).map(([code, labels]) => ({ code, label: labels.label, nativeLabel: labels.nativeLabel }));

export const DEFAULT_CONFIG: RunConfigDraft = {
  idea: "",
  depth: "extreme",
  languages: ["en", "es", "de", "ja", "hi"],
};

export const SAMPLE_IDEA = "A subscription service for monthly specialty-coffee discovery boxes";

/** Fixture estimate consistent with an Extreme, five-language run. */
export const SAMPLE_ESTIMATE: PreflightEstimate = {
  estimatedCalls: 780,
  estimatedTokens: 4_600_000,
  estimatedCostUsd: 31.4,
  estimatedHours: 5.5,
  loopCap: 3,
  languageCount: 5,
};

const CARD_BASE: Omit<StageCardData, "stageId" | "title" | "waveIndex" | "status"> = {
  loop: 1,
  loopCap: 3,
  tokens: 0,
  elapsedMs: 0,
  score: null,
  calls: 0,
};

export function stageCard(overrides: Partial<StageCardData> & Pick<StageCardData, "stageId" | "title" | "waveIndex" | "status">): StageCardData {
  return { ...CARD_BASE, ...overrides };
}

/** Wave columns with one card per state, plus realistic neighbours. */
export function buildWaveColumns(): WaveColumnData[] {
  return [
    {
      waveIndex: 1,
      label: "Wave 1 — Research",
      stages: [
        stageCard({
          stageId: "market-analysis",
          title: "Market Analysis",
          waveIndex: 1,
          status: "done",
          loop: 2,
          loopCap: 3,
          tokens: 184_320,
          elapsedMs: 5 * 60_000 + 12_000,
          score: 9.2,
          calls: 17,
        }),
        stageCard({
          stageId: "competitor-analysis",
          title: "Competitor Analysis",
          waveIndex: 1,
          status: "running",
          loop: 1,
          loopCap: 3,
          tokens: 47_500,
          elapsedMs: 82_000,
          score: null,
          calls: 6,
        }),
        stageCard({
          stageId: "expert-roundtable",
          title: "Expert Roundtable",
          waveIndex: 1,
          status: "queued",
          loop: 0,
          loopCap: 3,
        }),
      ],
    },
    {
      waveIndex: 2,
      label: "Wave 2 — Product",
      stages: [
        stageCard({
          stageId: "business-model",
          title: "Business Model Design",
          waveIndex: 2,
          status: "blocked",
          loop: 0,
          loopCap: 3,
          blockedBy: "market-analysis",
        }),
        stageCard({
          stageId: "user-interviews",
          title: "User Interview Simulation",
          waveIndex: 2,
          status: "blocked",
          loop: 0,
          loopCap: 3,
          blockedBy: "market-analysis",
        }),
        stageCard({
          stageId: "journey-maps",
          title: "Customer Journey Mapping",
          waveIndex: 2,
          status: "blocked",
          loop: 0,
          loopCap: 3,
          blockedBy: "user-interviews",
        }),
      ],
    },
    {
      waveIndex: 3,
      label: "Wave 3 — Foundation",
      stages: [
        stageCard({
          stageId: "prd",
          title: "PRD",
          waveIndex: 3,
          status: "queued",
          loop: 0,
          loopCap: 3,
        }),
        stageCard({
          stageId: "brand-identity",
          title: "Brand Identity",
          waveIndex: 3,
          status: "queued",
          loop: 0,
          loopCap: 3,
        }),
      ],
    },
    {
      waveIndex: 4,
      label: "Wave 4 — Build",
      stages: [
        stageCard({
          stageId: "legal-pack",
          title: "Legal & Compliance Pack",
          waveIndex: 4,
          status: "failed",
          loop: 1,
          loopCap: 3,
          tokens: 12_400,
          elapsedMs: 38_000,
          score: null,
          calls: 3,
          errorMessage: "provider error 503: upstream overloaded — exhausted 3 retries",
        }),
        stageCard({
          stageId: "database",
          title: "Database Design",
          waveIndex: 4,
          status: "queued",
          loop: 0,
          loopCap: 3,
        }),
      ],
    },
    {
      waveIndex: 5,
      label: "Passes 27–39",
      stages: [
        stageCard({
          stageId: "adversarial-gauntlet",
          title: "Adversarial Gauntlet",
          waveIndex: 5,
          status: "queued",
          loop: 0,
          loopCap: 1,
        }),
        stageCard({
          stageId: "localisation",
          title: "Localisation",
          waveIndex: 5,
          status: "queued",
          loop: 0,
          loopCap: 1,
        }),
      ],
    },
  ];
}

export function buildRunMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    status: "running",
    tokens: 1_234_500,
    calls: 412,
    elapsedMs: 2 * 3600_000 + 14 * 60_000 + 30_000,
    costUsd: 8.42,
    tokensPerSec: 160,
    ...overrides,
  };
}

/** A completed stage whose full history feeds the detail tabs (two rounds; round 2 wins). */
export function buildStageDetail(): StageDetailData {
  return {
    stageId: "market-analysis",
    title: "Market Analysis",
    status: "done",
    rounds: 2,
    winningRound: 2,
    drafts: [
      { generator: "Generator A", text: "Draft A — TAM/SAM/SOM by region with five-year forecast…" },
      { generator: "Generator B", text: "Draft B — bottom-up demand model anchored on 15 data-backed insights…" },
      { generator: "Generator C", text: "Draft C — regulation-by-country scan with risk shading…" },
    ],
    merged: "Merged draft — best of A, B, C reconciled into one narrative with citations…",
    critiques: [
      { critic: "Critic 1 — pessimistic-vc", role: "critic:pessimistic-vc", round: 1, text: "Methodology: the five-year forecast lacks a stated CAGR source…" },
      { critic: "Critic 2 — enterprise-buyer", role: "critic:enterprise-buyer", round: 1, text: "Evidence: three competitor claims are unsourced…" },
      { critic: "Critic 3 — senior-engineer", role: "critic:senior-engineer", round: 1, text: "Structure: SOM section buries the regional split…" },
      { critic: "Critic 1 — pessimistic-vc", role: "critic:pessimistic-vc", round: 2, text: "CAGR now sourced; remaining concern is churn attribution…" },
      { critic: "Critic 2 — enterprise-buyer", role: "critic:enterprise-buyer", round: 2, text: "Competitor claims cited; procurement blockers addressed…" },
      { critic: "Critic 3 — senior-engineer", role: "critic:senior-engineer", round: 2, text: "Regional split is now explicit; data pipeline sound…" },
    ],
    improved: [
      { round: 1, text: "Improved draft r1 — forecast re-sourced, SOM split by region…", score: 8.6, winning: false },
      { round: 2, text: "Improved draft r2 — churn attribution fixed, citations complete…", score: 9.2, winning: true },
    ],
    scoreRounds: [
      {
        round: 1,
        judges: [
          { judge: "Judge 1 — harsh", role: "judge:harsh", text: "Accuracy 8.4, Depth 8.8, Clarity 8.9 — forecast sourcing still thin…" },
          { judge: "Judge 2 — balanced", role: "judge:balanced", text: "Accuracy 8.8, Depth 8.6, Clarity 8.7 — solid after round one…" },
          { judge: "Judge 3 — generous", role: "judge:generous", text: "Accuracy 8.9, Depth 8.7, Clarity 8.8 — near the bar…" },
        ],
        reconciled: 8.6,
        reconcilerRationale: "Reconciled 8.6: judges cluster at 8.7±0.2; demand-model depth keeps this below the 9.0 gate…",
      },
      {
        round: 2,
        judges: [
          { judge: "Judge 1 — harsh", role: "judge:harsh", text: "Accuracy 9.1, Depth 9.0, Clarity 9.2 — citations complete…" },
          { judge: "Judge 2 — balanced", role: "judge:balanced", text: "Accuracy 9.2, Depth 9.1, Clarity 9.2 — clears every dimension…" },
          { judge: "Judge 3 — generous", role: "judge:generous", text: "Accuracy 9.3, Depth 9.2, Clarity 9.3 — publication ready…" },
        ],
        reconciled: 9.2,
        reconcilerRationale: "Reconciled 9.2: all three judges at or above 9.1; the gate is cleared with sourcing complete…",
      },
    ],
    translations: [
      { code: "es", label: "Spanish", text: "Análisis de mercado — TAM/SAM/SOM por región…" },
      { code: "de", label: "German", text: "Marktanalyse — TAM/SAM/SOM nach Region…" },
      { code: "ja", label: "Japanese", text: "市場分析 — 地域別のTAM/SAM/SOM…" },
      { code: "hi", label: "Hindi", text: "बाज़ार विश्लेषण — क्षेत्र अनुसार TAM/SAM/SOM…" },
    ],
    mockupHtml: "<main><h1>Market Analysis mockup</h1><p>Single-file HTML rendered sandboxed.</p></main>",
    loopHistory: [
      { loop: 0, role: "gen-a", attempts: 1, tokens: 14_200, ms: 41_000 },
      { loop: 0, role: "gen-b", attempts: 1, tokens: 13_800, ms: 39_500 },
      { loop: 0, role: "gen-c", attempts: 1, tokens: 14_050, ms: 40_200 },
      { loop: 0, role: "merger", attempts: 1, tokens: 18_600, ms: 33_000 },
      { loop: 1, role: "critic:pessimistic-vc", attempts: 2, tokens: 9_400, ms: 21_000 },
      { loop: 1, role: "improver", attempts: 1, tokens: 21_300, ms: 47_000 },
      { loop: 1, role: "judge:harsh", attempts: 1, tokens: 6_100, ms: 12_000 },
      { loop: 1, role: "judge:balanced", attempts: 1, tokens: 6_050, ms: 12_300 },
      { loop: 1, role: "reconciler", attempts: 1, tokens: 4_200, ms: 9_000 },
      { loop: 2, role: "reconciler", attempts: 1, tokens: 4_180, ms: 8_700 },
    ],
  };
}
