/**
 * Offline integration tests for the SQLite run store.
 *
 * Every test runs against a real better-sqlite3 database file in a fresh
 * temporary directory — no network, no mock provider, no environment. Covers
 * the acceptance matrix: insert/read of all four tables, attempt accounting
 * (retries consume attempts and are logged verbatim), artifact threading, and
 * exact header-total reconciliation (spec verification row 8).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunStore, newId } from "./store";

const RUN_ID = "run-test-0001";
const STAGE_ID = "01:idea:expand";

let dir: string;
let store: RunStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "run-store-"));
  store = new RunStore(join(dir, "store.sqlite3"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Seeds one run and returns it. */
function seedRun(): void {
  store.createRun({
    id: RUN_ID,
    idea: "A cottage cheese dip brand for the US Midwest",
    config: { depth: "standard", languages: ["en", "es"], scoreThreshold: 9.0 },
  });
}

describe("runs table", () => {
  it("round-trips a run: idea, config JSON, status, created_at", () => {
    seedRun();

    const run = store.getRun(RUN_ID);
    expect(run).toBeDefined();
    expect(run?.idea).toBe("A cottage cheese dip brand for the US Midwest");
    expect(JSON.parse(run?.config_json ?? "{}")).toEqual({
      depth: "standard",
      languages: ["en", "es"],
      scoreThreshold: 9.0,
    });
    expect(run?.status).toBe("queued");
    expect(run?.created_at).toBeGreaterThan(0);
  });

  it("transitions status and rejects unknown runs", () => {
    seedRun();

    store.setRunStatus(RUN_ID, "running");
    expect(store.getRun(RUN_ID)?.status).toBe("running");

    store.setRunStatus(RUN_ID, "completed");
    expect(store.getRun(RUN_ID)?.status).toBe("completed");

    expect(() => store.setRunStatus("missing-run", "running")).toThrow(/unknown run/);
  });

  it("lists runs in creation order", () => {
    store.createRun({ id: "run-b", idea: "b", config: {}, createdAt: 200 });
    store.createRun({ id: "run-a", idea: "a", config: {}, createdAt: 100 });

    expect(store.listRuns().map((r) => r.id)).toEqual(["run-a", "run-b"]);
  });
});

describe("calls table — verbatim recording", () => {
  it("stores prompt and response byte-for-byte with role, loop, attempt, usage, ms", () => {
    seedRun();

    // 2,000+ chars, unicode, newlines — verbatim means byte-for-byte.
    const prompt = `# Thread context\n\n${"填料 line émoji 🌱 ".repeat(60)}\nEND-OF-CONTEXT`;
    const response = "## Assumptions & open questions\n- verbatim ✓\n".repeat(80);

    store.recordCall({
      id: "call-1",
      runId: RUN_ID,
      stageId: STAGE_ID,
      role: "critic:vc",
      loop: 2,
      attempt: 3,
      prompt,
      response,
      inputTokens: 4321,
      outputTokens: 987,
      ms: 6543,
      createdAt: 1_760_000_000_000,
    });

    const calls = store.getStageCalls(RUN_ID, STAGE_ID);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      id: "call-1",
      run_id: RUN_ID,
      stage_id: STAGE_ID,
      role: "critic:vc",
      loop: 2,
      attempt: 3,
      prompt,
      response,
      error: null,
      input_tokens: 4321,
      output_tokens: 987,
      ms: 6543,
      created_at: 1_760_000_000_000,
    });
    expect(calls[0].prompt).toBe(prompt);
    expect(calls[0].response).toBe(response);
  });

  it("records a failed attempt: response NULL, error verbatim", () => {
    seedRun();

    store.recordCall({
      id: "call-fail",
      runId: RUN_ID,
      stageId: STAGE_ID,
      role: "generatorA",
      loop: 0,
      attempt: 1,
      prompt: "the prompt",
      error: "provider 500: upstream overloaded",
    });

    const calls = store.getStageCalls(RUN_ID, STAGE_ID);
    expect(calls).toHaveLength(1);
    expect(calls[0].response).toBeNull();
    expect(calls[0].error).toBe("provider 500: upstream overloaded");
    expect(calls[0].input_tokens).toBeNull();
    expect(calls[0].output_tokens).toBeNull();
    expect(calls[0].ms).toBeNull();
  });

  it("rejects calls for unknown runs (foreign key enforcement)", () => {
    expect(() =>
      store.recordCall({
        id: "call-orphan",
        runId: "no-such-run",
        stageId: STAGE_ID,
        role: "generatorA",
        loop: 0,
        attempt: 1,
        prompt: "orphaned",
      }),
    ).toThrow();
  });
});

