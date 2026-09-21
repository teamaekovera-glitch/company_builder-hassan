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
import { DownloadButtons, MissingKeyBanner, RerunControls } from "@/components/ui/GlobalActions";
import RunHeader from "@/components/ui/RunHeader";
import StageDetailPanel from "@/components/ui/StageDetail";
import WaveBoard from "@/components/ui/WaveBoard";
import type { ProviderInfoBody } from "@/lib/orchestrator/api";
import {
  compareAlternatives,
  confirmRun,
  createRun,
  dossierUrl,
  fetchEstimate,
  fetchLatestRun,
  fetchProviderInfo,
  fetchSnapshot,
  fetchStageDetail,
  rerunAlternatives,
  rerunStricter,
  runLogUrl,
  type RerunCreated,
} from "@/lib/dashboard/client-api";
import { DEFAULT_CONFIG } from "@/lib/dashboard/fixtures";
import { runMetrics, stageCards, type RunLiveState } from "@/lib/dashboard/live-model";
import { useLiveRun } from "@/lib/dashboard/use-live-run";
import type { RunStatus as StoreRunStatus } from "@/lib/store/schema";
import type { PreflightEstimate, RunConfigDraft, StageDetailData, StageDetailTab } from "@/lib/dashboard/types";

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
          <RunView
            runId={phase.runId}
            onNewRun={() => setPhase({ kind: "config" })}
            onSwitchRun={(newRunId) => setPhase({ kind: "board", runId: newRunId })}
          />
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
function RunView({
  runId,
  onNewRun,
  onSwitchRun,
}: {
  runId: string;
  onNewRun: () => void;
  onSwitchRun: (runId: string) => void;
}) {
  // The event stream rebuilds the whole board; the snapshot only seeds the
  // depth and the run status shown before the first replay lands.
  const { state, connected } = useLiveRun(runId);
  const [depth, setDepth] = useState<RunConfigDraft["depth"] | null>(null);
  const [fallbackStatus, setFallbackStatus] = useState<StoreRunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  // Stage detail: clicking a card opens its full history (T9).
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  // Rerun controls (T9): created runs are listed with their own explicit
  // confirm buttons — a rerun never spends without the operator's confirm.
  const [createdReruns, setCreatedReruns] = useState<RerunCreated[]>([]);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [rerunBusy, setRerunBusy] = useState(false);

  const doRerunStricter = useCallback(async () => {
    if (rerunBusy) return;
    setRerunBusy(true);
    setRerunError(null);
    try {
      const created = await rerunStricter(runId);
      onSwitchRun(created.runId);
    } catch (err) {
      setRerunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRerunBusy(false);
    }
  }, [rerunBusy, runId, onSwitchRun]);

  const doRerunAlternatives = useCallback(async () => {
    if (rerunBusy) return;
    setRerunBusy(true);
    setRerunError(null);
    try {
      setCreatedReruns(await rerunAlternatives(runId));
    } catch (err) {
      setRerunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRerunBusy(false);
    }
  }, [rerunBusy, runId]);

  const doCompareAlternatives = useCallback(async () => {
    if (createdReruns.length === 0) return;
    setRerunError(null);
    try {
      await compareAlternatives(
        runId,
        createdReruns.map((run) => run.runId),
      );
    } catch (err) {
      setRerunError(err instanceof Error ? err.message : String(err));
    }
  }, [createdReruns, runId]);

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
      <WaveBoard
        waves={stageCards(displayState, depth)}
        selectedStageId={selectedStageId}
        onSelectStage={(card) => setSelectedStageId(card.stageId)}
      />
      {selectedStageId ? (
        <StageDetailSection
          key={selectedStageId}
          runId={runId}
          stageId={selectedStageId}
          onClose={() => setSelectedStageId(null)}
        />
      ) : null}
      {displayState.runStatus === "completed" || displayState.runStatus === "failed" || displayState.runStatus === "interrupted" ? (
        <div data-testid="global-actions" className="flex flex-col gap-3">
          <RerunControls onRerunStricter={() => void doRerunStricter()} onAlternatives={() => void doRerunAlternatives()} />
          {rerunError ? (
            <p role="alert" data-testid="rerun-error" className="text-xs text-rose-300">
              {rerunError}
            </p>
          ) : null}
          {createdReruns.length > 0 ? (
            <div
              data-testid="rerun-notice"
              className="flex flex-col gap-2 rounded-lg border border-violet-500/40 bg-violet-500/5 p-3"
            >
              <p className="text-xs text-violet-200">
                {createdReruns.length} fresh run{createdReruns.length === 1 ? "" : "s"} created — nothing is spent
                until you confirm each one. The original run and its artifacts are untouched.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {createdReruns.map((run) => (
                  <button
                    key={run.runId}
                    type="button"
                    data-testid={`confirm-rerun-${run.runId}`}
                    onClick={() =>
                      void confirmRun(run.runId).catch((err: unknown) =>
                        setRerunError(err instanceof Error ? err.message : String(err)),
                      )
                    }
                    className="rounded border border-violet-500/60 px-2 py-1 text-xs font-semibold text-violet-200 hover:bg-violet-500/20"
                  >
                    Confirm run {run.runId}
                  </button>
                ))}
                <button
                  type="button"
                  data-testid="compare-alternatives"
                  onClick={() => void doCompareAlternatives()}
                  className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-xs font-semibold text-zinc-200 hover:border-zinc-400"
                >
                  Compare alternatives
                </button>
              </div>
            </div>
          ) : null}
          <DownloadButtons
            onDownloadDossier={() => window.location.assign(dossierUrl(runId))}
            onDownloadRunLog={() => window.location.assign(runLogUrl(runId))}
          />
          <button
            type="button"
            data-testid="new-run"
            onClick={onNewRun}
            className="w-fit rounded border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
          >
            Start a new run
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Stage detail over real data (T9): fetches the stage's full history when the
 * operator opens a card, surfacing loading / verbatim-error states explicitly.
 */
function StageDetailSection({
  runId,
  stageId,
  onClose,
}: {
  runId: string;
  stageId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<StageDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<StageDetailTab>("drafts");
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchStageDetail(runId, stageId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [runId, stageId]);

  if (error) {
    return (
      <div data-testid="stage-detail-error" role="alert" className="rounded-lg border border-rose-900 bg-rose-950/40 p-4">
        <p className="text-sm text-rose-300">{error}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500"
        >
          Close
        </button>
      </div>
    );
  }

  if (!detail) {
    return (
      <p data-testid="stage-detail-loading" className="py-8 text-center text-sm text-zinc-500">
        Loading stage history…
      </p>
    );
  }

  return (
    <StageDetailPanel
      detail={detail}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      activeLanguage={activeLanguage}
      onLanguageChange={setActiveLanguage}
      onClose={onClose}
    />
  );
}

