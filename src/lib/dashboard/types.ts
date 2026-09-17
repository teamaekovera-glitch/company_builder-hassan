// Dashboard wire types — shared by the operator UI components, fixtures, and
// (later) the SSE layer. Nothing here imports from the pipeline engine: the
// dashboard is presentational and consumes only these plain shapes.

export type Depth = "standard" | "deep" | "extreme";
export type Language = "en" | "es" | "de" | "ja" | "hi";

/** Stage lifecycle on the board. Mirrors the spec's consequential states. */
export type StageStatus = "queued" | "running" | "done" | "failed" | "blocked";

export type RunStatus = "empty" | "running" | "done" | "failed";

export interface DepthOption {
  value: Depth;
  label: string;
  description: string;
  loopCap: number;
}

export interface LanguageOption {
  code: Language;
  label: string;
  nativeLabel: string;
}

/** What the config screen edits before a run exists. */
export interface RunConfigDraft {
  idea: string;
  depth: Depth;
  languages: Language[];
}

/**
 * Pre-flight volume estimate: depth matrix x price table (spec invariant —
 * the app's largest operational risk, surfaced before Build Company confirms).
 */
export interface PreflightEstimate {
  estimatedCalls: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
  estimatedHours: number;
  loopCap: number;
  languageCount: number;
}

/** One stage card on the progress board — six live figures per the spec. */
export interface StageCardData {
  stageId: string;
  title: string;
  waveIndex: number;
  status: StageStatus;
  loop: number;
  loopCap: number;
  tokens: number;
  elapsedMs: number;
  score: number | null;
  calls: number;
  /** Verbatim provider error, quoted on the card when status is failed. */
  errorMessage?: string;
  /** Shown on blocked cards — which dependency caused the block. */
  blockedBy?: string;
}

export interface WaveColumnData {
  waveIndex: number;
  label: string;
  stages: StageCardData[];
}

/** Top-bar header metrics, live. */
export interface RunMetrics {
  status: RunStatus;
  tokens: number;
  calls: number;
  elapsedMs: number;
  costUsd: number;
  tokensPerSec: number;
}

export interface ScoreDimension {
  label: string;
  score: number;
}

export interface JudgeScore {
  judge: string;
  dimensions: ScoreDimension[];
  overall: number;
}

export interface LoopHistoryEntry {
  loop: number;
  role: string;
  attempts: number;
  tokens: number;
  ms: number;
}

/** Full stage history behind the detail tabs. */
export interface StageDetailData {
  stageId: string;
  title: string;
  status: StageStatus;
  drafts: { generator: string; text: string }[];
  merged: string;
  critiques: { critic: string; text: string }[];
  improved: string;
  scores: JudgeScore[];
  reconciledScore: number | null;
  translations: { code: Language; label: string; text: string }[];
  /** Single-file HTML mockup — rendered in a sandboxed iframe, never injected. */
  mockupHtml: string | null;
  loopHistory: LoopHistoryEntry[];
}

export type StageDetailTab =
  | "drafts"
  | "merged"
  | "critiques"
  | "improved"
  | "scores"
  | "translations"
  | "mockup"
  | "loop-history";

export const STAGE_DETAIL_TABS: { id: StageDetailTab; label: string }[] = [
  { id: "drafts", label: "Drafts" },
  { id: "merged", label: "Merged" },
  { id: "critiques", label: "Critiques" },
  { id: "improved", label: "Improved" },
  { id: "scores", label: "Scores" },
  { id: "translations", label: "Translations" },
  { id: "mockup", label: "Mockup" },
  { id: "loop-history", label: "Loop history" },
];
