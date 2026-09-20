/**
 * API boundary tests: plain Request/Response over injected services — no
 * Next.js server. The SSE stream tests cover replay, live delivery, and
 * close-on-terminal using hub events published by the test itself.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createScriptedAdapter } from "../pipeline/executor/fixtures";
import {
  handleConfirmRun,
  handleCreateRun,
  handleEstimate,
  handleGetRun,
  handleListRuns,
  handleRunEvents,
  type OrchestratorServices,
} from "./api";
import { EventedRunStore } from "./evented-store";
import { SSEHub } from "./hub";
import { Orchestrator } from "./orchestrator";
import { ORCHESTRATION_TEST_NODES } from "./test-support";

function parseSSE(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.length > 0 && !chunk.startsWith(":"))
    .map((chunk) => {
      const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
      expect(dataLine, "each SSE frame carries a data line").toBeDefined();
      return JSON.parse((dataLine as string).slice("data: ".length)) as Record<string, unknown>;
    });
}

describe("orchestrator API handlers", () => {
  let store: EventedRunStore;
  let services: OrchestratorServices;

  beforeEach(() => {
    store = new EventedRunStore(join(mkdtempSync(join(tmpdir(), "api-")), "store.sqlite3"));
    services = {
      hub: new SSEHub(),
      orchestrator: new Orchestrator({
        store,
        adapterFactory: () => createScriptedAdapter({ scores: () => 9.5 }),
        nodes: ORCHESTRATION_TEST_NODES,
      }),
    };
  });

  afterEach(() => {
    store.close();
  });

  describe("handleEstimate", () => {
    it("returns the pre-flight estimate for a valid body", () => {
      const res = handleEstimate({ idea: "x", depth: "standard", languages: ["en"] });
      expect(res.status).toBe(200);
    });

    it("rejects an invalid body with 400 and named fields", async () => {
      const res = handleEstimate({ idea: "", depth: "nope" });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { fields: string[] };
      expect(body.fields).toEqual(["idea", "depth"]);
    });
  });

  describe("handleCreateRun", () => {
    it("creates a queued run and returns estimate plus follow-up URLs", async () => {
      const res = handleCreateRun(services, { idea: "x", depth: "standard", languages: ["en"] });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        runId: string;
        status: string;
        estimate: { estimatedCalls: number };
        confirmUrl: string;
        eventsUrl: string;
      };
      expect(body.status).toBe("queued");
      expect(body.confirmUrl).toBe(`/api/runs/${body.runId}/confirm`);
      expect(body.eventsUrl).toBe(`/api/runs/${body.runId}/events`);
      expect(body.estimate.estimatedCalls).toBeGreaterThan(0);
      expect(store.getRun(body.runId)?.status).toBe("queued");
    });

    it("rejects an invalid body with 400 without creating a run", () => {
      const res = handleCreateRun(services, { idea: "" });
      expect(res.status).toBe(400);
      expect(store.listRuns()).toEqual([]);
    });
  });

  describe("handleListRuns / handleGetRun", () => {
    it("lists runs lightly and serves the full snapshot", async () => {
      handleCreateRun(services, { idea: "first", depth: "standard", languages: ["en"] });
      handleCreateRun(services, { idea: "second", depth: "standard", languages: ["en"] });

      const list = (await handleListRuns(services).json()) as { runs: Array<{ idea: string }> };
      expect(list.runs).toHaveLength(2);
      // Same-millisecond creations tie on created_at and fall to random id
      // order — the listing contract is completeness, not cross-run ordering.
      expect(list.runs.map((row) => row.idea).sort()).toEqual(["first", "second"]);

      const runId = store.listRuns().find((row) => row.idea === "first")?.id as string;
      const snapshot = (await handleGetRun(services, runId).json()) as { stages: unknown[] };
      expect(snapshot).toMatchObject({ id: runId, idea: "first", status: "queued" });
      expect(snapshot.stages).toEqual([]);
    });

    it("404s an unknown run", () => {
      expect(handleGetRun(services, "missing").status).toBe(404);
    });
  });

  describe("handleConfirmRun", () => {
    it("404s an unknown run and 409s a run that is not queued", () => {
      expect(handleConfirmRun(services, "missing").status).toBe(404);
      store.createRun({ id: "done", idea: "x", config: {}, status: "completed" });
      expect(handleConfirmRun(services, "done").status).toBe(409);
    });

    it("accepts confirmation with 202 and runs to completion", async () => {
      const { runId } = services.orchestrator.createRun({ idea: "x", depth: "standard", languages: ["en"] });
      const res = handleConfirmRun(services, runId);
      expect(res.status).toBe(202);
      // The response returns before execution finishes; wait for the run row.
      while (store.getRun(runId)?.status !== "completed") {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(store.getRun(runId)?.status).toBe("completed");
    }, 120_000);
  });

  describe("handleRunEvents", () => {
    it("404s an unknown run", () => {
      expect(handleRunEvents(services, "missing").status).toBe(404);
    });

    it("replays history, streams live events, and closes on the terminal event", async () => {
      const runId = "stream-run";
      // The run row must exist (production events always follow a store row)
      // and carry a real config — the snapshot endpoint recomputes its
      // estimate from it on every request.
      store.createRun({
        id: runId,
        idea: "x",
        config: { depth: "standard", languages: ["en"], scoreThreshold: 9 },
      });
      services.hub.publish(runId, { kind: "run", runId, status: "queued" });
      services.hub.publish(runId, { kind: "run", runId, status: "running" });

      const res = handleRunEvents(services, runId, { heartbeatMs: 60_000 });
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      // Live events after the replay window; the terminal status closes the stream.
      const textPromise = res.text();
      await new Promise((resolve) => setTimeout(resolve, 50));
      services.hub.publish(runId, { kind: "stage", runId, stageId: "s1", status: "running", loop: 0, score: null });
      services.hub.publish(runId, { kind: "run", runId, status: "failed" });

      const events = parseSSE(await textPromise);
      expect(events).toHaveLength(4); // 2 replayed + 2 live
      expect(events.map((event) => event.kind)).toEqual(["run", "run", "stage", "run"]);
      expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
      expect(events.at(-1)).toMatchObject({ kind: "run", status: "failed" });
    }, 30_000);
  });
});
