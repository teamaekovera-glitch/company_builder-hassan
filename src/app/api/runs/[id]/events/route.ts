/** Run event stream (SSE) — replay-on-connect, live until terminal. */

import { handleRunEvents } from "@/lib/orchestrator/api";
import { getServices } from "@/lib/orchestrator/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return handleRunEvents(getServices(), id, { signal: req.signal });
}
