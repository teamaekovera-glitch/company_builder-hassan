/**
 * Full Extreme-depth mocked e2e (spec verification): one deterministic run of
 * the complete 39-stage graph — every core stage's depth-scaled expansion
 * fan-outs, every pass stage's calls, contradiction detection + resolution,
 * the 9.5-gated weak-stage auto re-run with downstream rechecks, and the
 * localisation pass — driven through the orchestrator on the mock provider
 * (offline, zero provider cost), then verified end to end:
 *
 *   1. all 39 stages across all 7 waves complete, every stage's call history
 *      persisted;
 *   2. run-log header totals reconcile exactly against the calls table;
 *   3. SSE replay from persisted rows matches the live event stream;
 *   4. dossier.md downloads byte-exact against the committed golden;
 *   5. run-log.md downloads as a byte-equal stream to the golden-verified
 *      builder output, read through a memory-bounded cursor (multi-GB
 *      verbatim logs must never materialize in the worker heap).
 *
 * The mock provider is fully deterministic (digest-keyed bodies, fixed
 * scores, fixed markers), and the run id and idea are fixed, so the whole
 * run — and therefore the dossier golden — is byte-reproducible. Regenerate
 * the golden after an intentional format or graph change:
 *   UPDATE_E2E_GOLDENS=1 pnpm vitest run src/lib/e2e/extreme-run.e2e.test.ts
 *
 * The store lives under the OS temp dir by default; set E2E_STORE_DIR to
 * place it on a larger disk (the Extreme verbatim log is multi-GB).
 */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { createMockProvider } from "../llm/mock-provider";
import { EventedRunStore } from "../orchestrator/evented-store";
import { synthesizeReplayEvents, toPublishable, type PublishableEvent } from "../orchestrator/events";
import { Orchestrator } from "../orchestrator/orchestrator";
import { handleExportDossier, handleExportRunLog, type OrchestratorServices } from "../orchestrator/api";
import { SSEHub } from "../orchestrator/hub";
import { STAGE_NODES, type WaveNumber } from "../pipeline/graph/stages";

const UPDATE_GOLDENS = process.env.UPDATE_E2E_GOLDENS === "1";

const RUN_ID = "e2e-extreme-golden";
const IDEA = "A solar-powered cold chain for rural pharmacies";
const CONFIG = { depth: "extreme" as const, languages: ["en", "es"] as ("en" | "es")[], scoreThreshold: 9.0 };

function goldenPath(name: string): string {
  return join(process.cwd(), "src", "lib", "e2e", "goldens", name);
}

function expectGolden(name: string, actual: string): void {
  const golden = goldenPath(name);
  if (UPDATE_GOLDENS) {
    mkdirSync(dirname(golden), { recursive: true });
    writeFileSync(golden, actual, "utf8");
  }
  expect(actual, `golden mismatch for ${name} (regenerate with UPDATE_E2E_GOLDENS=1)`).toBe(readFileSync(golden, "utf8"));
}

/** Publishable-event key: what happened, order-insensitively comparable. */
function eventKey(event: PublishableEvent): string {
  if (event.kind === "call") return `call|${event.stageId}|${event.role}|${event.loop}|${event.attempt}|${String(event.ok)}`;
  if (event.kind === "stage") return `stage|${event.stageId}|${event.status}|${event.loop}|${event.score}`;
  return `run|${event.status}`;
}

let dir: string;
let store: EventedRunStore;
let services: OrchestratorServices;
let liveEvents: PublishableEvent[];

beforeAll(async () => {
  dir = process.env.E2E_STORE_DIR ? join(process.env.E2E_STORE_DIR, "extreme-e2e") : mkdtempSync(join(tmpdir(), "extreme-e2e-"));
  mkdirSync(dir, { recursive: true });
  // The e2e owns its store directory: clear stale files (a previous run's
  // multi-GB store would collide with the fixed run id) before opening.
  for (const suffix of ["", "-wal", "-shm"]) rmSync(join(dir, `store.sqlite${suffix}`), { force: true });
  store = new EventedRunStore(join(dir, "store.sqlite"), {
    onEvent: (event) => liveEvents.push(toPublishable(event)),
  });
  liveEvents = [];
  services = { orchestrator: new Orchestrator({ store, adapterFactory: () => createMockProvider() }), hub: new SSEHub() };

  // The run id is fixed (not orchestrator-generated) so the dossier — which
  // embeds the run id — is byte-reproducible for the committed golden.
  store.createRun({ id: RUN_ID, idea: IDEA, config: { ...CONFIG } as Record<string, unknown> });
  const result = await services.orchestrator.confirmRun(RUN_ID);
  expect(result.status).toBe("completed");
}, 1_800_000);

