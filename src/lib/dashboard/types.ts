// Dashboard wire types — shared by the operator UI components, fixtures, and
// (later) the SSE layer. Nothing here imports from the pipeline engine: the
// dashboard is presentational and consumes only these plain shapes.

export type Depth = "standard" | "deep" | "extreme";
export type Language = "en" | "es" | "de" | "ja" | "hi";

/** Stage lifecycle on the board. Mirrors the spec's consequential states. */
export type StageStatus = "queued" | "running" | "done" | "failed" | "blocked";

/** Run lifecycle chip on the header — `queued` = created, awaiting confirmation. */
export type RunStatus = "empty" | "queued" | "running" | "done" | "failed";

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

export interface LoopHistoryEntry {
  loop: number;
  role: string;
  attempts: number;
  tokens: number;
  ms: number;
}

/** Native labels for the five languages — shared by the config screen, the stage-detail builder, and exports. */
export const LANGUAGE_LABELS: Record<Language, { label: string; nativeLabel: string }> = {
  en: { label: "English", nativeLabel: "English" },
  es: { label: "Spanish", nativeLabel: "Español" },
  de: { label: "German", nativeLabel: "Deutsch" },
  ja: { label: "Japanese", nativeLabel: "日本語" },
  hi: { label: "Hindi", nativeLabel: "हिन्दी" },
};

/** Operator-facing label for a language code. */
export function languageLabel(code: Language): string {
  return LANGUAGE_LABELS[code]?.label ?? code;
}

/**
 * One critic's verbatim artifact for one loop iteration. `role` is the
 * canonical role string (artifact kind prefix); `critic` is the operator-facing
 * label ("Critic 1 — pessimistic-vc").
 */
export interface CritiqueEntry {
  critic: string;
  role: string;
  round: number;
  text: string;
}

/** One improver output for one loop iteration; `winning` marks the deliverable. */
export interface ImprovedEntry {
  round: number;
  text: string;
  /** Reconciled score of this round's judging, when recorded. */
  score: number | null;
  winning: boolean;
}

/** One judge's verbatim round response — quoted exactly, never re-parsed. */
export interface JudgeEntry {
  judge: string;
  role: string;
  text: string;
}

/** The full scoring picture of one loop iteration. */
export interface ScoreRoundEntry {
  round: number;
  judges: JudgeEntry[];
  /** The reconciler's parsed final score for this round. */
  reconciled: number | null;
  /** The reconciler's verbatim rationale. */
  reconcilerRationale: string | null;
}

/** Full stage history behind the detail tabs, over real store rows. */
export interface StageDetailData {
  stageId: string;
  title: string;
  status: StageStatus;
  /** Executed critique rounds (0 for pass stages and stages not yet started). */
  rounds: number;
  /** Iteration whose improved artifact is the deliverable; null when none. */
  winningRound: number | null;
  drafts: { generator: string; text: string }[];
  merged: string;
  critiques: CritiqueEntry[];
  improved: ImprovedEntry[];
  scoreRounds: ScoreRoundEntry[];
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
