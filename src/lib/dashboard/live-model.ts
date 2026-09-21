/**
 * Pure live-run state — the reducer the operator dashboard applies SSE
 * events with, and the projection from run snapshots for pre-connect and
 * terminal views.
 *
 * Header totals and per-stage figures reconcile with the calls table
 * (spec verification row 8) because the accounting mirrors the store's own
 * transaction semantics exactly:
 * - every call attempt is a row, so every `call` event counts toward `calls`
 *   (failed attempts included);
 * - tokens and ms accumulate only for attempts that reported usage.
 *
 * Derived state (metrics, cards) recomputes from this state; nothing here
 * fetches, times, or mutates — the hook owns the stream.
 */

import type { Depth } from "@/lib/pipeline/graph/depth";
import type { RunStatus as StoreRunStatus, StageStatus } from "@/lib/store/schema";
import { costFromTokens } from "@/lib/orchestrator/estimate";
import type { OrchestratorEvent } from "@/lib/orchestrator/events";
import type { RunSnapshot } from "@/lib/orchestrator/orchestrator";
import { WAVE_COUNT, WAVE_LABELS, boardNodes, type BoardNode } from "./board-graph";
import type { RunMetrics, StageCardData, WaveColumnData } from "./types";

export interface StageLiveState {
  status: StageStatus;
  loop: number;
  score: number | null;
  /** All attempts, failed included — matches the store's stage counter. */
  calls: number;
  /** Summed input+output over attempts that reported usage. */
  tokens: number;
  /** Summed duration over attempts that reported one. */
  ms: number;
  /** Verbatim provider error of the most recent failed attempt. */
  lastError: string | null;
}

export type RunLiveStatus = "unknown" | StoreRunStatus;

export interface RunLiveState {
  runStatus: RunLiveStatus;
  /** Header totals — the calls-table accounting (spec verification row 8). */
  totals: { calls: number; inputTokens: number; outputTokens: number; tokens: number; ms: number };
  stages: Map<string, StageLiveState>;
}

/** Empty state; stages appear as events (or a snapshot) mention them. */
export function initialLiveState(): RunLiveState {
  return {
    runStatus: "unknown",
    totals: { calls: 0, inputTokens: 0, outputTokens: 0, tokens: 0, ms: 0 },
    stages: new Map(),
  };
}

function stageOf(state: RunLiveState, stageId: string): StageLiveState {
  const existing = state.stages.get(stageId);
  if (existing) return existing;
  const fresh: StageLiveState = {
    status: "pending",
    loop: 0,
    score: null,
    calls: 0,
    tokens: 0,
    ms: 0,
    lastError: null,
  };
  state.stages.set(stageId, fresh);
  return fresh;
}

/**
 * Applies one event; returns a new state (input untouched). Unknown stage
 * ids create default rows so a card can never miss an event it receives.
 */
export function applyRunEvent(state: RunLiveState, event: OrchestratorEvent): RunLiveState {
  const next: RunLiveState = {
    runStatus: state.runStatus,
    totals: { ...state.totals },
    stages: new Map(state.stages),
  };

  switch (event.kind) {
    case "run":
      next.runStatus = event.status;
      break;
    case "stage": {
      const stage = stageOf(next, event.stageId);
      // The event carries the authoritative merged row (the store emits the
      // row read back after the patch), so overwrite all three fields.
      next.stages.set(event.stageId, {
        ...stage,
        status: event.status,
        loop: event.loop,
        score: event.score,
      });
      break;
    }
    case "call": {
      const stage = stageOf(next, event.stageId);
      next.stages.set(event.stageId, {
        ...stage,
        calls: stage.calls + 1,
        tokens: stage.tokens + (event.inputTokens ?? 0) + (event.outputTokens ?? 0),
        ms: stage.ms + (event.ms ?? 0),
        lastError: event.ok ? stage.lastError : (event.error ?? stage.lastError),
      });
      next.totals = {
        calls: next.totals.calls + 1,
        inputTokens: next.totals.inputTokens + (event.inputTokens ?? 0),
        outputTokens: next.totals.outputTokens + (event.outputTokens ?? 0),
        tokens: next.totals.tokens + (event.inputTokens ?? 0) + (event.outputTokens ?? 0),
        ms: next.totals.ms + (event.ms ?? 0),
      };
      break;
    }
  }
  return next;
}

