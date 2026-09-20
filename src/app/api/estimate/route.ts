/** Pre-flight estimate endpoint — pure; creates nothing, touches nothing. */

import { handleEstimate } from "@/lib/orchestrator/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "request body must be JSON" }, { status: 400 });
  }
  return handleEstimate(body);
}
