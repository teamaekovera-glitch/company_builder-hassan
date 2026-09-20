/**
 * SSE hub — per-run event log with live fan-out (spec component table:
 * "Broadcasts run events to any number of connected tabs; replays event
 * history on reconnect so a reloaded page never misses an update").
 *
 * Delivery is synchronous and single-threaded: `subscribe` first replays the
 * full per-run history to the new listener, then registers it for live
 * events. There is no await between the two, so a reloaded page can neither
 * miss an event nor receive a duplicate across the replay/live boundary —
 * clients that still want to de-dup can use the monotonic per-run `seq`.
 */

import type { OrchestratorEvent, PublishableEvent } from "./events";

export type EventListener = (event: OrchestratorEvent) => void;

/** Unsubscribe function returned by `subscribe`. */
export type Unsubscribe = () => void;

export class SSEHub {
  /** Next seq per run — events are numbered from 1 in publish order. */
  private readonly nextSeq = new Map<string, number>();
  /** Full per-run event history for replay. */
  private readonly history = new Map<string, OrchestratorEvent[]>();
  /** Live listeners per run. */
  private readonly listeners = new Map<string, Set<EventListener>>();

  /**
   * Stamps the event with the run's next seq/ts, appends it to the run's
   * history, and delivers it to every live listener — all synchronously, in
   * that order, so the log is complete before (and while) anyone is told.
   */
  publish(runId: string, event: PublishableEvent): OrchestratorEvent {
    const seq = (this.nextSeq.get(runId) ?? 0) + 1;
    this.nextSeq.set(runId, seq);
    const stamped: OrchestratorEvent = (() => {
      switch (event.kind) {
        case "run":
          return { ...event, seq, ts: Date.now() };
        case "stage":
          return { ...event, seq, ts: Date.now() };
        case "call":
          return { ...event, seq, ts: Date.now() };
      }
    })();

    const log = this.history.get(runId);
    if (log) log.push(stamped);
    else this.history.set(runId, [stamped]);

    const subs = this.listeners.get(runId);
    if (subs) {
      for (const listener of subs) listener(stamped);
    }
    return stamped;
  }

  /**
   * Replays the run's full history to the listener synchronously, then
   * registers it for live events. Returns the unsubscribe function
   * (idempotent).
   */
  subscribe(runId: string, listener: EventListener): Unsubscribe {
    const log = this.history.get(runId) ?? [];
    for (const event of log) listener(event);
    let subs = this.listeners.get(runId);
    if (!subs) {
      subs = new Set();
      this.listeners.set(runId, subs);
    }
    subs.add(listener);
    return () => {
      subs.delete(listener);
    };
  }

  /** The run's full event history so far (empty for unknown runs). */
  events(runId: string): readonly OrchestratorEvent[] {
    return this.history.get(runId) ?? [];
  }
}
