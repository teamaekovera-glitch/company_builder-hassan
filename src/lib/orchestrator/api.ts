/**
 * HTTP boundary of the orchestration layer: framework-light request/response
 * handlers that the Next.js route files delegate to. Kept free of Next
 * imports so tests exercise them with plain `Request`/`Response` objects and
 * injected services — no running server required.
 *
 * Endpoints (docs/ARCHITECTURE.md §2):
 * - POST /api/runs              → validate config + pre-flight estimate, create `queued` run
 * - GET  /api/runs              → light run list
 * - GET  /api/runs/:id          → full snapshot
 * - POST /api/runs/:id/confirm  → explicit confirmation; starts execution
 * - GET  /api/runs/:id/events   → SSE stream (replay + live, closes on terminal)
 * - POST /api/estimate          → pre-flight estimate without creating a run
 * - GET  /api/provider          → configured provider + key presence (never the key)
 */

import { resolveProviderKind, type LLMEnvConfig, type ProviderKind } from "../llm/factory";
import { isTerminalRunStatus, type OrchestratorEvent } from "./events";
import { SSEHub } from "./hub";
import {
  COMPARISON_STAGE_ID,
  Orchestrator,
  RunNotFoundError,
  RunNotQueuedError,
  RunValidationError,
  validateRunInput,
} from "./orchestrator";
import { estimateRun } from "./estimate";

