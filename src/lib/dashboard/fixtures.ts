// Static fixture data for the dashboard components and the preview page.
// Mirrors the spec's wave map (5 build waves + later passes collapsed into a
// "Passes 27–39" column) and every consequential state a card can show.

import type {
  DepthOption,
  LanguageOption,
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

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "es", label: "Spanish", nativeLabel: "Español" },
  { code: "de", label: "German", nativeLabel: "Deutsch" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी" },
];

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

/** A completed stage whose full history feeds the detail tabs. */
export function buildStageDetail(): StageDetailData {
  return {
    stageId: "market-analysis",
    title: "Market Analysis",
    status: "done",
    drafts: [
      { generator: "Generator A", text: "Draft A — TAM/SAM/SOM by region with five-year forecast…" },
      { generator: "Generator B", text: "Draft B — bottom-up demand model anchored on 15 data-backed insights…" },
      { generator: "Generator C", text: "Draft C — regulation-by-country scan with risk shading…" },
    ],
    merged: "Merged draft — best of A, B, C reconciled into one narrative with citations…",
    critiques: [
      { critic: "Critic 1", text: "Methodology: the five-year forecast lacks a stated CAGR source…" },
      { critic: "Critic 2", text: "Evidence: three competitor claims are unsourced…" },
      { critic: "Critic 3", text: "Structure: SOM section buries the regional split…" },
    ],
    improved: "Improved draft — forecast re-sourced, competitor claims cited, SOM split by region…",
    scores: [
      {
        judge: "Judge 1",
        dimensions: [
          { label: "Accuracy", score: 9.3 },
          { label: "Depth", score: 9.0 },
          { label: "Clarity", score: 9.4 },
        ],
        overall: 9.2,
      },
      {
        judge: "Judge 2",
        dimensions: [
          { label: "Accuracy", score: 9.1 },
          { label: "Depth", score: 9.2 },
          { label: "Clarity", score: 9.3 },
        ],
        overall: 9.2,
      },
    ],
    reconciledScore: 9.2,
    translations: [
      { code: "es", label: "Spanish", text: "Análisis de mercado — TAM/SAM/SOM por región…" },
      { code: "de", label: "German", text: "Marktanalyse — TAM/SAM/SOM nach Region…" },
      { code: "ja", label: "Japanese", text: "市場分析 — 地域別のTAM/SAM/SOM…" },
      { code: "hi", label: "Hindi", text: "बाज़ार विश्लेषण — क्षेत्र अनुसार TAM/SAM/SOM…" },
    ],
    mockupHtml: "<main><h1>Market Analysis mockup</h1><p>Single-file HTML rendered sandboxed.</p></main>",
    loopHistory: [
      { loop: 1, role: "generator:A", attempts: 1, tokens: 14_200, ms: 41_000 },
      { loop: 1, role: "generator:B", attempts: 1, tokens: 13_800, ms: 39_500 },
      { loop: 1, role: "generator:C", attempts: 1, tokens: 14_050, ms: 40_200 },
      { loop: 1, role: "merger", attempts: 1, tokens: 18_600, ms: 33_000 },
      { loop: 1, role: "critic:1", attempts: 2, tokens: 9_400, ms: 21_000 },
      { loop: 1, role: "improver", attempts: 1, tokens: 21_300, ms: 47_000 },
      { loop: 1, role: "judge:1", attempts: 1, tokens: 6_100, ms: 12_000 },
      { loop: 1, role: "judge:2", attempts: 1, tokens: 6_050, ms: 12_300 },
      { loop: 1, role: "reconciler", attempts: 1, tokens: 4_200, ms: 9_000 },
      { loop: 2, role: "reconciler", attempts: 1, tokens: 4_180, ms: 8_700 },
    ],
  };
}
