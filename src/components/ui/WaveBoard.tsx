"use client";

// Progress board: one column per wave, one card per stage. Each card carries
// the six live figures from the spec — status, loop iteration, tokens,
// elapsed, score, calls. Purely presentational; the parent owns selection.

import { formatElapsed, formatScore, formatTokens } from "@/lib/dashboard/format";
import type { StageCardData, StageStatus, WaveColumnData } from "@/lib/dashboard/types";

const STATUS_STYLES: Record<StageStatus, { badge: string; card: string; label: string }> = {
  queued: {
    badge: "bg-zinc-800 text-zinc-400",
    card: "border-zinc-800 bg-zinc-900/50",
    label: "queued",
  },
  running: {
    badge: "bg-sky-500/20 text-sky-300",
    card: "border-sky-500/60 bg-sky-500/5",
    label: "running",
  },
  done: {
    badge: "bg-emerald-500/20 text-emerald-300",
    card: "border-emerald-500/40 bg-emerald-500/5",
    label: "done",
  },
  failed: {
    badge: "bg-rose-500/20 text-rose-300",
    card: "border-rose-500/60 bg-rose-500/5",
    label: "failed",
  },
  blocked: {
    badge: "bg-amber-500/20 text-amber-300",
    card: "border-amber-500/40 bg-amber-500/5",
    label: "blocked",
  },
};

export function StageCard({
  stage,
  selected,
  onSelect,
}: {
  stage: StageCardData;
  selected?: boolean;
  onSelect?: (stage: StageCardData) => void;
}) {
  const styles = STATUS_STYLES[stage.status];
  const interactive = onSelect !== undefined;

  return (
    <button
      type="button"
      data-testid={`stage-card-${stage.stageId}`}
      data-status={stage.status}
      onClick={onSelect ? () => onSelect(stage) : undefined}
      aria-label={`${stage.title} — ${styles.label}`}
      className={`w-full rounded-lg border p-3 text-left transition-colors ${styles.card} ${
        interactive ? "cursor-pointer hover:border-sky-400" : "cursor-default"
      } ${selected ? "ring-1 ring-sky-400" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-zinc-100">{stage.title}</span>
        <span
          data-testid={`stage-status-${stage.stageId}`}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles.badge} ${
            stage.status === "running" ? "animate-pulse" : ""
          }`}
        >
          {styles.label}
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 font-mono text-[11px] text-zinc-400">
        <div data-testid={`stage-loop-${stage.stageId}`}>
          <dt className="sr-only">Loop</dt>
          <dd>
            loop {stage.loop}/{stage.loopCap}
          </dd>
        </div>
        <div data-testid={`stage-tokens-${stage.stageId}`}>
          <dt className="sr-only">Tokens</dt>
          <dd>{formatTokens(stage.tokens)} tok</dd>
        </div>
        <div data-testid={`stage-elapsed-${stage.stageId}`}>
          <dt className="sr-only">Elapsed</dt>
          <dd>{formatElapsed(stage.elapsedMs)}</dd>
        </div>
        <div data-testid={`stage-score-${stage.stageId}`}>
          <dt className="sr-only">Score</dt>
          <dd>score {formatScore(stage.score)}</dd>
        </div>
        <div data-testid={`stage-calls-${stage.stageId}`}>
          <dt className="sr-only">Calls</dt>
          <dd>{stage.calls} calls</dd>
        </div>
      </dl>

      {stage.status === "failed" && stage.errorMessage ? (
        <p
          data-testid={`stage-error-${stage.stageId}`}
          className="mt-2 rounded bg-rose-500/10 px-2 py-1 font-mono text-[11px] text-rose-300"
        >
          {stage.errorMessage}
        </p>
      ) : null}
      {stage.status === "blocked" && stage.blockedBy ? (
        <p
          data-testid={`stage-blocked-by-${stage.stageId}`}
          className="mt-2 font-mono text-[11px] text-amber-300/90"
        >
          blocked by {stage.blockedBy} — run continues elsewhere
        </p>
      ) : null}
    </button>
  );
}

export default function WaveBoard({
  waves,
  selectedStageId,
  onSelectStage,
}: {
  waves: WaveColumnData[];
  selectedStageId?: string | null;
  onSelectStage?: (stage: StageCardData) => void;
}) {
  return (
    <div
      data-testid="wave-board"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5"
    >
      {waves.map((wave) => (
        <section
          key={wave.waveIndex}
          aria-label={wave.label}
          data-testid={`wave-column-${wave.waveIndex}`}
          className="flex min-w-0 flex-col gap-2"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            {wave.label}
          </h3>
          {wave.stages.map((stage) => (
            <StageCard
              key={stage.stageId}
              stage={stage}
              selected={stage.stageId === selectedStageId}
              onSelect={onSelectStage}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
