"use client";

// Stage detail panel: the full history behind a clicked card, in tabs.
// Every tab renders the verbatim artifact passed by the parent.

import { STAGE_DETAIL_TABS, type StageDetailData, type StageDetailTab } from "@/lib/dashboard/types";
import { formatElapsed, formatTokens } from "@/lib/dashboard/format";

function ArtifactBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </h4>
      <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-300">
        {text}
      </p>
    </div>
  );
}

export function StageDetailPanel({
  detail,
  activeTab,
  onTabChange,
  activeLanguage,
  onLanguageChange,
}: {
  detail: StageDetailData;
  activeTab: StageDetailTab;
  onTabChange: (tab: StageDetailTab) => void;
  activeLanguage: string | null;
  onLanguageChange: (code: string) => void;
}) {
  const selectedTranslation =
    detail.translations.find((t) => t.code === activeLanguage) ?? detail.translations[0];

  return (
    <section
      aria-label={`Stage detail — ${detail.title}`}
      data-testid="stage-detail"
      className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">{detail.title} — full history</h3>
        <span className="font-mono text-xs text-zinc-400">
          reconciled {detail.reconciledScore === null ? "—" : detail.reconciledScore.toFixed(1)}
        </span>
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
          detail.drafts.map((draft) => (
            <ArtifactBlock key={draft.generator} label={draft.generator} text={draft.text} />
          ))}

        {activeTab === "merged" && <ArtifactBlock label="Merged" text={detail.merged} />}

        {activeTab === "critiques" &&
          detail.critiques.map((critique) => (
            <ArtifactBlock key={critique.critic} label={critique.critic} text={critique.text} />
          ))}

        {activeTab === "improved" && <ArtifactBlock label="Improved" text={detail.improved} />}

        {activeTab === "scores" && (
          <div className="flex flex-col gap-2">
            {detail.scores.map((judge) => (
              <div
                key={judge.judge}
                data-testid={`score-${judge.judge.replace(/\s+/g, "-").toLowerCase()}`}
                className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3"
              >
                <div className="mb-1 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    {judge.judge}
                  </h4>
                  <span className="font-mono text-sm text-emerald-300">
                    overall {judge.overall.toFixed(1)}
                  </span>
                </div>
                <ul className="flex flex-wrap gap-x-4 font-mono text-xs text-zinc-400">
                  {judge.dimensions.map((d) => (
                    <li key={d.label}>
                      {d.label} {d.score.toFixed(1)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {activeTab === "translations" && (
          <div className="flex flex-col gap-2">
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
            // into the app itself (spec: System shape).
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
