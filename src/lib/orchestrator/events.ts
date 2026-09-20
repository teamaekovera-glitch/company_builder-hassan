/**
 * Event model for the orchestrator's realtime channel (spec design
 * principle: "SSE is the only realtime channel — 'live' means per-call
 * events").
 *
 * Three granularities share one envelope: run lifecycle, stage progress,
 * and per-call attempts. The SSE hub stamps every event with a per-run
 * monotonic `seq` (ordering + reconnect de-dup) and a `ts` (broadcast
 * time); durable state lives in SQLite, never in the event log itself.
 */

import type { RunStatus, StageStatus } from "../store/schema";
import type { StoreEvent } from "./evented-store";

interface EventBase {
  /** Per-run monotonic sequence, assigned by the hub on publish. */
  seq: number;
  /** Broadcast time (ms since epoch). */
  ts: number;
  runId: string;
}

/** A run lifecycle transition: queued | running | completed | failed | interrupted. */
export interface RunEvent extends EventBase {
  kind: "run";
  status: RunStatus;
}

/** A stage progress transition (status/loop/score as persisted). */
export interface StageEvent extends EventBase {
  kind: "stage";
  stageId: string;
  status: StageStatus;
  loop: number;
  score: number | null;
}

/** One recorded call attempt — success or failure, as persisted. */
export interface CallEvent extends EventBase {
  kind: "call";
  stageId: string;
  role: string;
  loop: number;
  attempt: number;
  /** False for failed attempts (validation miss or transport error). */
  ok: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  ms: number | null;
  /** Verbatim error for failed attempts. */
  error: string | null;
}

export type OrchestratorEvent = RunEvent | StageEvent | CallEvent;

/** Hub input before seq/ts stamping (distributed omit keeps the union). */
export type PublishableEvent =
  | Omit<RunEvent, "seq" | "ts">
  | Omit<StageEvent, "seq" | "ts">
  | Omit<CallEvent, "seq" | "ts">;

/** Run statuses that end an event stream — no further events can follow. */
export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "interrupted";
}

/** Maps a persisted store mutation to its event. Pure and total. */
export function toPublishable(event: StoreEvent): PublishableEvent {
  switch (event.type) {
    case "run":
      return { kind: "run", runId: event.runId, status: event.status };
    case "stage":
      return {
        kind: "stage",
        runId: event.runId,
        stageId: event.stageId,
        status: event.status,
        loop: event.loop,
        score: event.score,
      };
    case "call":
      return {
        kind: "call",
        runId: event.runId,
        stageId: event.stageId,
        role: event.role,
        loop: event.loop,
        attempt: event.attempt,
        ok: event.ok,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        ms: event.ms,
        error: event.error,
      };
  }
}
