/**
 * Export golden-file tests (spec verification row 11): dossier.md and
 * run-log.md are byte-exact for a fixed store state, with fence-escaping and
 * MISSING markers verified explicitly beyond the golden comparison.
 *
 * Regenerate the goldens after an intentional format change:
 *   UPDATE_GOLDENS=1 pnpm vitest run src/lib/orchestrator/exports.test.ts
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunStore } from "../store/store";
import { buildDossierMarkdown, buildRunLogMarkdown } from "./exports";

const UPDATE_GOLDENS = process.env.UPDATE_GOLDENS === "1";

/**
 * Golden location relative to the repo root: vitest's jsdom environment does
 * not guarantee a usable file: URL for import.meta (fileURLToPath throws
 * "The URL must be of scheme file" there), and vitest always runs from the
 * repo root — so cwd-based resolution is the reliable base.
 */
function goldenPath(name: string): string {
  return join(process.cwd(), "src", "lib", "orchestrator", "goldens", name);
}

function expectGolden(name: string, actual: string): void {
  const golden = goldenPath(name);
  if (UPDATE_GOLDENS) {
    mkdirSync(dirname(golden), { recursive: true });
    writeFileSync(golden, actual, "utf8");
  }
  expect(actual, `golden mismatch for ${name} (regenerate with UPDATE_GOLDENS=1)`).toBe(readFileSync(golden, "utf8"));
}

describe("export builders — golden files (spec row 11)", () => {
  let store: RunStore;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "exports-goldens-"));
    store = new RunStore(join(dir, "store.sqlite"));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Fixed store state the goldens were baked from — extend deliberately, never casually. */
  function seedGoldenRun(): string {
    store.createRun({
      id: "run-golden",
      idea: "A solar-powered cold chain for rural pharmacies",
      config: { depth: "standard", languages: ["en", "es"], scoreThreshold: 9.5 },
      status: "completed",
    });
    // Market analysis: completed loop stage with the winning draft + Spanish translation.
    store.updateStageProgress("run-golden", "market-analysis", { status: "done", loop: 1, score: 9.5 });
    store.putArtifact({
      runId: "run-golden",
      stageId: "market-analysis",
      kind: "improved",
      score: 9.5,
      text: "Verdict: the cold chain wins on unit economics — pharmacy margins absorb the capex.",
    });
    store.putArtifact({
      runId: "run-golden",
      stageId: "market-analysis",
      kind: "translation:es",
      text: "Veredicto: la cadena de frío gana en economía unitaria.",
    });
    // Competitor analysis: the improved text embeds a fenced block — the export must escape it.
    store.updateStageProgress("run-golden", "competitor-analysis", { status: "done", loop: 1, score: 9.5 });
    store.putArtifact({
      runId: "run-golden",
      stageId: "competitor-analysis",
      kind: "improved",
      score: 9.5,
      text: "```mermaid\nflowchart LR\n  A[incumbents] --> B[us]\n```",
    });
    // Pricing strategy: a done loop stage whose winning draft is absent — the MISSING marker.
    store.updateStageProgress("run-golden", "pricing-strategy", { status: "done", loop: 0, score: null });
    store.putArtifact({ runId: "run-golden", stageId: "pricing-strategy", kind: "gen-a", text: "draft that never survived the loop" });
    // Brand identity: loop stage — its winner is the canonical improved kind.
    store.putArtifact({
      runId: "run-golden",
      stageId: "brand-identity",
      kind: "improved",
      text: "Palette: solar amber on clinical white; wordmark set in a grotesque.",
    });
    // Localisation: translation rows only, two languages, unordered on purpose.
    store.putArtifact({ runId: "run-golden", stageId: "localisation", kind: "translation:hi", text: "लोकल की गई फाइल।" });
    store.putArtifact({ runId: "run-golden", stageId: "localisation", kind: "translation:de", text: "Lokalisierte Fassung des Dossiers." });

    store.recordCall({
      id: "call-1",
      runId: "run-golden",
      stageId: "market-analysis",
      role: "gen-a",
      loop: 0,
      attempt: 1,
      prompt: "Draft the market analysis.\n\nDepth: standard. Score threshold: 9.5. Languages: en, es. Strategy angle: none.",
      response: "Market analysis draft.",
      inputTokens: 1200,
      outputTokens: 4800,
      ms: 210,
    });
    store.recordCall({
      id: "call-2",
      runId: "run-golden",
      stageId: "market-analysis",
      role: "judge:losses",
      loop: 1,
      attempt: 1,
      prompt: "Judge round 1.",
      response: null,
      error: "provider 502 after 3 retries",
      inputTokens: null,
      outputTokens: null,
      ms: 9000,
    });
    store.recordCall({
      id: "call-3",
      runId: "run-golden",
      stageId: "competitor-analysis",
      role: "gen-b",
      loop: 0,
      attempt: 2,
      prompt: "Draft the competitor analysis.",
      response: "Competitor map attached.",
      inputTokens: 900,
      outputTokens: 2400,
      ms: 180,
    });
    return "run-golden";
  }

  it("dossier.md is byte-exact: contents, per-stage/language artifacts, escaping, MISSING markers", () => {
    const runId = seedGoldenRun();
    const run = store.getRun(runId);
    if (!run) throw new Error("seed failed");
    const markdown = buildDossierMarkdown(store, run);
    expectGolden("dossier.md", markdown);
    // Beyond the golden: the mermaid-embedded draft sits inside a 4-backtick
    // fence so it cannot break out of its own code block.
    expect(markdown).toMatch(/````\n```mermaid/);
    // Exactly one MISSING marker — the done loop stage without its winning draft.
    expect(markdown.match(/MISSING/g)).toHaveLength(1);
    expect(markdown).toContain("pricing-strategy");
  });

  it("run-log.md is byte-exact: every call verbatim with metadata and error blocks", () => {
    const runId = seedGoldenRun();
    const run = store.getRun(runId);
    if (!run) throw new Error("seed failed");
    const markdown = buildRunLogMarkdown(store, run);
    expectGolden("run-log.md", markdown);
    expect(markdown).toContain("provider 502 after 3 retries");
    expect(markdown).toContain("3 calls, verbatim, in run order.");
  });

  it("builders are deterministic across repeated invocations", () => {
    const runId = seedGoldenRun();
    const run = store.getRun(runId);
    if (!run) throw new Error("seed failed");
    expect(buildDossierMarkdown(store, run)).toBe(buildDossierMarkdown(store, run));
    expect(buildRunLogMarkdown(store, run)).toBe(buildRunLogMarkdown(store, run));
  });

  it("an attempt with neither response nor error is flagged MISSING in the run log", () => {
    const runId = seedGoldenRun();
    store.recordCall({
      id: "call-4",
      runId,
      stageId: "market-analysis",
      role: "gen-b",
      loop: 0,
      attempt: 1,
      prompt: "orphan attempt",
    });
    const run = store.getRun(runId);
    if (!run) throw new Error("seed failed");
    expect(buildRunLogMarkdown(store, run)).toContain("MISSING: no response and no error recorded");
  });
});