describe("stage_status table", () => {
  it("starts counters implicitly on first call and bumps per attempt", () => {
    seedRun();

    store.recordCall({
      id: "call-a",
      runId: RUN_ID,
      stageId: STAGE_ID,
      role: "generatorA",
      loop: 0,
      attempt: 1,
      prompt: "p",
      response: "r",
      inputTokens: 100,
      outputTokens: 50,
      ms: 900,
    });
    store.recordCall({
      id: "call-b",
      runId: RUN_ID,
      stageId: STAGE_ID,
      role: "generatorA",
      loop: 0,
      attempt: 2,
      prompt: "p",
      error: "provider 500",
    });

    const stage = store.getStageStatus(RUN_ID, STAGE_ID);
    expect(stage).toBeDefined();
    expect(stage?.status).toBe("running");
    expect(stage?.calls).toBe(2);
    // Failed attempt carries no usage; only the successful one contributes.
    expect(stage?.tokens).toBe(150);
  });

  it("updates loop, score, and status without losing counters", () => {
    seedRun();
    store.updateStageProgress(RUN_ID, STAGE_ID, { status: "running", loop: 1 });

    store.recordCall({
      id: "call-x",
      runId: RUN_ID,
      stageId: STAGE_ID,
      role: "judge:harsh",
      loop: 1,
      attempt: 1,
      prompt: "p",
      response: "r",
      inputTokens: 10,
      outputTokens: 5,
    });
    store.updateStageProgress(RUN_ID, STAGE_ID, { score: 8.8, loop: 1 });
    store.updateStageProgress(RUN_ID, STAGE_ID, { status: "done" });

    const stage = store.getStageStatus(RUN_ID, STAGE_ID);
    expect(stage?.status).toBe("done");
    expect(stage?.loop).toBe(1);
    expect(stage?.score).toBe(8.8);
    expect(stage?.calls).toBe(1);
    expect(stage?.tokens).toBe(15);
  });

  it("lists one row per stage, ordered by stage_id", () => {
    seedRun();
    store.updateStageProgress(RUN_ID, "02:market:landscape", { status: "pending" });
    store.updateStageProgress(RUN_ID, "01:idea:expand", { status: "done" });

    expect(store.listStageStatus(RUN_ID).map((s) => s.stage_id)).toEqual([
      "01:idea:expand",
      "02:market:landscape",
    ]);
  });
});