/** Everything the handlers need, wired once per process by server.ts. */
export interface OrchestratorServices {
  orchestrator: Orchestrator;
  hub: SSEHub;
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

/** Maps typed orchestrator errors onto HTTP statuses; other errors are 500s with the verbatim message. */
function errorResponse(err: unknown): Response {
  if (err instanceof RunValidationError) {
    return json(400, { error: err.message, fields: err.fields });
  }
  if (err instanceof RunNotFoundError) {
    return json(404, { error: err.message });
  }
  if (err instanceof RunNotQueuedError) {
    return json(409, { error: err.message });
  }
  // A bare rethrow would collapse into Next.js's body-less 500 — the
  // dashboard needs the message verbatim (e.g. the missing-key error from
  // the transport factory) to surface it to the operator.
  return json(500, { error: err instanceof Error ? err.message : String(err) });
}

/** POST /api/estimate — pure pre-flight estimate; never touches a provider or the store. */
export function handleEstimate(raw: unknown): Response {
  try {
    const input = validateRunInput(raw);
    return json(200, { estimate: estimateRun({ depth: input.depth, languages: input.languages }) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST /api/runs — validate + estimate + create the run in `queued`. */
export function handleCreateRun(services: OrchestratorServices, raw: unknown): Response {
  try {
    const { runId, estimate, snapshot } = services.orchestrator.createRun(raw);
    return json(201, {
      runId,
      status: "queued",
      estimate,
      confirmUrl: `/api/runs/${runId}/confirm`,
      eventsUrl: `/api/runs/${runId}/events`,
      run: snapshot,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** GET /api/runs — light list for run pickers; snapshots carry the detail. */
export function handleListRuns(services: OrchestratorServices): Response {
  const runs = services.orchestrator.listRuns().map((row) => ({
    id: row.id,
    idea: row.idea,
    status: row.status,
    createdAt: row.created_at,
  }));
  return json(200, { runs });
}

/** GET /api/runs/:id — full snapshot (run, config, estimate, totals, stages). */
export function handleGetRun(services: OrchestratorServices, runId: string): Response {
  const snapshot = services.orchestrator.getSnapshot(runId);
  return snapshot ? json(200, snapshot) : errorResponse(new RunNotFoundError(runId));
}

/** GET /api/runs/:id/stages/:stageId — full stage history for the detail tabs. */
export function handleGetStageDetail(services: OrchestratorServices, runId: string, stageId: string): Response {
  if (!services.orchestrator.getSnapshot(runId)) return errorResponse(new RunNotFoundError(runId));
  const detail = services.orchestrator.stageDetail(runId, stageId);
  return detail
    ? json(200, { detail })
    : json(404, { error: `stage ${stageId} not found in run ${runId}` });
}

/** POST /api/runs/:id/confirm — the explicit gate before any provider spend. */
export function handleConfirmRun(services: OrchestratorServices, runId: string): Response {
  try {
    const done = services.orchestrator.confirmRun(runId);
    // Fire-and-forget from the request's perspective: stage failures are
    // contained by the runner, so this catch logs scheduler invariant breaks
    // only — never silently.
    void done.catch((err: unknown) => {
      console.error(`[orchestrator] run ${runId} aborted by invariant break:`, err);
    });
    return json(202, { runId, status: "running", started: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST /api/runs/:id/rerun-stricter — fresh queued run at the 9.5 gate; source untouched. */
export function handleRerunStricter(services: OrchestratorServices, runId: string): Response {
  try {
    return json(201, { run: services.orchestrator.rerunStricter(runId) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST /api/runs/:id/rerun-alternatives — three fresh queued runs, one per strategy angle. */
export function handleRerunAlternatives(services: OrchestratorServices, runId: string): Response {
  try {
    return json(201, { runs: services.orchestrator.rerunAlternatives(runId) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST /api/runs/:id/compare-alternatives — body { memberRunIds: string[] }; one comparison call. */
export function handleCompareAlternatives(services: OrchestratorServices, runId: string, raw: unknown): Response {
  const memberRunIds: unknown = (raw as { memberRunIds?: unknown } | null)?.memberRunIds;
  if (
    !Array.isArray(memberRunIds) ||
    memberRunIds.length === 0 ||
    !memberRunIds.every((id) => typeof id === "string" && id.length > 0)
  ) {
    return json(400, { error: "body must be { memberRunIds: string[] } — the three alternatives run ids" });
  }
  try {
    const done = services.orchestrator.compareAlternatives(runId, memberRunIds as string[]);
    // Fire-and-forget like confirmRun: one provider call that can take a
    // minute; the comparison surfaces in the run log and stage detail when it
    // lands. Failures are recorded verbatim by the orchestrator.
    void done.catch((err: unknown) => {
      console.error(`[orchestrator] alternatives comparison for ${runId} failed:`, err);
    });
    return json(202, { runId, stageId: COMPARISON_STAGE_ID, started: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Provider configuration the dashboard sees — never the key itself. */
export interface ProviderInfoBody {
  provider: ProviderKind;
  /** False only when a real transport is configured without AI_API_KEY. */
  hasKey: boolean;
  /** The configured model override, or null when running on the default. */
  model: string | null;
}

/** GET /api/provider — lets the dashboard show the missing-key banner (spec consequential state) up front. */
export function handleProviderInfo(env: LLMEnvConfig = process.env): Response {
  try {
    const provider = resolveProviderKind(env);
    const body: ProviderInfoBody = {
      provider,
      hasKey: provider === "mock" || Boolean(env.AI_API_KEY),
      model: env.AI_MODEL ?? null,
    };
    return json(200, body);
  } catch (err) {
    return errorResponse(err);
  }
}

export interface EventStreamOptions {
  /** Aborting the signal closes the stream (client disconnects). */
  signal?: AbortSignal;
  /** Keep-alive comment interval; defaults to 15s. */
  heartbeatMs?: number;
}

/** Serializes one event per the SSE wire format, with id for reconnect de-dup. */
function formatSSE(event: OrchestratorEvent): string {
  return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * GET /api/runs/:id/events — the run's realtime channel. Replays the hub's
 * full history on connect (subscribe() delivers it synchronously before any
 * live event), then streams live until a terminal run event, the client
 * disconnects, or the signal aborts. Keep-alive comments keep intermediaries
 * from buffering the stream.
 */
export function handleRunEvents(services: OrchestratorServices, runId: string, options: EventStreamOptions = {}): Response {
  const snapshot = services.orchestrator.getSnapshot(runId);
  if (!snapshot) return errorResponse(new RunNotFoundError(runId));

  // Cold hub — a fresh process after a restart has an empty in-memory replay
  // log, and a live terminal run would otherwise stream zero bytes forever.
  // Rebuild the history from the persisted store once, before subscribing, so
  // the normal replay path serves it (and a terminal status closes the stream).
  if (services.hub.events(runId).length === 0) {
    for (const event of services.orchestrator.replayEvents(runId)) {
      services.hub.publish(runId, event);
    }
  }

  const encoder = new TextEncoder();
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  let cleanup: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: () => void = () => {};
      const close = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        options.signal?.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // cancel() already closed the controller — nothing to do.
        }
      };
      const write = (chunk: string): void => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const heartbeat = setInterval(() => write(": ping\n\n"), heartbeatMs);
      const onAbort = (): void => close();

      options.signal?.addEventListener("abort", onAbort);
      unsubscribe = services.hub.subscribe(runId, (event) => {
        write(formatSSE(event));
        if (event.kind === "run" && isTerminalRunStatus(event.status)) close();
      });
      cleanup = close;
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
