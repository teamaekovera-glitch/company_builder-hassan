"use client";

// Run header: live top-bar metrics — tokens, calls, elapsed, cost, and a
// tokens-per-second gauge that moves with the current wave.

import { formatElapsed, formatTokens, formatUsd, gaugeFraction } from "@/lib/dashboard/format";
import type { RunMetrics, RunStatus } from "@/lib/dashboard/types";

const MAX_TOKENS_PER_SEC = 500; // gauge ceiling — 160 tok/s sits mid-gauge

const STATUS_LABEL: Record<RunStatus, string> = {
  empty: "no run",
  queued: "queued",
  running: "running",
  done: "done",
  failed: "failed",
};

export default function RunHeader({ metrics }: { metrics: RunMetrics }) {
  const fraction = gaugeFraction(metrics.tokensPerSec, MAX_TOKENS_PER_SEC);

  return (
    <header
      data-testid="run-header"
      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950/60 px-5 py-4"
    >
      <span
        data-testid="run-header-status"
        className={`rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
          metrics.status === "running"
            ? "bg-sky-500/20 text-sky-300"
            : metrics.status === "done"
              ? "bg-emerald-500/20 text-emerald-300"
              : metrics.status === "failed"
                ? "bg-rose-500/20 text-rose-300"
                : "bg-zinc-800 text-zinc-400"
        }`}
      >
        {STATUS_LABEL[metrics.status]}
      </span>

      <dl className="flex flex-wrap items-center gap-x-8 gap-y-2">
        <div data-testid="header-tokens">
          <dt className="text-[10px] uppercase tracking-wider text-zinc-500">Tokens</dt>
          <dd className="font-mono text-lg text-zinc-100">{formatTokens(metrics.tokens)}</dd>
        </div>
        <div data-testid="header-calls">
          <dt className="text-[10px] uppercase tracking-wider text-zinc-500">AI calls</dt>
          <dd className="font-mono text-lg text-zinc-100">{metrics.calls}</dd>
        </div>
        <div data-testid="header-elapsed">
          <dt className="text-[10px] uppercase tracking-wider text-zinc-500">Elapsed</dt>
          <dd className="font-mono text-lg text-zinc-100">{formatElapsed(metrics.elapsedMs)}</dd>
        </div>
        <div data-testid="header-cost">
          <dt className="text-[10px] uppercase tracking-wider text-zinc-500">Est. cost</dt>
          <dd className="font-mono text-lg text-zinc-100">{formatUsd(metrics.costUsd)}</dd>
        </div>
        <div data-testid="header-tps" className="min-w-40">
          <dt className="text-[10px] uppercase tracking-wider text-zinc-500">Tokens / sec</dt>
          <dd className="font-mono text-lg text-zinc-100">
            {metrics.tokensPerSec}
            <span className="ml-2 inline-block h-1.5 w-28 overflow-hidden rounded-full bg-zinc-800 align-middle">
              <span
                data-testid="header-tps-gauge"
                className="block h-full rounded-full bg-sky-400"
                style={{ width: `${Math.round(fraction * 100)}%` }}
              />
            </span>
          </dd>
        </div>
      </dl>
    </header>
  );
}
