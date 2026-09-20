/** SSE hub: seq stamping, replay-on-subscribe, live fan-out, unsubscribe, per-run isolation. */

import { describe, expect, it } from "vitest";
import { SSEHub } from "./hub";

describe("SSEHub", () => {
  it("stamps monotonic seq and a ts on every event", () => {
    const hub = new SSEHub();
    const runId = "r1";
    const a = hub.publish(runId, { kind: "run", runId, status: "queued" });
    const b = hub.publish(runId, { kind: "run", runId, status: "running" });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(a.ts).toBeGreaterThan(0);
  });

  it("replays full history on subscribe, then delivers live events", () => {
    const hub = new SSEHub();
    const runId = "r1";
    hub.publish(runId, { kind: "run", runId, status: "queued" });
    hub.publish(runId, { kind: "run", runId, status: "running" });

    const seen: string[] = [];
    hub.subscribe(runId, (event) => seen.push(`${event.kind}:${event.seq}`));

    hub.publish(runId, { kind: "stage", runId, stageId: "s1", status: "running", loop: 0, score: null });
    expect(seen).toEqual(["run:1", "run:2", "stage:3"]);
  });

  it("stops delivering after unsubscribe (idempotent)", () => {
    const hub = new SSEHub();
    const runId = "r1";
    const seen: number[] = [];
    const unsubscribe = hub.subscribe(runId, (event) => seen.push(event.seq));
    hub.publish(runId, { kind: "run", runId, status: "queued" });
    unsubscribe();
    unsubscribe();
    hub.publish(runId, { kind: "run", runId, status: "running" });
    expect(seen).toEqual([1]);
  });

  it("fans out to multiple listeners and isolates runs", () => {
    const hub = new SSEHub();
    const a: number[] = [];
    const b: number[] = [];
    const c: number[] = [];
    hub.subscribe("r1", (event) => a.push(event.seq));
    hub.subscribe("r1", (event) => b.push(event.seq));
    hub.subscribe("r2", (event) => c.push(event.seq));

    hub.publish("r1", { kind: "run", runId: "r1", status: "queued" });
    hub.publish("r2", { kind: "run", runId: "r2", status: "queued" });

    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
    expect(c).toEqual([1]);
    expect(hub.events("r1")).toHaveLength(1);
  });

  it("events() is empty for an unknown run", () => {
    expect(new SSEHub().events("nope")).toEqual([]);
  });
});
