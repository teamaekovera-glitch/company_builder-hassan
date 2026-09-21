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
import {
  buildDossierMarkdown,
  buildRunLogCallSection,
  buildRunLogHeader,
  buildRunLogMarkdown,
  runLogSections,
} from "./exports";

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
    // Pass-stage outputs render verbatim under their kind labels: resolved
    // contradictions (consistency audit), localisation QA verdicts and
    // cultural adaptation, and the auto re-run (selection, outcome, winner,
    // downstream recheck).
    store.putArtifact({
      runId: "run-golden",
      stageId: "consistency-audit",
      kind: "audit-pair:1",
      text: "Pair audit 1 — PRD ↔ GTM timeline.\nCONTRADICTION: the PRD promises Q3 launch, the GTM timeline says Q4.",
    });
    store.putArtifact({
      runId: "run-golden",
      stageId: "consistency-audit",
      kind: "audit-resolution:1",
      text: "Resolved: the launch is Q4 — the GTM timeline is authoritative; the PRD's roadmap section was corrected.",
    });
    store.putArtifact({
      runId: "run-golden",
      stageId: "localisation",
      kind: "localisation-qa:es",
      text: "VERDICT: PASS\nThe Spanish translations preserve clinical terminology and tone; no truncation found.",
    });
    store.putArtifact({
      runId: "run-golden",
      stageId: "localisation",
      kind: "cultural-adaptation:es",
      text: "Adaptation: rural-pharmacy framing localized for Spanish-speaking markets; units kept metric.",
    });
    store.putArtifact({
      runId: "run-golden",
      stageId: "auto-rerun",
      kind: "rerun-selection",
      text: "Weakest stages selected for re-run under the strict 9.5 gate:\n1. Market Analysis (market-analysis) — reconciled score 9.4",
    });
    store.putArtifact({
      runId: "run-golden",
      stageId: "auto-rerun",
      kind: "rerun-outcome:market-analysis",
      score: 9.5,
      text: "Re-run outcome for stage 1 — Market Analysis:\nBefore: 9.4 · After: 9.5 · Rounds: 1 · Gate: 9.5\nThe re-run cleared the strict gate.",
    });
    store.putArtifact({
      runId: "run-golden",
      stageId: "auto-rerun",
      kind: "rerun:market-analysis:improved",
      score: 9.5,
      text: "Re-run winner text for the market analysis (verbatim copy of the adopted draft).",
    });
    store.putArtifact({
      runId: "run-golden",
      stageId: "auto-rerun",
      kind: "recheck:executive-synthesis:executive-synthesis",
      text: "Recheck of the executive synthesis after the re-run: conclusions unchanged.",
    });

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
    // Pass-stage outputs render verbatim under their kind labels — resolved
    // contradictions, localisation QA verdicts, cultural adaptation, re-run
    // selection/outcome/winner, and the downstream recheck.
    expect(markdown).toContain("### Pair audit 1 of 6 — pricing ↔ financial model (`audit-pair:1`)");
    expect(markdown).toContain("CONTRADICTION: the PRD promises Q3 launch");
    expect(markdown).toContain("### Resolution 1 (`audit-resolution:1`)");
    expect(markdown).toContain("### Localisation QA — Spanish (`localisation-qa:es`)");
    expect(markdown).toContain("VERDICT: PASS");
    expect(markdown).toContain("### Cultural adaptation — Spanish (`cultural-adaptation:es`)");
    expect(markdown).toContain("### Auto re-run — weakest-stage selection (`rerun-selection`)");
    expect(markdown).toContain("### Re-run outcome — Market Analysis (`rerun-outcome:market-analysis`)");
    expect(markdown).toContain("### Re-run winner — Market Analysis (`rerun:market-analysis:improved`)");
    expect(markdown).toContain("### Recheck — Executive Synthesis — Executive Synthesis (`recheck:executive-synthesis:executive-synthesis`)");
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

  it("run-log sections stream byte-identically to the materialized document, header first", () => {
    const runId = seedGoldenRun();
    const run = store.getRun(runId);
    if (!run) throw new Error("seed failed");

    const generator = runLogSections(store, run);
    const first = generator.next();
    expect(first.done).toBe(false);
    // Laziness contract: the header is available before any call row is read,
    // so the download starts streaming without materializing call history.
    expect(first.value).toMatch(/^# Run log/);

    const streamed = [first.value, ...generator].join("").trimEnd() + "\n";
    expect(streamed).toBe(buildRunLogMarkdown(store, run));

    // Cross-check against the in-memory section builder over full rows: the
    // chunked fragment stream must render every call byte-identically.
    const sections = [
      buildRunLogHeader(run, store.countRunCalls(runId)),
      ...store.listRunCalls(runId).map((call, index) => buildRunLogCallSection(call, index)),
    ].join("\n");
    expect(streamed).toBe(`${sections.trimEnd()}\n`);
  });

  it("run-log sections stream byte-identically for a run with no calls", () => {
    store.createRun({
      id: "run-empty",
      idea: "An idea with no recorded calls",
      config: { depth: "light", languages: ["en"], scoreThreshold: 9.0 },
      status: "running",
    });
    const run = store.getRun("run-empty");
    if (!run) throw new Error("seed failed");

    const streamed = [...runLogSections(store, run)].join("").trimEnd() + "\n";
    expect(streamed).toBe(buildRunLogMarkdown(store, run));
    expect(streamed).toContain("0 calls, verbatim, in run order.");
  });

  it("chunks verbatim reads: a backtick run straddling the chunk boundary still fences byte-exactly", () => {
    const runId = seedGoldenRun();
    // Prompt larger than one VERBATIM_CHUNK_CHARS chunk with a backtick run
    // spanning the chunk boundary, plus nested fences of varying lengths —
    // the streamed fence must match the materialized builder exactly.
    const boundary = 8_388_608;
    const prompt =
      // x's end at code point 8,388,602; the 12-backtick run spans 8,388,603
      // through 8,388,614 — chunk 1 (code points 1..8,388,608) ends mid-run.
      "x".repeat(boundary - 6) + "`".repeat(12) + "\n```\nplain\n````\n" + "z".repeat(2_000_000);
    store.recordCall({
      id: "call-chunked",
      runId,
      stageId: "market-analysis",
      role: "gen-a",
      loop: 0,
      attempt: 1,
      prompt,
      response: "fine",
      inputTokens: 1,
      outputTokens: 1,
      ms: 1,
    });
    const run = store.getRun(runId);
    if (!run) throw new Error("seed failed");

    const streamed = [...runLogSections(store, run)].join("");
    const calls = store.listRunCalls(runId);
    const call = calls.at(-1);
    if (!call) throw new Error("seed failed");
    expect(streamed).toContain(`${buildRunLogCallSection(call, calls.length - 1)}\n`);
    // The straddling 5-backtick run (not the smaller nested fences) drives the fence size.
    expect(streamed).toContain("`".repeat(13) + "\n");
    // The straddling 12-backtick run (not the nested fences) drives the fence size.
  });
});
