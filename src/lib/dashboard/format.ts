// Pure display formatters for the dashboard. No React, no state — trivially
// unit-testable and shared by cards, header, and estimate panel.

/** 940 → "940", 12300 → "12.3k", 4200000 → "4.20M" */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** 0.42 → "$0.42", 12.5 → "$12.50" */
export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** 65000 → "1m 05s", 4500000 → "1h 15m 00s" */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  return `${minutes}m ${pad(seconds)}s`;
}

/** Reconciled score as the board shows it; null → "—". */
export function formatScore(score: number | null): string {
  if (score === null) return "—";
  return score.toFixed(1);
}

/** Fraction of the maximum the tokens-per-second gauge bar should span (0–1). */
export function gaugeFraction(tokensPerSec: number, maxTokensPerSec: number): number {
  if (maxTokensPerSec <= 0) return 0;
  return Math.min(1, Math.max(0, tokensPerSec / maxTokensPerSec));
}
