/** Alternatives comparison endpoint — the one comparison call of 3-alternatives mode. */

import { handleCompareAlternatives } from "@/lib/orchestrator/api";
import { getServices } from "@/lib/orchestrator/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    raw = null; // handled by the handler's body validation (400)
  }
  return handleCompareAlternatives(getServices(), id, raw);
}
