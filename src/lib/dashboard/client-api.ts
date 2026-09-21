/**
 * Client-side API wrappers for the dashboard — typed fetch helpers that
 * surface server error messages verbatim (the operator must see provider
 * errors as-is, never a generic "request failed").
 */

import type { ProviderInfoBody } from "@/lib/orchestrator/api";
import type { RunSnapshot } from "@/lib/orchestrator/orchestrator";
import type { PreflightEstimate, RunConfigDraft, StageDetailData } from "./types";

export interface RunListItem {
  id: string;
  idea: string;
  status: string;
  createdAt: number;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body !== null && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `${init?.method ?? "GET"} ${url} failed with HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

/** GET /api/provider — never contains the key itself. */
export function fetchProviderInfo(): Promise<ProviderInfoBody> {
  return requestJson<ProviderInfoBody>("/api/provider");
}

/** GET /api/runs — most recently created run last (store orders by created_at). */
export async function fetchLatestRun(): Promise<RunListItem | null> {
  const body = await requestJson<{ runs: RunListItem[] }>("/api/runs");
  return body.runs.at(-1) ?? null;
}

/** GET /api/runs/:id — full snapshot (config, stages, totals). */
export function fetchSnapshot(runId: string): Promise<RunSnapshot> {
  return requestJson<RunSnapshot>(`/api/runs/${runId}`);
}

/** GET /api/runs/:id/stages/:stageId — the stage's full tab history. */
export async function fetchStageDetail(runId: string, stageId: string): Promise<StageDetailData> {
  const body = await requestJson<{ detail: StageDetailData }>(`/api/runs/${runId}/stages/${stageId}`);
  return body.detail;
}

/** POST /api/estimate — pre-flight volume estimate; never creates a run or touches a provider. */
export async function fetchEstimate(config: RunConfigDraft): Promise<PreflightEstimate> {
  const body = await requestJson<{ estimate: PreflightEstimate }>("/api/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idea: config.idea, depth: config.depth, languages: config.languages }),
  });
  return body.estimate;
}

/** POST /api/runs — creates the run in `queued`; nothing has been spent yet. */
export async function createRun(config: RunConfigDraft): Promise<string> {
  const body = await requestJson<{ runId: string }>("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idea: config.idea, depth: config.depth, languages: config.languages }),
  });
  return body.runId;
}

/** POST /api/runs/:id/confirm — the explicit gate; starts execution (spend begins). */
export function confirmRun(runId: string): Promise<unknown> {
  return requestJson(`/api/runs/${runId}/confirm`, { method: "POST" });
}
