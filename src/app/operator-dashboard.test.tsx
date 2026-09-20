/** Config-flow wiring test — estimate on interaction, two-step confirm, verbatim errors. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OrchestratorEvent } from "@/lib/orchestrator/events";
import OperatorDashboard from "./operator-dashboard";
import { SAMPLE_ESTIMATE } from "@/lib/dashboard/fixtures";

const SNAPSHOT = {
  id: "r-new",
  idea: "A subscription service for monthly specialty-coffee discovery boxes",
  status: "running",
  createdAt: 1,
  config: { depth: "standard", languages: ["en"], scoreThreshold: 9 },
  estimate: SAMPLE_ESTIMATE,
  totals: { calls: 2, inputTokens: 100, outputTokens: 50, tokens: 150, ms: 900, costUsd: 0.01 },
  stages: [
    { stage_id: "market-analysis", status: "done", loop: 0, score: 9.1, calls: 2, tokens: 150, run_id: "r-new" },
    { stage_id: "competitor-analysis", status: "pending", loop: 0, score: null, calls: 0, tokens: 0, run_id: "r-new" },
  ],
};

type FetchHandler = (url: string, init: RequestInit | undefined) => Response;

function urlOf(request: RequestInfo | URL): string {
  return typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
}

/**
 * jsdom has no EventSource — stub it with a controllable double the test can
 * drive (open / emit replay frames) through the same named-event surface the
 * real hub uses.
 */
class StubEventSource {
  static instances: StubEventSource[] = [];

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>([]);

