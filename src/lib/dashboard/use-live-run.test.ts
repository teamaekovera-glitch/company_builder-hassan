/** Reconnect protocol — full-history replay rebuilds exactly once, terminal closes. */

import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { OrchestratorEvent } from "@/lib/orchestrator/events";
import {
  type LiveEventKind,
  type LiveEventSource,
  parseOrchestratorEvent,
  useLiveRun,
} from "./use-live-run";

const RUN_ID = "r-reconnect";

class FakeEventSource implements LiveEventSource {
  private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>([]);

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  addEventListener(type: LiveEventKind, listener: (event: MessageEvent<string>) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  /** Delivers one wire frame as the named SSE event kind. */
  emit(type: LiveEventKind, event: OrchestratorEvent): void {
    this.emitRaw(type, JSON.stringify(event));
  }

  /** Delivers an arbitrary (possibly malformed) wire frame. */
  emitRaw(type: LiveEventKind, data: string): void {
    act(() => {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(new MessageEvent(type, { data }));
      }
    });
  }

  open(): void {
    act(() => {
      this.onopen?.();
    });
  }

  drop(): void {
    act(() => {
      this.onerror?.();
    });
  }

  close(): void {
    this.closed = true;
  }
}

let seq = 0;
function event(kind: "run" | "stage" | "call", fields: Record<string, unknown>): OrchestratorEvent {
  seq += 1;
  return { kind, seq, ts: 1_000 + seq, runId: RUN_ID, ...fields } as OrchestratorEvent;
}

/** The replay the hub sends on every subscription — grows as the run progresses. */
function replay(extra: OrchestratorEvent[] = []): Array<[LiveEventKind, OrchestratorEvent]> {
  return [
    ["run", event("run", { status: "running" })],
    ["stage", event("stage", { stageId: "market-analysis", status: "running", loop: 0, score: null })],
    [
      "call",
      event("call", {
        stageId: "market-analysis",
        role: "researcher",
        loop: 0,
        attempt: 1,
        ok: true,
        inputTokens: 100,
        outputTokens: 50,
        ms: 300,
        error: null,
      }),
    ],
    ["stage", event("stage", { stageId: "market-analysis", status: "done", loop: 0, score: 9.3, calls: 1, tokens: 150 })],
    ...extra.map((e) => [e.kind, e] as [LiveEventKind, OrchestratorEvent]),
  ];
}

describe("useLiveRun", () => {
  it("subscribes to the run's event stream and applies the replay", () => {
    let source: FakeEventSource | undefined;
    const factory = (url: string) => {
      source = new FakeEventSource(url);
      return source;
    };

    const { result } = renderHook(() => useLiveRun(RUN_ID, factory));
    expect(source?.url).toBe(`/api/runs/${RUN_ID}/events`);
    expect(result.current.state.totals.calls).toBe(0);

    source?.open();
    for (const [kind, e] of replay()) source?.emit(kind, e);

    expect(result.current.state.totals.calls).toBe(1);
    expect(result.current.state.totals.tokens).toBe(150);
    expect(result.current.state.runStatus).toBe("running");
    expect(result.current.connected).toBe(true);
  });

  it("rebuilds totals exactly once when the stream drops and replays", () => {
    let source: FakeEventSource | undefined;
    const factory = (url: string) => {
      source = new FakeEventSource(url);
      return source;
    };

    const { result } = renderHook(() => useLiveRun(RUN_ID, factory));
    source?.open();
    for (const [kind, e] of replay()) source?.emit(kind, e);
    expect(result.current.state.totals.calls).toBe(1);

    // Connection drops; meanwhile the run advanced (the client missed it).
    source?.drop();
    expect(result.current.connected).toBe(false);
    const missed = event("call", {
      stageId: "market-analysis",
      role: "researcher",
      loop: 0,
      attempt: 2,
      ok: false,
      inputTokens: 30,
      outputTokens: 20,
      ms: 120,
      error: "rate limited: 429",
    });

    // Re-attach: the hub replays the FULL history again, missed call included.
    source?.open();
    for (const [kind, e] of replay([missed])) source?.emit(kind, e);

    expect(result.current.state.totals.calls).toBe(2);
    expect(result.current.state.totals.tokens).toBe(200);
    expect(result.current.state.totals.ms).toBe(420);
    expect(result.current.connected).toBe(true);
  });

  it("stops re-attaching once the run reaches a terminal status", () => {
    let source: FakeEventSource | undefined;
    const factory = (url: string) => {
      source = new FakeEventSource(url);
      return source;
    };

    const { result } = renderHook(() => useLiveRun(RUN_ID, factory));
    source?.open();
    source?.emit("run", event("run", { status: "completed" }));

    expect(source?.closed).toBe(true);
    expect(result.current.state.runStatus).toBe("completed");
  });

  it("logs malformed payloads without tearing down the stream", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let source: FakeEventSource | undefined;
    const factory = (url: string) => {
      source = new FakeEventSource(url);
      return source;
    };

    const { result } = renderHook(() => useLiveRun(RUN_ID, factory));
    source?.open();
    source?.emit(
      "call",
      event("call", { stageId: "s", role: "r", loop: 0, attempt: 1, ok: true, inputTokens: 5, outputTokens: 5, ms: 10, error: null }),
    );

    // A frame that is not a valid event must not crash the reducer…
    source?.emitRaw("call", "{{{");
    source?.emitRaw("call", JSON.stringify({ kind: "nonsense" }));
    expect(errorSpy).toHaveBeenCalledTimes(2);

    // …and the stream keeps working afterwards.
    source?.emit(
      "call",
      event("call", { stageId: "s", role: "r", loop: 0, attempt: 2, ok: true, inputTokens: 7, outputTokens: 7, ms: 10, error: null }),
    );
    expect(result.current.state.totals.calls).toBe(2);
    errorSpy.mockRestore();
  });
});

describe("parseOrchestratorEvent", () => {
  it("accepts well-formed events and rejects foreign shapes", () => {
    const good = parseOrchestratorEvent(
      JSON.stringify({ kind: "run", seq: 1, ts: 1, runId: "r", status: "running" }),
    );
    expect(good.kind).toBe("run");
    expect(() => parseOrchestratorEvent("not json")).toThrow();
    expect(() => parseOrchestratorEvent("null")).toThrow("not an object");
    expect(() => parseOrchestratorEvent(JSON.stringify({ kind: "other" }))).toThrow("unknown event kind");
  });
});
