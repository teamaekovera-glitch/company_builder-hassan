/**
 * Rerun/alternatives integration tests (spec verification row 12): stricter
 * and 3-alternatives reruns create fresh runs (never overwrite the source),
 * the strategy angle reaches every prompt of a member run, and the single
 * comparison call records verbatim on the source run — success and failure.
 *
 * Execution uses the production executor, store, and validation machinery
 * over the two-wave node subset (see test-support.ts) with the scripted
 * adapter — only the provider transport is scripted.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompletionRequest, LLMAdapter } from "../llm/types";
import { createScriptedAdapter } from "../pipeline/executor/fixtures";
import { roleFromSystem } from "../pipeline/executor/prompt";
import { EventedRunStore } from "./evented-store";
import { COMPARISON_ROLE, COMPARISON_STAGE_ID, Orchestrator, STRATEGY_ANGLES } from "./orchestrator";
import { ORCHESTRATION_TEST_NODES } from "./test-support";

const IDEA = "A solar-powered cold chain for rural pharmacies";

describe("rerun controls (spec row 12)", () => {
  let store: EventedRunStore;
  let dir: string;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reruns-"));
    store = new EventedRunStore(join(dir, "store.sqlite"));
    orchestrator = new Orchestrator({
      store,
      adapterFactory: () => createScriptedAdapter({ scores: () => 9.5 }),
      nodes: ORCHESTRATION_TEST_NODES,
    });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Drives a queued run through the explicit confirm gate to completion. */
  async function runToCompletion(engine: Orchestrator, runId: string): Promise<void> {
    await engine.confirmRun(runId);
    expect(store.getRun(runId)?.status).toBe("completed");
  }

  function createSource(): string {
    const created = orchestrator.createRun({ idea: IDEA, depth: "standard", languages: ["en", "es"], scoreThreshold: 9.0 });
    return created.runId;
  }

  function configOf(runId: string): { depth?: string; languages?: string[]; scoreThreshold?: number; strategyAngle?: string } {
    return JSON.parse(store.getRun(runId)?.config_json ?? "{}");
  }

  it("rerunStricter creates a fresh queued run at the 9.5 gate and leaves the source untouched", async () => {
    const sourceId = createSource();
    await runToCompletion(orchestrator, sourceId);
    const before = {
      run: store.getRun(sourceId),
      artifacts: store.listRunArtifacts(sourceId),
      calls: store.listRunCalls(sourceId),
    };

    const rerun = orchestrator.rerunStricter(sourceId);
    expect(rerun.runId).not.toBe(sourceId);

    const row = store.getRun(rerun.runId);
    expect(row?.status).toBe("queued");
    expect(row?.idea).toBe(IDEA);
    const config = configOf(rerun.runId);
    expect(config.scoreThreshold).toBe(9.5);
    expect(config.depth).toBe("standard");
    expect(config.languages).toEqual(["en", "es"]);

    // Nothing about the source run moved — no overwrite, no new rows.
    expect(store.getRun(sourceId)).toEqual(before.run);
    expect(store.listRunArtifacts(sourceId)).toEqual(before.artifacts);
    expect(store.listRunCalls(sourceId)).toEqual(before.calls);
  });

  it("rerunAlternatives creates three queued runs, one per strategy angle, and leaves the source untouched", async () => {
    const sourceId = createSource();
    await runToCompletion(orchestrator, sourceId);
    const before = { run: store.getRun(sourceId), artifacts: store.listRunArtifacts(sourceId).length };

    const members = orchestrator.rerunAlternatives(sourceId);
    expect(members).toHaveLength(3);
    expect(new Set(members.map((m) => m.runId)).size).toBe(3);
    const angles = members.map((m) => configOf(m.runId).strategyAngle);
    expect(angles).toEqual([...STRATEGY_ANGLES]);
    for (const member of members) {
      expect(store.getRun(member.runId)?.status).toBe("queued");
      expect(store.getRun(member.runId)?.idea).toBe(IDEA);
      expect(configOf(member.runId).scoreThreshold).toBe(9.0);
    }

    expect(store.getRun(sourceId)).toEqual(before.run);
    expect(store.listRunArtifacts(sourceId)).toHaveLength(before.artifacts);
  });

  it("the strategy angle is injected into every prompt of a member run", async () => {
    const sourceId = createSource();
    await runToCompletion(orchestrator, sourceId);
    const [member] = orchestrator.rerunAlternatives(sourceId);
    if (!member) throw new Error("expected one member run");

    await runToCompletion(orchestrator, member.runId);

    const calls = store.listRunCalls(member.runId);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.prompt).toContain("Strategy angle: bootstrapped.");
    }
  });

  it("compareAlternatives records one verbatim comparison call and artifact on the source run", async () => {
    const sourceId = createSource();
    await runToCompletion(orchestrator, sourceId);
    const members = orchestrator.rerunAlternatives(sourceId);
    for (const member of members) await runToCompletion(orchestrator, member.runId);

    const result = await orchestrator.compareAlternatives(sourceId, members.map((m) => m.runId));
    expect(result.stageId).toBe(COMPARISON_STAGE_ID);

    const comparisonCalls = store.listRunCalls(sourceId).filter((c) => c.stage_id === COMPARISON_STAGE_ID);
    expect(comparisonCalls).toHaveLength(1);
    const comparison = comparisonCalls[0];
    if (!comparison) throw new Error("expected the comparison call");
    expect(comparison.role).toBe(COMPARISON_ROLE);
    expect(comparison.response).toBe(result.comparison);
    // The three member dossiers reached the prompt, each under its angle.
    expect(comparison.prompt).toContain("# Alternative — bootstrapped");
    expect(comparison.prompt).toContain("# Alternative — vc-scale");
    expect(comparison.prompt).toContain("# Alternative — enterprise-first");

    const artifact = store.getArtifact(sourceId, COMPARISON_STAGE_ID, COMPARISON_ROLE);
    expect(artifact?.text).toBe(result.comparison);
  });

  it("compareAlternatives rejects while a member run is not completed", async () => {
    const sourceId = createSource();
    await runToCompletion(orchestrator, sourceId);
    const members = orchestrator.rerunAlternatives(sourceId);
    const first = members[0];
    if (!first) throw new Error("expected member runs");
    await runToCompletion(orchestrator, first.runId);

    await expect(
      orchestrator.compareAlternatives(sourceId, members.map((m) => m.runId)),
    ).rejects.toThrow(/needs every member run completed/);
  });

  it("a failed comparison is recorded verbatim on the source run and rethrown", async () => {
    const inner = createScriptedAdapter({ scores: () => 9.5 });
    // Same scripted transport, but the comparison role always explodes.
    const failing: LLMAdapter = {
      model: inner.model,
      async complete(req: CompletionRequest) {
        if (roleFromSystem(req.system) === COMPARISON_ROLE) {
          throw new Error("comparison provider exploded");
        }
        return inner.complete(req);
      },
    };
    const engine = new Orchestrator({ store, adapterFactory: () => failing, nodes: ORCHESTRATION_TEST_NODES });

    const sourceId = createSource();
    await runToCompletion(engine, sourceId);
    const members = engine.rerunAlternatives(sourceId);
    for (const member of members) await runToCompletion(engine, member.runId);

    await expect(
      engine.compareAlternatives(sourceId, members.map((m) => m.runId)),
    ).rejects.toThrow("comparison provider exploded");

    const comparisonCalls = store.listRunCalls(sourceId).filter((c) => c.stage_id === COMPARISON_STAGE_ID);
    expect(comparisonCalls).toHaveLength(1);
    const comparison = comparisonCalls[0];
    if (!comparison) throw new Error("expected the failed comparison call");
    expect(comparison.error).toBe("comparison provider exploded");
    expect(comparison.response).toBeNull();
    // No artifact was written for the failed attempt — the run log holds it.
    expect(store.getArtifact(sourceId, COMPARISON_STAGE_ID, COMPARISON_ROLE)).toBeUndefined();
  });
});
