/** Stage detail endpoint — the full tab history for one stage of a run. */

import { handleGetStageDetail } from "@/lib/orchestrator/api";
import { getServices } from "@/lib/orchestrator/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; stageId: string }> },
): Promise<Response> {
  const { id, stageId } = await ctx.params;
  return handleGetStageDetail(getServices(), id, stageId);
}