/** Builds live state from a run snapshot (pre-connect paint, terminal views). */
export function snapshotToState(snapshot: RunSnapshot): RunLiveState {
  const state: RunLiveState = {
    runStatus: snapshot.status,
    totals: {
      calls: snapshot.totals.calls,
      inputTokens: snapshot.totals.inputTokens,
      outputTokens: snapshot.totals.outputTokens,
      tokens: snapshot.totals.tokens,
      ms: snapshot.totals.ms,
    },
    stages: new Map(),
  };
  for (const row of snapshot.stages) {
    state.stages.set(row.stage_id, {
      status: row.status,
      loop: row.loop,
      score: row.score,
      calls: row.calls,
      tokens: row.tokens,
      // Per-call durations are not in the stage_status row — only the event
      // stream can derive per-stage elapsed; snapshot views show 0.
      ms: 0,
      // Verbatim errors live in the calls table, which the snapshot does not
      // expose; the live event stream carries them on failed call events.
      lastError: null,
    });
  }
  return state;
}

/** Store run status → the dashboard header's chip vocabulary. */
export function dashboardRunStatus(
  status: RunLiveStatus,
): "empty" | "queued" | "running" | "done" | "failed" {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "done";
    case "failed":
    case "interrupted":
      return "failed";
    case "unknown":
      return "empty";
  }
}

/** Header metrics for the RunHeader component. */
export function runMetrics(state: RunLiveState): RunMetrics {
  const { tokens, ms } = state.totals;
  return {
    status: dashboardRunStatus(state.runStatus),
    tokens: state.totals.tokens,
    calls: state.totals.calls,
    elapsedMs: state.totals.ms,
    costUsd: costFromTokens(state.totals),
    // The only rate that reconciles to the calls table: usage over the
    // durations the calls table itself records.
    tokensPerSec: ms > 0 ? Math.round(tokens / (ms / 1000)) : 0,
  };
}

/**
 * First failed-or-blocked dependency of `node` (transitive over the DAG):
 * a pending stage whose dependency can never finish is displayed blocked,
 * named by the dependency that caused it.
 */
export function blockedDependency(
  node: BoardNode,
  nodesById: ReadonlyMap<string, BoardNode>,
  live: ReadonlyMap<string, StageLiveState>,
  visited: Set<string> = new Set(),
): string | undefined {
  if (visited.has(node.stageId)) return undefined;
  visited.add(node.stageId);
  for (const depId of node.deps) {
    const depStatus = live.get(depId)?.status;
    if (depStatus === "failed") return depId;
    const depNode = nodesById.get(depId);
    if (depStatus === "pending" && depNode) {
      const upstream = blockedDependency(depNode, nodesById, live, visited);
      if (upstream) return depId;
    }
  }
  return undefined;
}

/** Wave columns of stage cards for the board, derived from live state. */
export function stageCards(state: RunLiveState, depth: Depth): WaveColumnData[] {
  const nodes = boardNodes(depth);
  const nodesById = new Map(nodes.map((node) => [node.stageId, node]));

  const byWave = new Map<number, BoardNode[]>();
  for (const node of nodes) {
    const column = byWave.get(node.waveIndex);
    if (column) column.push(node);
    else byWave.set(node.waveIndex, [node]);
  }

  return Array.from({ length: WAVE_COUNT }, (_, i) => i + 1)
    .filter((waveIndex) => byWave.has(waveIndex))
    .map((waveIndex) => {
      const column = byWave.get(waveIndex) as BoardNode[];
      return {
        waveIndex,
        label: WAVE_LABELS[waveIndex] ?? `Wave ${waveIndex}`,
        stages: column.map((node) => {
          const live = state.stages.get(node.stageId);
          const rawStatus = live?.status ?? "pending";
          const blockedBy =
            rawStatus === "pending" ? blockedDependency(node, nodesById, state.stages) : undefined;
          const status =
            rawStatus === "pending" ? (blockedBy === undefined ? "queued" : "blocked") : rawStatus;
          return {
            stageId: node.stageId,
            title: node.title,
            waveIndex: node.waveIndex,
            status,
            loop: live?.loop ?? 0,
            loopCap: node.loopCap,
            tokens: live?.tokens ?? 0,
            elapsedMs: live?.ms ?? 0,
            score: live?.score ?? null,
            calls: live?.calls ?? 0,
            errorMessage:
              status === "failed"
                ? (live?.lastError ?? "stage failed — verbatim error not in the live event log")
                : undefined,
            blockedBy,
          } satisfies StageCardData;
        }),
      } satisfies WaveColumnData;
    });
}
