"use client";

// Global actions: rerun controls and download buttons. Callbacks only —
// wiring to the run API happens in the orchestration task, not here.

export function RerunControls({
  onRerunStricter,
  onAlternatives,
}: {
  onRerunStricter: () => void;
  onAlternatives: () => void;
}) {
  return (
    <div data-testid="rerun-controls" className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid="rerun-stricter"
        onClick={onRerunStricter}
        className="rounded-lg border border-violet-500/60 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-300 hover:bg-violet-500/20"
      >
        Re-run with stricter critic (9.5 gate)
      </button>
      <button
        type="button"
        data-testid="rerun-alternatives"
        onClick={onAlternatives}
        className="rounded-lg border border-violet-500/60 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-300 hover:bg-violet-500/20"
      >
        Generate 3 alternative companies
      </button>
    </div>
  );
}

/**
 * Downloads activate when the run completes; before that the buttons render
 * disabled with the reason (spec: Done state — "downloads activate").
 */
export function DownloadButtons({
  onDownloadDossier,
  onDownloadRunLog,
  disabledReason,
}: {
  onDownloadDossier: () => void;
  onDownloadRunLog: () => void;
  disabledReason?: string;
}) {
  const buttonClass = disabledReason
    ? "cursor-not-allowed rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-600"
    : "rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-zinc-400";

  return (
    <div data-testid="download-buttons" className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid="download-dossier"
        onClick={onDownloadDossier}
        disabled={Boolean(disabledReason)}
        title={disabledReason}
        className={buttonClass}
      >
        Download full dossier (Markdown)
      </button>
      <button
        type="button"
        data-testid="download-run-log"
        onClick={onDownloadRunLog}
        disabled={Boolean(disabledReason)}
        title={disabledReason}
        className={buttonClass}
      >
        Download run log (verbatim)
      </button>
      {disabledReason ? (
        <span data-testid="download-disabled-reason" className="text-xs text-zinc-500">
          {disabledReason}
        </span>
      ) : null}
    </div>
  );
}


/** Spec consequential state: run created without AI_API_KEY — explicit banner, never a silent hang. */
export function MissingKeyBanner() {
  return (
    <div
      role="alert"
      data-testid="missing-key-banner"
      className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
    >
      <strong className="font-semibold">Missing provider key.</strong> The server has no{" "}
      <code className="font-mono">AI_API_KEY</code> set. Export{" "}
      <code className="font-mono">AI_API_KEY</code> (and optionally{" "}
      <code className="font-mono">AI_BASE_URL</code>, <code className="font-mono">AI_MODEL</code>)
      on the server process, then re-run. No calls have been made.
    </div>
  );
}
