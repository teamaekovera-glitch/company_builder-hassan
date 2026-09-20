/** Single-run snapshot endpoint — thin delegate to the HTTP boundary. */

import { handleGetRun } from "@/lib/orchestrator/api";
import { getServices } from "@/lib/orchestrator/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return handleGetRun(getServices(), id);
}
