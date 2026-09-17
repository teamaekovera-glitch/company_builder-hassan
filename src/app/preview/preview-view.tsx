// Static preview page: renders every dashboard surface and every stage-card
// state from fixtures. No API calls, no global state — the reference sheet
// for the operator UI and the dogfood target for visual checks.
//
// Client component: it wires demo callbacks into the (client) dashboard
// components, which is impossible from a Server Component.
"use client";

import ConfigScreen from "@/components/ui/ConfigScreen";
import RunHeader from "@/components/ui/RunHeader";
import WaveBoard from "@/components/ui/WaveBoard";
import StageDetailPanel from "@/components/ui/StageDetail";
import {
  DownloadButtons,
  MissingKeyBanner,
  RerunControls,
} from "@/components/ui/GlobalActions";
import {
  DEFAULT_CONFIG,
  SAMPLE_ESTIMATE,
  buildRunMetrics,
  buildStageDetail,
  buildWaveColumns,
} from "@/lib/dashboard/fixtures";
import type { StageDetailTab } from "@/lib/dashboard/types";

function Section({
  title,
  subtitle,
  testId,
  children,
}: {
  title: string;
  subtitle?: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section data-testid={testId} className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          {title}
        </h2>
        {subtitle ? <p className="text-xs text-zinc-500">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

const noop = () => {};

export default function PreviewPage() {
  const waves = buildWaveColumns();
  const detail = buildStageDetail();
  const doneMetrics = buildRunMetrics({
    status: "done",
    tokens: 4_582_300,
    calls: 771,
    elapsedMs: 5 * 3600_000 + 29 * 60_000,
    costUsd: 31.18,
    tokensPerSec: 0,
  });

  return (
    <main
      data-testid="preview-page"
      className="mx-auto flex max-w-7xl flex-col gap-10 bg-zinc-950 p-6 text-zinc-100"
    >
      <div>
        <h1 className="text-lg font-bold text-zinc-100">Operator UI — component preview</h1>
        <p className="text-xs text-zinc-500">
          Every state below renders from static fixtures (no API, no global state).
        </p>
      </div>

      <Section
        title="1 · Config screen — empty state"
        subtitle="Idea textarea with sample placeholder, Extreme depth default, all five languages, pre-flight estimate, Build Company confirm."
        testId="preview-config"
      >
        <ConfigScreen
          config={DEFAULT_CONFIG}
          onIdeaChange={noop}
          onDepthChange={noop}
          onToggleLanguage={noop}
          estimate={SAMPLE_ESTIMATE}
          onBuild={noop}
        />
      </Section>

      <Section
        title="2 · Live board — running, with every card state"
        subtitle="Wave columns; cards show queued / running / done / failed / blocked, with the failed card quoting its provider error and dependents blocked while the run continues."
        testId="preview-board"
      >
        <RunHeader metrics={buildRunMetrics()} />
        <WaveBoard waves={waves} selectedStageId={detail.stageId} onSelectStage={noop} />
      </Section>

      <Section
        title="3 · Stage detail — tabs"
        subtitle="Full history for the selected stage; the mockup tab renders generated HTML in a sandboxed iframe."
        testId="preview-stage-detail"
      >
        <StageDetailPanel
          detail={detail}
          activeTab={"drafts" as StageDetailTab}
          onTabChange={noop}
          activeLanguage={null}
          onLanguageChange={noop}
        />
      </Section>

      <Section
        title="4 · Run done — downloads and rerun controls"
        subtitle="Downloads activate at Done; rerun controls start fresh runs and never overwrite the original."
        testId="preview-done"
      >
        <RunHeader metrics={doneMetrics} />
        <RerunControls onRerunStricter={noop} onAlternatives={noop} />
        <DownloadButtons onDownloadDossier={noop} onDownloadRunLog={noop} />
      </Section>

      <Section
        title="5 · Missing key state"
        subtitle="Run created without the provider key — explicit setup banner, never a silent hang."
        testId="preview-missing-key"
      >
        <MissingKeyBanner />
        <DownloadButtons
          onDownloadDossier={noop}
          onDownloadRunLog={noop}
          disabledReason="Activate after a completed run"
        />
      </Section>
    </main>
  );
}
