"use client";

// Config screen — inputs and pre-flight estimate before a run exists.
// Fully prop-driven: state lives in the parent; components fire change
// callbacks and never fetch.

import { useState } from "react";
import { DEPTH_OPTIONS, LANGUAGE_OPTIONS } from "@/lib/dashboard/fixtures";
import {
  formatElapsed,
  formatTokens,
  formatUsd,
} from "@/lib/dashboard/format";
import type {
  Depth,
  Language,
  PreflightEstimate,
  RunConfigDraft,
} from "@/lib/dashboard/types";

export function DepthSelector({
  value,
  onChange,
}: {
  value: Depth;
  onChange: (depth: Depth) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Depth
      </legend>
      <div
        className="grid grid-cols-3 gap-2"
        role="radiogroup"
        aria-label="Depth"
        data-testid="depth-selector"
      >
        {DEPTH_OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`depth-${option.value}`}
              onClick={() => onChange(option.value)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                selected
                  ? "border-sky-500 bg-sky-500/10 text-sky-200"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
              }`}
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="block text-xs text-zinc-500">{option.description}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function LanguageMultiSelect({
  selected,
  onToggle,
}: {
  selected: Language[];
  onToggle: (code: Language) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Languages
      </legend>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Languages"
        data-testid="language-multi-select"
      >
        {LANGUAGE_OPTIONS.map((option) => {
          const checked = selected.includes(option.code);
          return (
            <label
              key={option.code}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                checked
                  ? "border-sky-500 bg-sky-500/10 text-sky-200"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(option.code)}
                aria-label={option.label}
                data-testid={`language-${option.code}`}
                className="accent-sky-500"
              />
              <span>{option.nativeLabel}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function EstimatePanel({ estimate }: { estimate: PreflightEstimate | null }) {
  if (!estimate) return null;
  return (
    <section
      aria-label="Pre-flight estimate"
      data-testid="estimate-panel"
      className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
    >
      <h3 className="mb-3 text-sm font-semibold text-amber-200">
        Pre-flight estimate — this run&apos;s real volume
      </h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-400">AI calls</dt>
          <dd data-testid="estimate-calls" className="font-mono text-base text-zinc-100">
            ≈ {estimate.estimatedCalls}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-400">Tokens</dt>
          <dd data-testid="estimate-tokens" className="font-mono text-base text-zinc-100">
            ≈ {formatTokens(estimate.estimatedTokens)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-400">Cost</dt>
          <dd data-testid="estimate-cost" className="font-mono text-base text-zinc-100">
            ≈ {formatUsd(estimate.estimatedCostUsd)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-zinc-400">Wall time</dt>
          <dd data-testid="estimate-hours" className="font-mono text-base text-zinc-100">
            ≈ {formatElapsed(estimate.estimatedHours * 3600_000)}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-zinc-400">
        Depth loop cap ×{estimate.loopCap}, {estimate.languageCount} language
        {estimate.languageCount === 1 ? "" : "s"}. Estimates come from the depth matrix ×
        price table and are honest about scale, not a quote.
      </p>
    </section>
  );
}

/**
 * Build Company button with a two-step confirm — the destructive-ish action
 * (hours of wall time, real spend) must never fire from a single click.
 */
export function BuildButton({
  onBuild,
  disabledReason,
}: {
  onBuild: () => void;
  disabledReason?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (disabledReason) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled
          data-testid="build-button"
          title={disabledReason}
          className="cursor-not-allowed rounded-lg bg-zinc-800 px-6 py-3 text-sm font-semibold text-zinc-500"
        >
          Build Company
        </button>
        <span data-testid="build-disabled-reason" className="text-sm text-zinc-500">
          {disabledReason}
        </span>
      </div>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        data-testid="build-button"
        onClick={() => setConfirming(true)}
        className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-500"
      >
        Build Company
      </button>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-label="Confirm build"
      data-testid="build-confirm"
      className="flex items-center gap-3 rounded-lg border border-sky-500/60 bg-sky-500/10 px-4 py-2"
    >
      <span className="text-sm text-sky-100">
        This starts a full run — hundreds of calls and real spend. Confirm?
      </span>
      <button
        type="button"
        data-testid="build-confirm-yes"
        onClick={() => {
          setConfirming(false);
          onBuild();
        }}
        className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-500"
      >
        Yes, build it
      </button>
      <button
        type="button"
        data-testid="build-confirm-no"
        onClick={() => setConfirming(false)}
        className="rounded-md border border-zinc-600 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-400"
      >
        Cancel
      </button>
    </div>
  );
}

export default function ConfigScreen({
  config,
  onIdeaChange,
  onDepthChange,
  onToggleLanguage,
  estimate,
  onBuild,
  disabledReason,
}: {
  config: RunConfigDraft;
  onIdeaChange: (idea: string) => void;
  onDepthChange: (depth: Depth) => void;
  onToggleLanguage: (code: Language) => void;
  estimate: PreflightEstimate | null;
  onBuild: () => void;
  disabledReason?: string;
}) {
  return (
    <section
      aria-label="Run configuration"
      data-testid="config-screen"
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-xl border border-zinc-800 bg-zinc-950/60 p-6"
    >
      <div>
        <label
          htmlFor="idea"
          className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-400"
        >
          The idea
        </label>
        <textarea
          id="idea"
          data-testid="idea-input"
          rows={3}
          value={config.idea}
          onChange={(event) => onIdeaChange(event.target.value)}
          placeholder="Describe the company in one line — e.g. A subscription service for monthly specialty-coffee discovery boxes"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
        />
      </div>

      <DepthSelector value={config.depth} onChange={onDepthChange} />
      <LanguageMultiSelect selected={config.languages} onToggle={onToggleLanguage} />
      <EstimatePanel estimate={estimate} />

      <div className="flex items-center justify-between">
        <BuildButton onBuild={onBuild} disabledReason={disabledReason} />
        {disabledReason ? (
          <span data-testid="build-disabled-reason" className="text-xs text-zinc-500">
            {disabledReason}
          </span>
        ) : null}
      </div>
    </section>
  );
}