  constructor(readonly url: string) {
    StubEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  close(): void {
    this.closed = true;
  }

  /** The most recently created source (the one the current view owns). */
  static latest(): StubEventSource | undefined {
    return StubEventSource.instances.at(-1);
  }

  /** Opens the stream and delivers a full replay — what the hub does on subscribe. */
  static replay(events: Array<[string, OrchestratorEvent]>): void {
    act(() => {
      const source = StubEventSource.latest();
      source?.onopen?.();
      for (const [kind, event] of events) {
        for (const listener of source?.listeners.get(kind) ?? []) {
          listener(new MessageEvent(kind, { data: JSON.stringify(event) }));
        }
      }
    });
  }
}

function stubFetch(handler: FetchHandler): void {
  vi.stubGlobal(
    "fetch",
    (request: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(urlOf(request), init)),
  );
}

const jsonResponse = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

let seq = 0;
function event(kind: "run" | "stage" | "call", fields: Record<string, unknown>): OrchestratorEvent {
  seq += 1;
  return { kind, seq, ts: 1_000 + seq, runId: "r-new", ...fields } as OrchestratorEvent;
}

beforeEach(() => {
  // jsdom ships no EventSource; the stub is inert unless the test drives it.
  vi.stubGlobal("EventSource", StubEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  StubEventSource.instances = [];
});

describe("OperatorDashboard config flow", () => {
  it("fetches provider status, estimates on first interaction, then creates and confirms the run", async () => {
    const user = userEvent.setup();
    const calls: Array<{ url: string; method: string }> = [];
    stubFetch((url, init) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url === "/api/provider") return jsonResponse(200, { provider: "mock", hasKey: true, model: null });
      if (url === "/api/runs" && (!init?.method || init.method === "GET")) return jsonResponse(200, { runs: [] });
      if (url === "/api/estimate") return jsonResponse(200, { estimate: SAMPLE_ESTIMATE });
      if (url === "/api/runs" && init?.method === "POST") return jsonResponse(201, { runId: "r-new" });
      if (url === "/api/runs/r-new/confirm") return jsonResponse(200, { status: "running" });
      if (url === "/api/runs/r-new") return jsonResponse(200, SNAPSHOT);
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });

    render(<OperatorDashboard />);

    // Untouched screen: no estimate panel yet.
    await waitFor(() => expect(screen.getByTestId("config-screen")).toBeInTheDocument());
    expect(screen.queryByTestId("estimate-panel")).not.toBeInTheDocument();

    // First interaction → pre-flight estimate appears.
    await user.type(
      screen.getByTestId("idea-input"),
      "A subscription service for monthly specialty-coffee discovery boxes",
    );
    await waitFor(() => expect(screen.getByTestId("estimate-panel")).toBeInTheDocument(), { timeout: 2_000 });

    // Two-step confirm → create + confirm POSTs → board for the run.
    await user.click(screen.getByTestId("build-button"));
    await user.click(screen.getByTestId("build-confirm-yes"));
    await waitFor(() => expect(screen.getByTestId("run-view")).toBeInTheDocument());

    expect(calls.some((c) => c.url === "/api/runs" && c.method === "POST")).toBe(true);
    expect(calls.some((c) => c.url === "/api/runs/r-new/confirm")).toBe(true);

    // The board paints from the SSE replay — header totals appear without any
    // page refresh, driven purely by the streamed events.
    StubEventSource.replay([
      ["run", event("run", { status: "running" })],
      [
        "call",
        event("call", { stageId: "market-analysis", role: "researcher", loop: 0, attempt: 1, ok: true, inputTokens: 100, outputTokens: 50, ms: 900, error: null }),
      ],
      ["call", event("call", { stageId: "market-analysis", role: "researcher", loop: 0, attempt: 2, ok: true, inputTokens: 100, outputTokens: 50, ms: 900, error: null })],
      ["stage", event("stage", { stageId: "market-analysis", status: "done", loop: 0, score: 9.1, calls: 2, tokens: 150 })],
    ]);
    expect(screen.getByTestId("header-calls")).toHaveTextContent("2");
    expect(screen.getByTestId("header-tokens")).toHaveTextContent("300");
    expect(screen.getByTestId("stream-status")).toHaveTextContent("Live");
  });

  it("surfaces run-creation errors verbatim", async () => {
    const user = userEvent.setup();
    stubFetch((url, init) => {
      if (url === "/api/provider") return jsonResponse(200, { provider: "mock", hasKey: true, model: null });
      if (url === "/api/runs" && (!init?.method || init.method === "GET")) return jsonResponse(200, { runs: [] });
      if (url === "/api/runs" && init?.method === "POST")
        return jsonResponse(500, { error: "AI_API_KEY is required — set it and restart the server" });
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });

    render(<OperatorDashboard />);
    await waitFor(() => expect(screen.getByTestId("config-screen")).toBeInTheDocument());
    await user.type(screen.getByTestId("idea-input"), "coffee boxes");
    await user.click(screen.getByTestId("build-button"));
    await user.click(screen.getByTestId("build-confirm-yes"));

    const alert = await screen.findByTestId("start-error");
    expect(alert).toHaveTextContent("AI_API_KEY is required — set it and restart the server");
  });

  it("shows the confirm panel for a queued run and starts it on confirm", async () => {
    const user = userEvent.setup();
    let confirmed = false;
    stubFetch((url, init) => {
      if (url === "/api/provider") return jsonResponse(200, { provider: "mock", hasKey: true, model: null });
      if (url === "/api/runs" && (!init?.method || init.method === "GET"))
        return jsonResponse(200, { runs: [{ id: "r-queued", idea: "x", status: "queued", createdAt: 1 }] });
      if (url === "/api/runs/r-queued/confirm") {
        confirmed = true;
        return jsonResponse(200, { status: "running" });
      }
      if (url === "/api/runs/r-queued")
        return jsonResponse(200, { ...SNAPSHOT, id: "r-queued", status: confirmed ? "running" : "queued" });
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });

    render(<OperatorDashboard />);
    const confirmButton = await screen.findByTestId("confirm-run");
    expect(screen.getByTestId("run-header-status")).toHaveTextContent("queued");
    await user.click(confirmButton);
    await waitFor(() => expect(screen.getByTestId("run-header-status")).toHaveTextContent("running"));
    expect(confirmed).toBe(true);
  });
});
