"use client";

/**
 * Operator dashboard shell (T8) — wires the T5 presentational components to
 * the T7 orchestration API:
 *
 *   config screen  →  POST /api/estimate (on first interaction)
 *                  →  POST /api/runs  →  POST /api/runs/:id/confirm
 *   run board      →  GET  /api/runs/:id snapshot (live SSE view lands in the
 *                     live-board slice; this slice paints from snapshots)
 *
 * All state transitions stay in this client component; the pure projections
 * (live-model) and transport (client-api, SSE hook) are separate modules.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import ConfigScreen from "@/components/ui/ConfigScreen";
import { MissingKeyBanner } from "@/components/ui/GlobalActions";
import RunHeader from "@/components/ui/RunHeader";
import WaveBoard from "@/components/ui/WaveBoard";
import type { ProviderInfoBody } from "@/lib/orchestrator/api";
import {
  confirmRun,
  createRun,
  fetchEstimate,
  fetchLatestRun,
  fetchProviderInfo,
  fetchSnapshot,
} from "@/lib/dashboard/client-api";
import { DEFAULT_CONFIG } from "@/lib/dashboard/fixtures";
import { runMetrics, stageCards, type RunLiveState } from "@/lib/dashboard/live-model";
import { useLiveRun } from "@/lib/dashboard/use-live-run";
import type { RunStatus as StoreRunStatus } from "@/lib/store/schema";
import type { PreflightEstimate, RunConfigDraft } from "@/lib/dashboard/types";

type Phase = { kind: "loading" } | { kind: "config" } | { kind: "board"; runId: string };

export default function OperatorDashboard() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [provider, setProvider] = useState<ProviderInfoBody | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setPhase({ kind: "loading" });
    setLoadError(null);
    // The latest run owns the screen (spec §8: the dashboard shows the run in
    // progress); the config screen is reachable from any terminal board.
    Promise.all([fetchProviderInfo(), fetchLatestRun()])
      .then(([info, latest]) => {
        setProvider(info);
        setPhase(latest ? { kind: "board", runId: latest.id } : { kind: "config" });
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : String(err));
        setPhase({ kind: "config" });
      });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <main className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
            Autonomous Company Builder
          </h1>
          <span className="text-xs text-zinc-500" data-testid="provider-line">
            {provider
              ? `provider: ${provider.provider}${provider.hasKey ? "" : " — key missing"}`
              : "checking provider…"}
          </span>
        </div>

        {provider && !provider.hasKey ? <MissingKeyBanner /> : null}

        {phase.kind === "loading" ? (
          <p data-testid="dashboard-loading" className="py-24 text-center text-sm text-zinc-500">
            Loading…
          </p>
        ) : phase.kind === "config" ? (
          <ConfigView provider={provider} onStarted={(runId) => setPhase({ kind: "board", runId })} />
        ) : (
          <RunView runId={phase.runId} onNewRun={() => setPhase({ kind: "config" })} />
        )}

        {loadError ? (
          <div data-testid="load-error" role="alert" className="rounded-lg border border-rose-900 bg-rose-950/40 p-4">
            <p className="text-sm text-rose-300">{loadError}</p>
            <button
              type="button"
              onClick={reload}
              className="mt-2 rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500"
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

/** Config → estimate → explicit confirm → create+confirm the run. */
function ConfigView({
  provider,
  onStarted,
}: {
  provider: ProviderInfoBody | null;
  onStarted: (runId: string) => void;
}) {
  const [draft, setDraft] = useState<RunConfigDraft>(DEFAULT_CONFIG);
  const [estimate, setEstimate] = useState<PreflightEstimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // The pre-flight estimate appears on first interaction (spec §8 flow), not
  // on the untouched screen.
  const interacted = useRef(false);

  useEffect(() => {
    if (!interacted.current) return;
    // Debounce: one estimate per pause in typing, not one per keystroke.
    const timer = setTimeout(() => {
      fetchEstimate(draft)
        .then((est) => {
          setEstimate(est);
          setEstimateError(null);
        })
        .catch((err: unknown) => {
          // Server messages arrive verbatim (validation fields, bad depth…).
          setEstimateError(err instanceof Error ? err.message : String(err));
          setEstimate(null);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [draft]);

  const touch = useCallback((next: RunConfigDraft) => {
    interacted.current = true;
    setDraft(next);
  }, []);

  const startRun = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      // Create (queued — nothing spent yet), then the explicit confirm gate
      // (spec: "nothing runs until the operator confirms the estimate").
      const runId = await createRun(draft);
      await confirmRun(runId);
      onStarted(runId);
    } catch (err) {
      // Verbatim: validation fields, missing-key message, provider errors.
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }, [draft, onStarted]);

  return (
    <div className="space-y-4">
      <ConfigScreen
        config={draft}
        estimate={estimate}
        onIdeaChange={(idea) => touch({ ...draft, idea })}
        onDepthChange={(depth) => touch({ ...draft, depth })}
        onToggleLanguage={(code) =>
          touch({
            ...draft,
            languages: draft.languages.includes(code)
              ? draft.languages.filter((lang) => lang !== code)
              : [...draft.languages, code],
          })
        }
        onBuild={startRun}
        disabledReason={starting ? "Creating run…" : undefined}
      />
      {estimateError ? (
        <p role="alert" data-testid="estimate-error" className="text-sm text-amber-300">
          {estimateError}
        </p>
      ) : null}
      {startError ? (
        <p role="alert" data-testid="start-error" className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-300">
          {startError}
        </p>
      ) : null}
      {provider === null ? (
        <p className="text-xs text-zinc-600">Provider status unavailable — starting a run may fail.</p>
      ) : null}
    </div>
  );
}

/** Run board for one run — SSE replay is the source of truth (no polling). */
function RunView({ runId, onNewRun }: { runId: string; onNewRun: () => void }) {
  // The event stream rebuilds the whole board; the snapshot only seeds the
  // depth and the run status shown before the first replay lands.
  const { state, connected } = useLiveRun(runId);
  const [depth, setDepth] = useState<RunConfigDraft["depth"] | null>(null);
  const [fallbackStatus, setFallbackStatus] = useState<StoreRunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchSnapshot(runId)
      .then((snapshot) => {
        if (cancelled) return;
        setDepth(snapshot.config.depth);
        setFallbackStatus(snapshot.status);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [runId, reloadKey]);

  const confirm = useCallback(async () => {
    setConfirming(true);
    try {
      await confirmRun(runId);
      setReloadKey((key) => key + 1);
    } finally {
      setConfirming(false);
    }
  }, [runId]);

  if (error) {
    return (
      <div data-testid="run-error" role="alert" className="rounded-lg border border-rose-900 bg-rose-950/40 p-4">
        <p className="text-sm text-rose-300">{error}</p>
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          className="mt-2 rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!depth) {
    return (
      <p data-testid="run-loading" className="py-24 text-center text-sm text-zinc-500">
        Loading run…
      </p>
    );
  }

  // Before the stream's run event lands (a queued run emits none of its own
  // until confirmed), the snapshot status paints the header and confirm panel.
  const displayState: RunLiveState =
    state.runStatus === "unknown" && fallbackStatus !== null
      ? { ...state, runStatus: fallbackStatus }
      : state;

  return (
    <div className="space-y-4" data-testid="run-view">
      <RunHeader metrics={runMetrics(displayState)} />
      <p
        data-testid="stream-status"
        className={`text-xs ${connected ? "text-emerald-400" : "text-amber-400"}`}
      >
        {connected ? "● Live — streaming events" : "○ Connecting / re-attaching…"}
      </p>
      {displayState.runStatus === "queued" ? (
        <div
          data-testid="confirm-panel"
          className="rounded-lg border border-amber-900 bg-amber-950/30 p-4"
        >
          <p className="text-sm text-amber-200">
            Run created — awaiting your confirmation. Nothing has been spent yet.
          </p>
          <button
            type="button"
            data-testid="confirm-run"
            disabled={confirming}
            onClick={() => void confirm()}
            className="mt-3 rounded bg-amber-500 px-4 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
          >
            Confirm and start
          </button>
        </div>
      ) : null}
      {displayState.runStatus === "interrupted" ? (
        <p data-testid="interrupted-banner" role="alert" className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-300">
          The server restarted during this run — it is recorded as interrupted.
        </p>
      ) : null}
      <WaveBoard waves={stageCards(displayState, depth)} />
      {displayState.runStatus === "completed" || displayState.runStatus === "failed" || displayState.runStatus === "interrupted" ? (
        <button
          type="button"
          data-testid="new-run"
          onClick={onNewRun}
          className="rounded border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
        >
          Start a new run
        </button>
      ) : null}
    </div>
  );
}
