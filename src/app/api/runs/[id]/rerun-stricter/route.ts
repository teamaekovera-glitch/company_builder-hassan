/** Stricter re-run endpoint — creates a fresh queued run at the 9.5 gate. */

import { handleRerunStricter } from "@/lib/orchestrator/api";
import { getServices } from "@/lib/orchestrator/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return handleRerunStricter(getServices(), id);
}
