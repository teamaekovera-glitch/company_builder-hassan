/**
 * Run collection endpoints — thin delegates to the orchestrator's HTTP
 * boundary (src/lib/orchestrator/api.ts), wired by the process singleton.
 */

import { handleCreateRun, handleListRuns } from "@/lib/orchestrator/api";
import { getServices } from "@/lib/orchestrator/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "request body must be JSON" }, { status: 400 });
  }
  return handleCreateRun(getServices(), body);
}

export async function GET(): Promise<Response> {
  return handleListRuns(getServices());
}
