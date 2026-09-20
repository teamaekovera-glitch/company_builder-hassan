/** Run lifecycle integration test — the orchestration acceptance path:
 * create (with pre-flight estimate) → explicit confirmation → wave-DAG
 * execution over the T6 executor → SSE event stream → totals reconciled to
 * the SQLite store; plus boot-after-kill interruption semantics.
 *
 * Execution uses the documented two-wave node subset (see test-support.ts
 * for the measured memory rationale) with the production executor, store,
 * and validation machinery — only the provider transport is scripted.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CRITIC_ROLES,
  GENERATOR_ROLES,
  IMPROVER_ROLE,
  JUDGE_ROLES,
  MERGER_ROLE,
  RECONCILER_ROLE,
} from "../pipeline/graph/roles";
import { createScriptedAdapter } from "../pipeline/executor/fixtures";
import { costFromTokens } from "./estimate";
import { EventedRunStore } from "./evented-store";
import { toPublishable } from "./events";
import { SSEHub } from "./hub";
import { Orchestrator, type RunSnapshot } from "./orchestrator";
import { handleConfirmRun, handleCreateRun, handleGetRun, handleRunEvents, type OrchestratorServices } from "./api";
import { gateConcurrency, ORCHESTRATION_TEST_NODES, type GatedAdapter } from "./test-support";

interface SSEFrame {
  kind: string;
  seq: number;
  status?: string;
  stageId?: string;
  role?: string;
  loop?: number;
  ok?: boolean;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

function parseSSE(text: string): SSEFrame[] {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.length > 0 && !chunk.startsWith(":"))
    .map((chunk) => {
      const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
      expect(dataLine, "every SSE frame carries a data line").toBeDefined();
      return JSON.parse((dataLine as string).slice("data: ".length)) as SSEFrame;
    });
}

/** Full one-round stage sequence: loop 0 drafts+merger, then critique round 1 (parallel phases in any order, serial phases fixed). */
function assertRoundRoleSequence(roles: readonly string[]): void {
  let i = 0;
  const takePhase = (expected: readonly string[]): void => {
    const slice = roles.slice(i, i + expected.length);
    expect(slice, `phase roles`).toEqual(expect.arrayContaining([...expected]));
    expect(slice).toHaveLength(expected.length);
    i += expected.length;
  };
  takePhase(GENERATOR_ROLES);
  expect(roles[i++]).toBe(MERGER_ROLE);
  takePhase(CRITIC_ROLES);
  expect(roles[i++]).toBe(IMPROVER_ROLE);
  takePhase(JUDGE_ROLES);
  expect(roles[i++]).toBe(RECONCILER_ROLE);
  expect(i).toBe(roles.length);
}