afterAll(() => {
  store?.close();
  if (dir && !process.env.E2E_STORE_DIR) rmSync(dir, { recursive: true, force: true });
});

describe("extreme mocked run — completion and persistence", () => {
  it("completes all 39 stages across all 7 waves, every stage history persisted", () => {
    const snapshot = services.orchestrator.getSnapshot(RUN_ID);
    if (!snapshot) throw new Error("run snapshot missing");
    expect(snapshot.status).toBe("completed");

    const stages = snapshot.stages;
    expect(stages).toHaveLength(STAGE_NODES.length);

    const byStage = new Map(stages.map((row) => [row.stage_id, row]));
    const waves = new Set(STAGE_NODES.map((node) => node.wave as WaveNumber));
    expect([...waves].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const wave of waves) {
      for (const node of STAGE_NODES.filter((n) => n.wave === wave)) {
        const row = byStage.get(node.id);
        expect(row?.status, `${node.id} (wave ${wave})`).toBe("done");
      }
    }

    // Every stage's call history is persisted — counted through the lazy
    // meta cursor so the multi-GB calls table is never materialized.
    const perStage = new Map<string, number>();
    for (const meta of store.iterateRunCalls(RUN_ID)) {
      perStage.set(meta.stage_id, (perStage.get(meta.stage_id) ?? 0) + 1);
    }
    for (const node of STAGE_NODES) {
      expect(perStage.get(node.id) ?? 0, `call history for ${node.id}`).toBeGreaterThan(0);
    }

    // Loop stages end with a winning improved draft; the auto re-run's
    // winners overwrite the weakest stages' deliverables in place.
    for (const node of STAGE_NODES) {
      if (node.kind !== "stage") continue;
      const artifacts = store.listStageArtifacts(RUN_ID, node.id);
      expect(artifacts.some((row) => row.kind === "improved"), `improved draft for ${node.id}`).toBe(true);
      expect(byStage.get(node.id)?.score ?? 0).toBeGreaterThanOrEqual(CONFIG.scoreThreshold);
    }
  }, 300_000);

  it("reconciles run-log header totals exactly against the calls table", () => {
    const totals = store.getRunTotals(RUN_ID);
    const count = store.countRunCalls(RUN_ID);

    let calls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let ms = 0;
    for (const meta of store.iterateRunCalls(RUN_ID)) {
      calls += 1;
      inputTokens += meta.input_tokens ?? 0;
      outputTokens += meta.output_tokens ?? 0;
      ms += meta.ms ?? 0;
    }
    expect(totals.calls).toBe(calls);
    expect(totals.inputTokens).toBe(inputTokens);
    expect(totals.outputTokens).toBe(outputTokens);
    expect(totals.tokens).toBe(inputTokens + outputTokens);
    expect(totals.ms).toBe(ms);
    expect(count).toBe(calls);

    // The deterministic plan is an upper bound (it budgets every stage at the
    // loop cap; the mock clears the 9.0 gate in round one, so only the strict
    // 9.5 re-runs spend their extra rounds).
    expect(calls).toBeGreaterThan(400);
    expect(calls).toBeLessThanOrEqual(1270);
  }, 300_000);

  it("replays SSE from persisted rows matching the live event stream", () => {
    const stages = store.listStageStatus(RUN_ID);
    const run = store.getRun(RUN_ID);
    if (!run) throw new Error("run row missing");
    const replay = synthesizeReplayEvents(RUN_ID, run.status, stages, store.iterateRunCalls(RUN_ID));

    // Replay is canonical: run-queued, every call in rowid (completion)
    // order, every stage row, then the final run status.
    expect(replay[0]).toMatchObject({ kind: "run", runId: RUN_ID, status: "queued" });
    expect(replay.at(-1)).toMatchObject({ kind: "run", runId: RUN_ID, status: "completed" });
    expect(replay.filter((event) => event.kind === "call")).toHaveLength(store.countRunCalls(RUN_ID));
    expect(replay.filter((event) => event.kind === "stage")).toHaveLength(STAGE_NODES.length);

    // The live stream carries every intermediate transition; the replay
    // synthesizes persisted final state. Per kind: call attempts broadcast
    // exactly once (row-accurate multiset match); each stage's FINAL live
    // event equals the persisted row; the run lifecycle is queued → running
    // → completed.
    const lastLiveStage = new Map<string, PublishableEvent>();
    for (const event of liveEvents) {
      if (event.kind === "stage") lastLiveStage.set(event.stageId, event);
    }
    const byKind = (events: PublishableEvent[], kind: PublishableEvent["kind"]) =>
      events.filter((event) => event.kind === kind).map(eventKey).sort();

    expect(byKind(liveEvents, "call")).toEqual(byKind(replay, "call"));
    expect([...lastLiveStage.values()].map(eventKey).sort()).toEqual(
      replay.filter((event) => event.kind === "stage").map(eventKey).sort(),
    );
    expect(liveEvents.filter((event) => event.kind === "run").map((event) => event.status)).toEqual([
      "queued",
      "running",
      "completed",
    ]);
  }, 300_000);
});

