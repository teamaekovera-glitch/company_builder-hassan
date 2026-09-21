"use client";

// Stage detail panel (T9): the full history behind a clicked card, in tabs,
// over real store rows. Every tab renders the verbatim artifact for the
// selected loop iteration; the winning iteration is highlighted wherever it
// appears. The mockup tab renders generated HTML in a sandboxed iframe —
// the HTML is never injected into the app DOM.

import { useState } from "react";
import { STAGE_DETAIL_TABS, type StageDetailData, type StageDetailTab } from "@/lib/dashboard/types";
import { formatElapsed, formatTokens } from "@/lib/dashboard/format";

function ArtifactBlock({ label, text, winning = false }: { label: string; text: string; winning?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        winning ? "border-emerald-500/50 bg-emerald-500/5" : "border-zinc-800 bg-zinc-900/70"
      }`}
    >
      <h4 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {label}
        {winning ? (
          <span
            data-testid="winner-badge"
            className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300"
          >
            winning iteration
          </span>
        ) : null}
      </h4>
      <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-300">{text}</p>
    </div>
  );
}

/** Iteration chips for the round-scoped tabs; the winning round carries a marker. */
function RoundPicker({
  rounds,
  selected,
  winningRound,
  onSelect,
}: {
  rounds: number[];
  selected: number | null;
  winningRound: number | null;
  onSelect: (round: number) => void;
}) {
  return (
    <div role="tablist" aria-label="Loop iteration" data-testid="round-picker" className="flex flex-wrap items-center gap-1">
      {rounds.map((round) => {
        const selectedClass = round === selected ? "bg-sky-500/20 text-sky-300" : "text-zinc-400 hover:bg-zinc-800";
        return (
          <button
            key={round}
            type="button"
            role="tab"
            aria-selected={round === selected}
            data-testid={`round-${round}`}
            onClick={() => onSelect(round)}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${selectedClass}`}
          >
            Iteration {round}
            {round === winningRound ? (
              <span data-testid={`round-winner-${round}`} className="text-[10px] font-semibold text-emerald-300">
                ★ winner
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function EmptyNote({ testId, children }: { testId: string; children: string }) {
  return (
    <p data-testid={testId} className="text-xs text-zinc-500">
      {children}
    </p>
  );
}

export function StageDetailPanel({
  detail,
  activeTab,
  onTabChange,
  activeLanguage,
  onLanguageChange,
  onClose,
}: {
  detail: StageDetailData;
  activeTab: StageDetailTab;
  onTabChange: (tab: StageDetailTab) => void;
  activeLanguage: string | null;
  onLanguageChange: (code: string) => void;
  onClose?: () => void;
}) {
  const selectedTranslation =
    detail.translations.find((t) => t.code === activeLanguage) ?? detail.translations[0];

  // Round-scoped tabs share one iteration selection, defaulting to the
  // winning iteration (else the latest). The parent remounts the panel per
  // stage (key=stageId), so this state resets when the operator switches stage.
  const availableRounds = [...new Set([...detail.improved.map((i) => i.round), ...detail.scoreRounds.map((s) => s.round), ...detail.critiques.map((c) => c.round)])].sort((a, b) => a - b);
  const [selectedRound, setSelectedRound] = useState<number | null>(
    detail.winningRound ?? availableRounds.at(-1) ?? null,
  );
  const round = selectedRound ?? null;

  const selectedCritiques = detail.critiques.filter((c) => c.round === round);
  const selectedImproved = detail.improved.find((i) => i.round === round);
  const selectedScores = detail.scoreRounds.find((s) => s.round === round);

  return (
    <section
      aria-label={`Stage detail — ${detail.title}`}
      data-testid="stage-detail"
      className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">{detail.title} — full history</h3>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-zinc-400">
            reconciled{" "}
            {selectedScores?.reconciled === null || selectedScores?.reconciled === undefined
              ? "—"
              : selectedScores.reconciled.toFixed(1)}
          </span>
          {onClose ? (
            <button
              type="button"
              data-testid="stage-detail-close"
              onClick={onClose}
              aria-label="Close stage detail"
              className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Stage detail tabs"
        data-testid="stage-detail-tabs"
        className="flex flex-wrap gap-1 border-b border-zinc-800 pb-2"
      >
        {STAGE_DETAIL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeTab}
            data-testid={`tab-${tab.id}`}
            onClick={() => onTabChange(tab.id)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              tab.id === activeTab
                ? "bg-sky-500/20 text-sky-300"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div data-testid={`panel-${activeTab}`} className="flex flex-col gap-2">
        {activeTab === "drafts" &&
          (detail.drafts.length > 0 ? (
            detail.drafts.map((draft) => (
              <ArtifactBlock key={draft.generator} label={draft.generator} text={draft.text} />
            ))
          ) : (
            <EmptyNote testId="drafts-empty">No drafts yet — the stage has not started.</EmptyNote>
          ))}

        {activeTab === "merged" &&
          (detail.merged ? (
            <ArtifactBlock label="Merged" text={detail.merged} />
          ) : (
            <EmptyNote testId="merged-empty">No merged draft yet — the generators have not finished.</EmptyNote>
          ))}

        {activeTab === "critiques" && (
          <>
            {availableRounds.length > 0 ? (
              <RoundPicker
                rounds={availableRounds}
                selected={round}
                winningRound={detail.winningRound}
                onSelect={setSelectedRound}
              />
            ) : null}
            {selectedCritiques.length > 0 ? (
              selectedCritiques.map((critique) => (
                <ArtifactBlock key={critique.role} label={critique.critic} text={critique.text} />
              ))
            ) : (
              <EmptyNote testId="critiques-empty">
                No critiques for this iteration yet — the critics have not run.
              </EmptyNote>
            )}
          </>
        )}

        {activeTab === "improved" && (
          <>
            {availableRounds.length > 0 ? (
              <RoundPicker
                rounds={availableRounds}
                selected={round}
                winningRound={detail.winningRound}
                onSelect={setSelectedRound}
              />
            ) : null}
            {selectedImproved ? (
              <ArtifactBlock
                label={`Improved — iteration ${selectedImproved.round}`}
                text={selectedImproved.text}
                winning={selectedImproved.winning}
              />
            ) : (
              <EmptyNote testId="improved-empty">No improved draft yet — the improver has not run.</EmptyNote>
            )}
          </>
        )}

        {activeTab === "scores" && (
          <>
            {availableRounds.length > 0 ? (
              <RoundPicker
                rounds={availableRounds}
                selected={round}
                winningRound={detail.winningRound}
                onSelect={setSelectedRound}
              />
            ) : null}
            {selectedScores ? (
              <div className="flex flex-col gap-2">
                {selectedScores.judges.map((judge) => (
                  <div
                    key={judge.role}
                    data-testid={`score-${judge.role.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3"
                  >
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      {judge.judge}
                    </h4>
                    <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-300">
                      {judge.text}
                    </p>
                  </div>
                ))}
                <div
                  data-testid="reconciler-rationale"
                  className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3"
                >
                  <h4 className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-sky-300">
                    Reconciler rationale
                    <span className="font-mono text-sm text-emerald-300">
                      {selectedScores.reconciled === null ? "—" : `reconciled ${selectedScores.reconciled.toFixed(1)}`}
                    </span>
                  </h4>
                  {selectedScores.reconcilerRationale ? (
                    <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-300">
                      {selectedScores.reconcilerRationale}
                    </p>
                  ) : (
                    <p className="text-xs text-zinc-500">The reconciler has not recorded a rationale yet.</p>
                  )}
                </div>
              </div>
            ) : (
              <EmptyNote testId="scores-empty">No scores yet — the judges have not run.</EmptyNote>
            )}
          </>
        )}

        {activeTab === "translations" && (
          <div className="flex flex-col gap-2">
            {detail.translations.length > 0 ? (
              <>
                <div role="tablist" aria-label="Languages" className="flex flex-wrap gap-1">
                  {detail.translations.map((t) => (
                    <button
                      key={t.code}
                      type="button"
                      role="tab"
                      aria-selected={t.code === selectedTranslation?.code}
                      data-testid={`translation-lang-${t.code}`}
                      onClick={() => onLanguageChange(t.code)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                        t.code === selectedTranslation?.code
                          ? "bg-sky-500/20 text-sky-300"
                          : "text-zinc-400 hover:bg-zinc-800"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {selectedTranslation ? (
                  <ArtifactBlock
                    label={`${selectedTranslation.label} translation`}
                    text={selectedTranslation.text}
                  />
                ) : null}
              </>
            ) : (
              <p data-testid="translations-empty" className="text-xs text-zinc-500">
                No translations yet — the localisation pass has not reached this stage.
              </p>
            )}
          </div>
        )}

        {activeTab === "mockup" &&
          (detail.mockupHtml ? (
            // Sandboxed iframe only — generated mockup HTML is never injected
            // into the app itself (spec: System shape). The empty sandbox
            // attribute denies scripts, same-origin access, and form submission.
            <iframe
              title={`${detail.title} mockup`}
              data-testid="stage-mockup-frame"
              sandbox=""
              srcDoc={detail.mockupHtml}
              className="h-64 w-full rounded-lg border border-zinc-800 bg-white"
            />
          ) : (
            <p data-testid="mockup-empty" className="text-xs text-zinc-500">
              No mockup generated for this stage.
            </p>
          ))}

        {activeTab === "loop-history" && (
          <table data-testid="loop-history-table" className="text-left font-mono text-xs">
            <thead>
              <tr className="text-zinc-500">
                <th scope="col" className="py-1 pr-4">Loop</th>
                <th scope="col" className="py-1 pr-4">Role</th>
                <th scope="col" className="py-1 pr-4">Attempts</th>
                <th scope="col" className="py-1 pr-4">Tokens</th>
                <th scope="col" className="py-1">Duration</th>
              </tr>
            </thead>
            <tbody>
              {detail.loopHistory.map((entry, index) => (
                <tr
                  key={`${entry.loop}-${entry.role}-${index}`}
                  className="border-t border-zinc-800/60 text-zinc-300"
                >
                  <td className="py-1 pr-4">{entry.loop}</td>
                  <td className="py-1 pr-4">{entry.role}</td>
                  <td className="py-1 pr-4">{entry.attempts}</td>
                  <td className="py-1 pr-4">{formatTokens(entry.tokens)}</td>
                  <td className="py-1">{formatElapsed(entry.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export default StageDetailPanel;