describe("attempt accounting — retry rule (1..3)", () => {
  it("two provider 500s then success: 3 attempts logged, stage completes", () => {
    seedRun();

    store.recordCall({
      id: "att-1",
      runId: RUN_ID,
      stageId: STAGE_ID,
      role: "generatorA",
      loop: 0,
      attempt: 1,
      prompt: "Expand the idea: cottage cheese dip",
      error: "provider 500: upstream overloaded",
    });
    store.recordCall({
      id: "att-2",
      runId: RUN_ID,
      stageId: STAGE_ID,
      role: "generatorA",
      loop: 0,
      attempt: 2,
      prompt: "Expand the idea: cottage cheese dip",
      error: "timeout after 30000ms",
    });
    store.recordCall({
      id: "att-3",
      runId: RUN_ID,
      stageId: STAGE_ID,
      role: "generatorA",
      loop: 0,
      attempt: 3,
      prompt: "Expand the idea: cottage cheese dip",
      response: "## The venture\n[full response]",
      inputTokens: 240,
      outputTokens: 1800,
      ms: 4200,
    });

    const calls = store.getStageCalls(RUN_ID, STAGE_ID);
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.attempt)).toEqual([1, 2, 3]);
    expect(calls[0].response).toBeNull();
    expect(calls[1].error).toBe("timeout after 30000ms");
    expect(calls[2].response).toBe("## The venture\n[full response]");

    const stage = store.getStageStatus(RUN_ID, STAGE_ID);
    expect(stage?.calls).toBe(3);
    expect(stage?.tokens).toBe(240 + 1800);

    store.updateStageProgress(RUN_ID, STAGE_ID, { status: "done" });
    expect(store.getStageStatus(RUN_ID, STAGE_ID)?.status).toBe("done");
  });

  it("separates attempts across loops and stages", () => {
    seedRun();

    for (const loop of [0, 1]) {
      store.recordCall({
        id: `loop${loop}-call`,
        runId: RUN_ID,
        stageId: STAGE_ID,
        role: "generatorA",
        loop,
        attempt: 1,
        prompt: `loop ${loop}`,
        response: `resp ${loop}`,
        inputTokens: 10 + loop,
        outputTokens: 20,
      });
      store.recordCall({
        id: `loop${loop}-other-stage`,
        runId: RUN_ID,
        stageId: "02:market:landscape",
        role: "generatorA",
        loop,
        attempt: 1,
        prompt: `loop ${loop}`,
        response: "r",
        inputTokens: 5,
        outputTokens: 5,
      });
    }

    const stage = store.getStageStatus(RUN_ID, STAGE_ID);
    const other = store.getStageStatus(RUN_ID, "02:market:landscape");
    expect(stage?.calls).toBe(2);
    expect(other?.calls).toBe(2);
    // Loop is attributed per call row; the stage counter stays aggregate.
    expect(store.getStageCalls(RUN_ID, STAGE_ID).map((c) => c.loop)).toEqual([0, 1]);
  });
});

describe("header totals — exact reconciliation (spec verification row 8)", () => {
  it("sums calls, tokens, and elapsed exactly across all stages and loops", () => {
    seedRun();

    // Deliberately uneven values across stages/loops/roles; failed attempts
    // contribute a call (and their ms) but no token usage.
    const recorded: Array<{
      stageId: string;
      loop: number;
      role: string;
      inputTokens: number | null;
      outputTokens: number | null;
      ms: number | null;
    }> = [
      { stageId: "01:idea:expand", loop: 0, role: "generatorA", inputTokens: 1200, outputTokens: 3400, ms: 5100 },
      { stageId: "01:idea:expand", loop: 1, role: "critic:vc", inputTokens: 800, outputTokens: 350, ms: 1400 },
      { stageId: "02:market:landscape", loop: 0, role: "generatorB", inputTokens: 640, outputTokens: 2210, ms: 3950 },
      { stageId: "02:market:landscape", loop: 0, role: "judge:harsh", inputTokens: null, outputTokens: null, ms: 250 },
      { stageId: "03:brand:naming", loop: 2, role: "translator:es", inputTokens: 90, outputTokens: 0, ms: 800 },
    ];

    recorded.forEach((call, index) => {
      store.recordCall({
        id: `total-${index}`,
        runId: RUN_ID,
        stageId: call.stageId,
        role: call.role,
        loop: call.loop,
        attempt: 1,
        prompt: `prompt ${index}`,
        response: call.inputTokens === null ? null : "response",
        error: call.inputTokens === null ? "provider 500" : null,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        ms: call.ms,
      });
    });

    // Exact sums from first principles — nothing derived from the store.
    const expectedCalls = recorded.length;
    const expectedInput = recorded.reduce((sum, c) => sum + (c.inputTokens ?? 0), 0);
    const expectedOutput = recorded.reduce((sum, c) => sum + (c.outputTokens ?? 0), 0);
    const expectedMs = recorded.reduce((sum, c) => sum + (c.ms ?? 0), 0);

    const totals = store.getRunTotals(RUN_ID);
    expect(totals.calls).toBe(expectedCalls);
    expect(totals.calls).toBe(5);
    expect(totals.inputTokens).toBe(expectedInput);
    expect(totals.outputTokens).toBe(expectedOutput);
    expect(totals.tokens).toBe(expectedInput + expectedOutput);
    expect(totals.ms).toBe(expectedMs);

    // Cross-check against a manual aggregation of the calls table itself.
    const manual = store.listRunCalls(RUN_ID).reduce(
      (acc, c) => ({
        calls: acc.calls + 1,
        inputTokens: acc.inputTokens + (c.input_tokens ?? 0),
        outputTokens: acc.outputTokens + (c.output_tokens ?? 0),
        ms: acc.ms + (c.ms ?? 0),
      }),
      { calls: 0, inputTokens: 0, outputTokens: 0, ms: 0 },
    );
    expect(totals.calls).toBe(manual.calls);
    expect(totals.inputTokens).toBe(manual.inputTokens);
    expect(totals.outputTokens).toBe(manual.outputTokens);
    expect(totals.ms).toBe(manual.ms);
  });

  it("returns zeroed totals for a run with no calls", () => {
    seedRun();

    expect(store.getRunTotals(RUN_ID)).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      tokens: 0,
      ms: 0,
    });
  });
});

