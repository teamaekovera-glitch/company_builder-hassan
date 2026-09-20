/**
 * Store → event bridge. Subclasses the run store and emits one event after
 * each mutating write lands, so the executor's contract with the realtime
 * layer — persisted before broadcast — holds by construction: an event can
 * never describe state the store did not already accept.
 *
 * The SSE hub (T7) subscribes to these emissions; nothing else changes. All
 * executor and store call sites keep working untouched because the public
 * surface is inherited, not reimplemented.
 */

import {
  RunStore,
  type CreateRunInput,
  type RecordCallInput,
  type StageProgressPatch,
} from "../store/store";
import type { RunStatus, StageStatus } from "../store/schema";

/** Emitted after the corresponding store mutation has been persisted. */
export type StoreEvent =
  | { type: "run"; runId: string; status: RunStatus }
  | {
      type: "call";
      runId: string;
      stageId: string;
      role: string;
      loop: number;
      attempt: number;
      ok: boolean;
      inputTokens: number | null;
      outputTokens: number | null;
      ms: number | null;
      error: string | null;
    }
  | {
      type: "stage";
      runId: string;
      stageId: string;
      status: StageStatus;
      loop: number;
      score: number | null;
    };

export type StoreEventHandler = (event: StoreEvent) => void;

const NOOP: StoreEventHandler = () => {};

export interface EventedRunStoreOptions {
  now?: () => number;
  /** Called synchronously after each persisted mutation. */
  onEvent?: StoreEventHandler;
}

export class EventedRunStore extends RunStore {
  private readonly onStoreEvent: StoreEventHandler;

  constructor(path: string, options?: EventedRunStoreOptions) {
    super(path, { now: options?.now });
    this.onStoreEvent = options?.onEvent ?? NOOP;
  }

  override createRun(input: CreateRunInput) {
    const row = super.createRun(input);
    this.onStoreEvent({ type: "run", runId: row.id, status: row.status });
    return row;
  }

  override setRunStatus(id: string, status: RunStatus): void {
    super.setRunStatus(id, status);
    this.onStoreEvent({ type: "run", runId: id, status });
  }

  override recordCall(input: RecordCallInput): void {
    super.recordCall(input);
    this.onStoreEvent({
      type: "call",
      runId: input.runId,
      stageId: input.stageId,
      role: input.role,
      loop: input.loop,
      attempt: input.attempt,
      ok: (input.response ?? null) !== null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      ms: input.ms ?? null,
      error: input.error ?? null,
    });
  }

  override updateStageProgress(runId: string, stageId: string, patch: StageProgressPatch): boolean {
    const updated = super.updateStageProgress(runId, stageId, patch);
    // Read the row back so the event carries the authoritative merged state
    // (a first touch creates the row with default loop/score before patching).
    const row = this.getStageStatus(runId, stageId);
    if (row) {
      this.onStoreEvent({
        type: "stage",
        runId,
        stageId,
        status: row.status,
        loop: row.loop,
        score: row.score,
      });
    }
    return updated;
  }
}
