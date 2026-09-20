/**
 * Reconnect-aware SSE subscription for one run (client only).
 *
 * Wire contract (T7 hub): the events route replays the run's FULL event
 * history synchronously on every subscription, then fans out live. So the
 * correct client protocol on every (re)connection is reset-to-empty and
 * re-apply — the reducer's overwrite semantics make replay rebuild exactly,
 * and totals can never accumulate twice across reconnects.
 *
 * The source is injectable so tests can drive connect / drop / re-replay
 * without a network; the browser adapter wraps the global EventSource.
 */

import { useEffect, useState } from "react";
import { isTerminalRunStatus, type OrchestratorEvent } from "@/lib/orchestrator/events";
import { applyRunEvent, initialLiveState, type RunLiveState } from "./live-model";

/** The three event kinds the hub names on the SSE stream. */
export type LiveEventKind = OrchestratorEvent["kind"];

/** Minimal EventSource shape the hook needs — named events + lifecycle. */
export interface LiveEventSource {
  addEventListener(type: LiveEventKind, listener: (event: MessageEvent<string>) => void): void;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

export type LiveEventSourceFactory = (url: string) => LiveEventSource;

/** Wraps the global EventSource; named SSE events arrive as MessageEvents. */
export function browserEventSource(url: string): LiveEventSource {
  const source = new EventSource(url);
  return {
    addEventListener(type, listener) {
      source.addEventListener(type, (event) => listener(event as MessageEvent<string>));
    },
    get onopen() {
      // The concrete handlers carry a `this: EventSource` param the minimal
      // interface deliberately drops — adapt once, here.
      return source.onopen as (() => void) | null;
    },
    set onopen(handler) {
      source.onopen = handler;
    },
    get onerror() {
      return source.onerror as (() => void) | null;
    },
    set onerror(handler) {
      source.onerror = handler;
    },
    close() {
      source.close();
    },
  };
}

const defaultFactory: LiveEventSourceFactory = (url) => browserEventSource(url);

/** Validates one SSE payload into an OrchestratorEvent (never trusts the wire). */
export function parseOrchestratorEvent(raw: string): OrchestratorEvent {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("event payload is not an object");
  }
  const kind = (parsed as { kind?: unknown }).kind;
  if (kind !== "run" && kind !== "stage" && kind !== "call") {
    throw new Error(`unknown event kind: ${String(kind)}`);
  }
  return parsed as OrchestratorEvent;
}

export interface UseLiveRunResult {
  /** Live state rebuilt from the replayed event history. */
  state: RunLiveState;
  /** False while the stream is connecting or re-attaching after a drop. */
  connected: boolean;
}

/**
 * Subscribes to `/api/runs/:id/events` for the life of the component.
 * The browser re-attaches automatically on network drops (Last-Event-ID);
 * every re-attachment gets a full replay, which this hook applies over a
 * fresh state — no polling, no double counting.
 */
export function useLiveRun(
  runId: string,
  factory: LiveEventSourceFactory = defaultFactory,
): UseLiveRunResult {
  const [state, setState] = useState<RunLiveState>(initialLiveState);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = factory(`/api/runs/${runId}/events`);

    const apply = (raw: string) => {
      let event: OrchestratorEvent;
      try {
        event = parseOrchestratorEvent(raw);
      } catch (err) {
        // A malformed payload must be visible, not silent — but it must not
        // tear down the stream (one bad frame is not a broken connection).
        console.error("Ignoring malformed SSE event:", err);
        return;
      }
      setState((prev) => applyRunEvent(prev, event));
      if (event.kind === "run" && isTerminalRunStatus(event.status)) {
        // The hub closes the stream at terminal status; stop re-attaching.
        source.close();
      }
    };

    const onEvent = (event: MessageEvent<string>) => apply(event.data);

    source.onopen = () => {
      setConnected(true);
      // Full-history replay follows — restart from empty (see module docs).
      setState(initialLiveState());
    };
    source.addEventListener("run", onEvent);
    source.addEventListener("stage", onEvent);
    source.addEventListener("call", onEvent);
    source.onerror = () => setConnected(false);

    return () => source.close();
  }, [runId, factory]);

  return { state, connected };
}
