/**
 * Orchestrator unit tests: config validation, run creation, confirmation
 * guards, snapshot totals, and the boot sweep that marks mid-flight runs
 * interrupted. Execution itself is covered by run-lifecycle.test.ts.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RUN_CONFIG } from "../pipeline/executor";
import { createScriptedAdapter } from "../pipeline/executor/fixtures";
import { EventedRunStore } from "./evented-store";
import {
  MAX_IDEA_LENGTH,
  Orchestrator,
  RunNotFoundError,
  RunNotQueuedError,
  RunValidationError,
  validateRunInput,
} from "./orchestrator";
import { ORCHESTRATION_TEST_NODES } from "./test-support";

function newStore(): EventedRunStore {
  const dir = mkdtempSync(join(tmpdir(), "orchestrator-"));
  return new EventedRunStore(join(dir, "store.sqlite3"));
}

const validAdapter = () => createScriptedAdapter({ scores: () => 9.5 });

describe("validateRunInput", () => {
  it("accepts a full body", () => {
    const input = validateRunInput({
      idea: "A rare-book subscription service",
      depth: "deep",
      languages: ["en", "ja"],
      scoreThreshold: 9.5,
      strategyAngle: "bootstrapped",
    });
    expect(input).toEqual({
      idea: "A rare-book subscription service",
      depth: "deep",
      languages: ["en", "ja"],
      scoreThreshold: 9.5,
      strategyAngle: "bootstrapped",
    });
  });

  it("defaults: extreme depth, executor default languages, 9.0 gate", () => {
    const input = validateRunInput({ idea: "x" });
    expect(input.depth).toBe("extreme");
    expect(input.languages).toEqual(DEFAULT_RUN_CONFIG.languages);
    expect(input.scoreThreshold).toBe(9.0);
    expect(input.strategyAngle).toBeUndefined();
  });

  it("trims the idea and rejects empty or oversized ones", () => {
    expect(validateRunInput({ idea: "  padded  " }).idea).toBe("padded");
    expect(() => validateRunInput({ idea: "   " })).toThrow(RunValidationError);
    expect(() => validateRunInput({ idea: "x".repeat(MAX_IDEA_LENGTH + 1) })).toThrow(RunValidationError);
    expect(() => validateRunInput({})).toThrow(RunValidationError);
  });

  it("names every invalid field", () => {
    try {
      validateRunInput({
        idea: "",
        depth: "absurd",
        languages: ["klingon"],
        scoreThreshold: 11,
        strategyAngle: "yolo",
      });
      expect.unreachable("expected RunValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(RunValidationError);
      const fields = (err as RunValidationError).fields;
      expect(fields).toEqual(["idea", "depth", "languages", "scoreThreshold", "strategyAngle"]);
    }
  });

  it("dedupes languages but keeps at least one", () => {
    expect(validateRunInput({ idea: "x", languages: ["en", "en", "de"] }).languages).toEqual(["en", "de"]);
    expect(() => validateRunInput({ idea: "x", languages: [] })).toThrow(RunValidationError);
  });

  it("rejects a non-object body", () => {
    expect(() => validateRunInput(null)).toThrow(RunValidationError);
    expect(() => validateRunInput(42)).toThrow(RunValidationError);
  });
});

describe("Orchestrator", () => {
  let store: EventedRunStore;

  beforeEach(() => {
    store = newStore();
  });

  afterEach(() => {
    store.close();
  });

  it("creates a queued run with its estimate and snapshot", () => {
    const orchestrator = new Orchestrator({ store, adapterFactory: validAdapter });
    const created = orchestrator.createRun({
      idea: "Off-grid solar leasing for rural clinics",
      depth: "standard",
      languages: ["en"],
      scoreThreshold: 9.0,
      strategyAngle: "vc-scale",
    });

    expect(created.estimate.loopCap).toBe(1);
    expect(created.estimate.languageCount).toBe(1);
    expect(created.snapshot.status).toBe("queued");
    expect(created.snapshot.idea).toBe("Off-grid solar leasing for rural clinics");
    expect(created.snapshot.config.strategyAngle).toBe("vc-scale");
    expect(created.snapshot.totals.calls).toBe(0);
    expect(created.snapshot.stages).toEqual([]);

    const run = store.getRun(created.runId);
    expect(run?.status).toBe("queued");
    expect(JSON.parse(run?.config_json ?? "{}")).toMatchObject({ depth: "standard", strategyAngle: "vc-scale" });
  });

  it("refuses to confirm an unknown run", () => {
    const orchestrator = new Orchestrator({ store, adapterFactory: validAdapter });
    expect(() => orchestrator.confirmRun("nope")).toThrow(RunNotFoundError);
  });

  it("refuses to confirm a run that already left queued", () => {
    const orchestrator = new Orchestrator({ store, adapterFactory: validAdapter });
    store.createRun({ id: "done-run", idea: "x", config: { ...DEFAULT_RUN_CONFIG }, status: "completed" });
    store.createRun({ id: "dead-run", idea: "x", config: { ...DEFAULT_RUN_CONFIG }, status: "interrupted" });

    expect(() => orchestrator.confirmRun("done-run")).toThrow(RunNotQueuedError);
    expect(() => orchestrator.confirmRun("dead-run")).toThrow(RunNotQueuedError);
  });

  it("refuses a second concurrent confirmation of the same run", async () => {
    const orchestrator = new Orchestrator({
      store,
      adapterFactory: validAdapter,
      nodes: ORCHESTRATION_TEST_NODES,
    });
    const { runId } = orchestrator.createRun({ idea: "x", depth: "standard", languages: ["en"] });
    const done = orchestrator.confirmRun(runId);
    expect(() => orchestrator.confirmRun(runId)).toThrow(RunNotQueuedError);
    await done;
    expect((await done).status).toBe("completed");
    // After completion the run is no longer queued — confirmation stays closed.
    expect(() => orchestrator.confirmRun(runId)).toThrow(RunNotQueuedError);
  });

  it("snapshot totals reconcile to recorded calls with cost from usage", () => {
    const orchestrator = new Orchestrator({ store, adapterFactory: validAdapter });
    const { runId } = orchestrator.createRun({ idea: "x", depth: "standard", languages: ["en"] });
    store.recordCall({
      id: "c1",
      runId,
      stageId: "market-analysis",
      role: "gen-a",
      loop: 0,
      attempt: 1,
      prompt: "p",
      response: "r",
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      ms: 5,
    });

    const snapshot = orchestrator.getSnapshot(runId);
    expect(snapshot?.totals.calls).toBe(1);
    expect(snapshot?.totals.tokens).toBe(1_100_000);
    expect(snapshot?.totals.costUsd).toBeCloseTo(1_000_000 / 1e6 * 2.5 + 100_000 / 1e6 * 10, 6);
  });

  it("getSnapshot returns undefined for an unknown run", () => {
    const orchestrator = new Orchestrator({ store });
    expect(orchestrator.getSnapshot("missing")).toBeUndefined();
  });
});

describe("boot sweep (markInterruptedRuns)", () => {
  it("marks a run found mid-flight as interrupted, and only that run", () => {
    const dir = mkdtempSync(join(tmpdir(), "orchestrator-boot-"));
    const path = join(dir, "store.sqlite3");

    // "Previous process": one run killed mid-flight, one finished, one never confirmed.
    const first = new EventedRunStore(path);
    first.createRun({ id: "mid-flight", idea: "x", config: {} });
    first.setRunStatus("mid-flight", "running");
    first.createRun({ id: "finished", idea: "x", config: {}, status: "completed" });
    first.createRun({ id: "unconfirmed", idea: "x", config: {}, status: "queued" });
    first.close();

    // "New process": boot sweep marks the mid-flight run interrupted.
    const second = new EventedRunStore(path);
    const orchestrator = new Orchestrator({ store: second });
    expect(orchestrator.markInterruptedRuns()).toEqual(["mid-flight"]);
    expect(second.getRun("mid-flight")?.status).toBe("interrupted");
    expect(second.getRun("finished")?.status).toBe("completed");
    expect(second.getRun("unconfirmed")?.status).toBe("queued");

    // Idempotent: a second boot finds nothing to interrupt.
    expect(orchestrator.markInterruptedRuns()).toEqual([]);
    second.close();
  });

  it("emits a run event when the sweep interrupts a run", () => {
    const events: string[] = [];
    const store = new EventedRunStore(join(mkdtempSync(join(tmpdir(), "orchestrator-boot2-")), "s.sqlite3"), {
      onEvent: (event) => {
        if (event.type === "run") events.push(`${event.runId}:${event.status}`);
      },
    });
    store.createRun({ id: "r1", idea: "x", config: {} });
    store.setRunStatus("r1", "running");
    events.length = 0; // only observe the sweep from here

    const orchestrator = new Orchestrator({ store });
    orchestrator.markInterruptedRuns();
    expect(events).toEqual(["r1:interrupted"]);
    store.close();
  });
});
