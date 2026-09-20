/** Confirmation endpoint — the explicit gate before any provider spend. */

import { handleConfirmRun } from "@/lib/orchestrator/api";
import { getServices } from "@/lib/orchestrator/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return handleConfirmRun(getServices(), id);
}
