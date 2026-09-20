/** Provider configuration endpoint — drives the missing-key setup banner. */

import { handleProviderInfo } from "@/lib/orchestrator/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return handleProviderInfo();
}