describe("extreme mocked run — exports", () => {
  it("downloads dossier.md byte-exact against the committed golden", async () => {
    const response = handleExportDossier(services, RUN_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain('dossier.md');
    const markdown = await response.text();

    expectGolden("extreme-dossier.md", markdown);

    // Honesty beyond the golden: every stage section present, nothing MISSING
    // (the run completed), and the pass-stage outputs render verbatim.
    for (const node of STAGE_NODES) {
      expect(markdown).toContain(`(\`${node.id}\`)`);
    }
    expect(markdown.match(/MISSING/g)).toBeNull();
    expect(markdown).toContain("Localisation QA — Spanish (`localisation-qa:es`)");
    expect(markdown).toContain("LOCALISATION_QA_VERDICT: pass");
    expect(markdown).toContain("### Resolution 1 (`audit-resolution:1`)");
    expect(markdown).toContain("### Re-run outcome — Market Analysis (`rerun-outcome:market-analysis`)");
    expect(markdown).toContain("ended at the loop cap below the strict gate");
  }, 300_000);

  it("streams run-log.md memory-bounded, byte-equal to the builder output", async () => {
    const response = handleExportRunLog(services, RUN_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain('run-log.md');

    // Stream the download in bounded chunks: hash and byte-count only, never
    // accumulating. This is the multi-GB verbatim log's reader contract.
    const streamed = createHash("sha256");
    let streamedBytes = 0;
    let streamedCalls = 0;
    let tail = "";
    let firstChunk = "";
    const reader = response.body?.getReader();
    if (!reader) throw new Error("run-log response has no body stream");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Zero-copy view over the received chunk — Buffer.from(value) would
      // duplicate every multi-MB section just to hash it.
      const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      if (streamedBytes === 0) firstChunk = Buffer.from(value).toString("utf8");
      streamed.update(chunk);
      streamedBytes += value.byteLength;
      const text = Buffer.from(value).toString("utf8");
      const window = tail + text;
      streamedCalls += (window.match(/\n## Call /g) ?? []).length;
      tail = window.slice(-"\n## Call ".length);
    }

    // The golden-verified builder is the byte authority: stream its fragments
    // through the same hash and compare.
    const built = createHash("sha256");
    let builtBytes = 0;
    let builtCalls = 0;
    let builtTail = "";
    for (const fragment of services.orchestrator.runLogSections(RUN_ID)) {
      const bytes = Buffer.from(fragment, "utf8");
      built.update(bytes);
      builtBytes += bytes.byteLength;
      const window = builtTail + fragment;
      builtCalls += (window.match(/\n## Call /g) ?? []).length;
      builtTail = window.slice(-"\n## Call ".length);
    }

    // Header reconciles: the first chunk carries the exact call count.
    expect(firstChunk.startsWith("# Run log")).toBe(true);
    const headerCount = Number(/\n(\d+) calls, verbatim, in run order\./.exec(firstChunk)?.[1]);
    expect(headerCount).toBe(store.countRunCalls(RUN_ID));

    expect(streamedBytes).toBe(builtBytes);
    expect(streamed.digest("hex")).toBe(built.digest("hex"));
    // Heading occurrences match on both sides of the byte comparison — one
    // per persisted call, reconciled against the header count above.
    expect(streamedCalls).toBe(builtCalls);
  }, 1_800_000);
});
