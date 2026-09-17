/**
 * Wave scheduling over the stage DAG.
 *
 * Pure functions — a stage becomes startable only when its wave is open and
 * every explicit dependency is done; a failed stage blocks its transitive
 * dependents while the rest of the run continues. `simulate` walks the whole
 * graph without any provider, so tests resolve ordering and blocking
 * deterministically and offline.
 */

import { STAGE_NODES, WAVES, stageNode, type StageId } from "./stages";

export type StageState = "pending" | "running" | "done" | "failed" | "blocked";

/** Per-stage state for one pipeline run, keyed by stage id. */
export type RunState = Record<StageId, StageState>;

const TERMINAL_STATES: readonly StageState[] = ["done", "failed", "blocked"];

/** Fresh run state: every stage pending. */
export function createRunState(): RunState {
  const state = {} as RunState;
  for (const node of STAGE_NODES) state[node.id] = "pending";
  return state;
}

/** 0-based index of the wave a stage belongs to. */
export function waveIndexOf(id: StageId): number {
  return WAVES.findIndex((wave) => wave.includes(id));
}

/** All ids in wave `waveNumber` (1-based), in brief order. */
export function stagesInWave(waveNumber: number): StageId[] {
  return WAVES[waveNumber - 1] ?? [];
}

/** A wave is closed once every node in it has reached a terminal state. */
export function isWaveClosed(waveNumber: number, state: RunState): boolean {
  return stagesInWave(waveNumber).every((id) => TERMINAL_STATES.includes(state[id]));
}

/**
 * A wave is open when all earlier waves are closed — waves execute strictly
 * in order, and every node inside an open wave starts as soon as its own
 * dependencies are done.
 */
export function isWaveOpen(waveNumber: number, state: RunState): boolean {
  for (let earlier = 1; earlier < waveNumber; earlier++) {
    if (!isWaveClosed(earlier, state)) return false;
  }
  return true;
}

function depsOf(id: StageId): StageId[] {
  return stageNode(id).deps;
}

/** All dependencies of `id` are done. */
function depsSatisfied(id: StageId, state: RunState): boolean {
  return depsOf(id).every((dep) => state[dep] === "done");
}

/** Any dependency of `id` has failed or is blocked (so it never can run). */
function depsUnrecoverable(id: StageId, state: RunState): boolean {
  return depsOf(id).some((dep) => state[dep] === "failed" || state[dep] === "blocked");
}

/**
 * Stages that may start right now: pending, in an open wave, every
 * dependency done. This is the single scheduling decision the executor
 * applies — a stage runs only when all dependencies are done.
 */
export function readyNodes(state: RunState): StageId[] {
  const ready: StageId[] = [];
  for (const node of STAGE_NODES) {
    if (state[node.id] !== "pending") continue;
    if (!isWaveOpen(node.wave, state)) continue;
    if (!depsSatisfied(node.id, state)) continue;
    ready.push(node.id);
  }
  return ready;
}

/**
 * Mark pending stages (in open waves) whose dependencies have failed or are
 * themselves blocked. Returns a new state; repeatable until stable because
 * blocked dependents cascade.
 */
export function applyBlocking(state: RunState): RunState {
  const next = { ...state };
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of STAGE_NODES) {
      if (next[node.id] !== "pending") continue;
      if (!isWaveOpen(node.wave, next)) continue;
      if (depsUnrecoverable(node.id, next)) {
        next[node.id] = "blocked";
        changed = true;
      }
    }
  }
  return next;
}

/** Result of a full-graph dry run. */
export interface SimulationResult {
  /** Stage ids in the order they completed. */
  order: StageId[];
  states: RunState;
}

/**
 * Execute the whole graph offline: repeatedly start every ready stage and
 * complete it immediately (no provider, no timers). Stages in `failAt` end
 * failed instead of done; their dependents block on the next pass. Pure and
 * deterministic.
 */
export function simulate(failAt: readonly StageId[] = []): SimulationResult {
  let state = createRunState();
  const order: StageId[] = [];

  for (let guard = 0; guard < STAGE_NODES.length + 1; guard++) {
    let changed = false;

    // Open waves in order; within an open wave, run everything whose deps
    // are done — the brief's "Promise.all per wave" with fine-grained gating.
    for (let wave = 1; wave <= WAVES.length; wave++) {
      if (!isWaveOpen(wave, state)) break;
      state = applyBlocking(state);
      for (const id of stagesInWave(wave)) {
        if (state[id] !== "pending" || !depsSatisfied(id, state)) continue;
        state[id] = failAt.includes(id) ? "failed" : "done";
        order.push(id);
        changed = true;
      }
    }

    if (!changed) break;
  }

  state = applyBlocking(state);
  return { order, states: state };
}