describe("run lifecycle (orchestrated execution)", () => {
  let store: EventedRunStore;
  let hub: SSEHub;
  let services: OrchestratorServices;
  let adapter: GatedAdapter;

  // SQLite prompt rows are megabytes each; temp dirs live on tmpfs, so every
  // store is removed after its test rather than left to accumulate.
  const tempDirs: string[] = [];
  const tempStorePath = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "lifecycle-"));
    tempDirs.push(dir);
    return join(dir, "store.sqlite3");
  };

  beforeEach(() => {
    store = new EventedRunStore(tempStorePath(), {
      onEvent: (event) => hub.publish(event.runId, toPublishable(event)),
    });
    hub = new SSEHub();
    adapter = gateConcurrency(
      createScriptedAdapter({ scores: () => 9.5 }),
      6, // wave 1 runs three loop stages × three generator calls — prove ≥6 launch concurrently
    );
    services = {
      hub,
      orchestrator: new Orchestrator({
        store,
        adapterFactory: () => adapter,
        nodes: ORCHESTRATION_TEST_NODES,
      }),
    };
  });

  afterEach(() => {
    store.close();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  it("creates, estimates, confirms, streams, and reconciles a full run", async () => {
    // ── Create: queued, with pre-flight estimate ────────────────────────────
    const createdRes = handleCreateRun(services, {
      idea: "A solar-powered cold chain for rural pharmacies",
      depth: "standard",
      languages: ["en"],
      scoreThreshold: 9.0,
    });
    expect(createdRes.status).toBe(201);
    const created = (await createdRes.json()) as { runId: string; estimate: { estimatedCalls: number } };
    const runId = created.runId;
    expect(created.estimate.estimatedCalls).toBeGreaterThan(0);
    expect(store.getRun(runId)?.status).toBe("queued");

    // ── Stream: open before confirm; the wire carries every persisted event ─
    const streamRes = handleRunEvents(services, runId, { heartbeatMs: 60_000 });
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");
    const streamText = streamRes.text();

    // ── Confirm: explicit gate; the response returns before execution ends ──
    const confirmRes = handleConfirmRun(services, runId);
    expect(confirmRes.status).toBe(202);

    const frames = parseSSE(await streamText);
    const runEvents = frames.filter((frame) => frame.kind === "run");
    const stageEvents = frames.filter((frame) => frame.kind === "stage");
    const callEvents = frames.filter((frame) => frame.kind === "call");

    // Terminal state on the wire: queued → running → completed, stream closed.
    expect(runEvents.map((frame) => frame.status)).toEqual(["queued", "running", "completed"]);

    // Monotonic per-run seq across every event kind.
    expect(frames.map((frame) => frame.seq)).toEqual(frames.map((_, index) => index + 1));

    // Stage ordering: wave 1 entirely precedes wave 2 on the wire.
    const wave1Ids = new Set<string>(ORCHESTRATION_TEST_NODES.filter((node) => node.wave === 1).map((node) => node.id));
    const wave2Ids = new Set<string>(ORCHESTRATION_TEST_NODES.filter((node) => node.wave === 2).map((node) => node.id));
    const lastWave1Index = Math.max(...stageEvents.map((frame, index) => (wave1Ids.has(frame.stageId ?? "") ? index : -1)));
    const firstWave2Index = Math.min(...stageEvents.map((frame, index) => (wave2Ids.has(frame.stageId ?? "") ? index : Infinity)));
    expect(firstWave2Index).toBeGreaterThan(lastWave1Index);

    // Every wave-1 stage started while the concurrency gate was closed.
    expect(adapter.maxObserved).toBeGreaterThanOrEqual(6);

    // Call ordering within one stage's round: gens ∥ → merger → critics ∥ →
    // improver → judges ∥ → reconciler.
    const firstWave2Stage = ORCHESTRATION_TEST_NODES.find((node) => wave2Ids.has(node.id))?.id as string;
    const roundRoles = callEvents
      .filter((frame) => frame.stageId === firstWave2Stage && frame.ok)
      .map((frame) => frame.role as string);
    assertRoundRoleSequence(roundRoles);

    // ── Totals reconcile to the SQLite store ────────────────────────────────
    const calls = store.listRunCalls(runId);
    expect(calls.length).toBe(callEvents.length);
    expect(calls.length).toBeGreaterThan(0);
    const tokens = calls.reduce((sum, call) => sum + (call.input_tokens ?? 0) + (call.output_tokens ?? 0), 0);

    const snapshotRes = handleGetRun(services, runId);
    expect(snapshotRes.status).toBe(200);
    const snapshot = (await snapshotRes.json()) as RunSnapshot;
    expect(snapshot.status).toBe("completed");
    expect(snapshot.totals.calls).toBe(calls.length);
    expect(snapshot.totals.tokens).toBe(tokens);
    expect(snapshot.totals.costUsd).toBe(
      costFromTokens({
        inputTokens: calls.reduce((sum, call) => sum + (call.input_tokens ?? 0), 0),
        outputTokens: calls.reduce((sum, call) => sum + (call.output_tokens ?? 0), 0),
      }),
    );

    // Every executed stage finished done with the 9.5 first-round score.
    const stageRows = store.listStageStatus(runId);
    expect(stageRows).toHaveLength(ORCHESTRATION_TEST_NODES.length);
    expect(stageRows.every((row) => row.status === "done")).toBe(true);
    expect(stageRows.every((row) => row.score === 9.5)).toBe(true);

    // Persisted config matches the request (including the stored strategy field set).
    expect(snapshot.config).toMatchObject({ depth: "standard", languages: ["en"], scoreThreshold: 9.0 });
  }, 180_000);

  it("marks a run killed mid-flight as interrupted on the next boot", async () => {
    // Freeze the transport: the gate never opens, so the run stays mid-flight
    // with its first stage `running` — the persisted state a killed process leaves.
    const frozen = gateConcurrency(createScriptedAdapter({ scores: () => 9.5 }), Number.MAX_SAFE_INTEGER, 3_600_000);
    const path = tempStorePath();

    const killedStore = new EventedRunStore(path);
    const killedServices: OrchestratorServices = {
      hub: new SSEHub(),
      orchestrator: new Orchestrator({
        store: killedStore,
        adapterFactory: () => frozen,
        nodes: ORCHESTRATION_TEST_NODES,
      }),
    };
    const createdRes = handleCreateRun(killedServices, { idea: "x", depth: "standard", languages: ["en"] });
    const { runId } = (await createdRes.json()) as { runId: string };
    expect(handleConfirmRun(killedServices, runId).status).toBe(202);
    expect(killedStore.getRun(runId)?.status).toBe("running");

    // "New process" on the same SQLite file: the boot sweep marks it interrupted.
    const rebootStore = new EventedRunStore(path);
    const rebootOrchestrator = new Orchestrator({ store: rebootStore });
    expect(rebootOrchestrator.markInterruptedRuns()).toEqual([runId]);

    const snapshotRes = handleGetRun(
      { hub: new SSEHub(), orchestrator: rebootOrchestrator },
      runId,
    );
    const snapshot = (await snapshotRes.json()) as RunSnapshot;
    expect(snapshot.status).toBe("interrupted");
    killedStore.close();
    rebootStore.close();
  }, 60_000);
});