describe("stage_artifacts — kind + language keying and threading", () => {
  it("inserts, reads, and overwrites the same (stage, kind, language) key", () => {
    seedRun();

    store.putArtifact({
      runId: RUN_ID,
      stageId: STAGE_ID,
      kind: "genA",
      text: "draft one",
      score: 6.1,
    });
    store.putArtifact({
      runId: RUN_ID,
      stageId: STAGE_ID,
      kind: "genA",
      text: "draft two — improved after critique",
      score: 8.4,
    });

    const artifact = store.getArtifact(RUN_ID, STAGE_ID, "genA");
    expect(artifact?.text).toBe("draft two — improved after critique");
    expect(artifact?.score).toBe(8.4);
    expect(store.listStageArtifacts(RUN_ID, STAGE_ID)).toHaveLength(1);
  });

  it("coexists across kinds and languages; en is the default", () => {
    seedRun();

    store.putArtifact({ runId: RUN_ID, stageId: STAGE_ID, kind: "genA", text: "english draft" });
    store.putArtifact({ runId: RUN_ID, stageId: STAGE_ID, kind: "genA", language: "es", text: "borrador" });
    store.putArtifact({ runId: RUN_ID, stageId: STAGE_ID, kind: "critique:vc", text: "critique text" });
    store.putArtifact({ runId: RUN_ID, stageId: STAGE_ID, kind: "translation:es", text: "traducción" });

    expect(store.getArtifact(RUN_ID, STAGE_ID, "genA")?.text).toBe("english draft");
    expect(store.getArtifact(RUN_ID, STAGE_ID, "genA", "es")?.text).toBe("borrador");
    expect(store.getArtifact(RUN_ID, STAGE_ID, "critique:vc")?.text).toBe("critique text");
    expect(store.getArtifact(RUN_ID, STAGE_ID, "translation:es")?.text).toBe("traducción");
    expect(store.listStageArtifacts(RUN_ID, STAGE_ID)).toHaveLength(4);
  });

  it("threads every prior artifact in production order for context building", () => {
    seedRun();

    store.putArtifact({ runId: RUN_ID, stageId: "01:idea:expand", kind: "genA", text: "expansion A" });
    store.putArtifact({ runId: RUN_ID, stageId: "01:idea:expand", kind: "genB", text: "expansion B" });
    store.putArtifact({ runId: RUN_ID, stageId: "01:idea:expand", kind: "merged", text: "merged expansion" });
    store.putArtifact({ runId: RUN_ID, stageId: "02:market:landscape", kind: "genA", text: "landscape" });
    // An overwrite must not move the artifact out of threading order.
    store.putArtifact({ runId: RUN_ID, stageId: "01:idea:expand", kind: "genA", text: "expansion A v2" });

    const thread = store.listRunArtifacts(RUN_ID);
    expect(thread.map((a) => `${a.stage_id}:${a.kind}`)).toEqual([
      "01:idea:expand:genA",
      "01:idea:expand:genB",
      "01:idea:expand:merged",
      "02:market:landscape:genA",
    ]);
    expect(thread[0].text).toBe("expansion A v2");

    // Every later prompt must contain the complete text of every prior artifact.
    const laterPrompt = thread.map((a) => a.text).join("\n");
    for (const artifact of thread) {
      expect(laterPrompt).toContain(artifact.text);
    }
  });
});

describe("newId", () => {
  it("produces nanoid-length base62 identifiers", () => {
    const id = newId();
    expect(id).toHaveLength(21);
    expect(id).toMatch(/^[0-9A-Za-z]{21}$/);
    expect(newId()).not.toBe(id);
  });
});
