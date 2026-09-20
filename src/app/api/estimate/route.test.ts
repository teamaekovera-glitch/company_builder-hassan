/** Estimate route module: the real Next.js handler over a plain Request. */

import { describe, expect, it } from "vitest";
import { POST } from "./route";

function post(body: unknown, raw = false): Request {
  return new Request("http://localhost/api/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

describe("POST /api/estimate", () => {
  it("returns the pre-flight estimate for a valid config", async () => {
    const res = await POST(post({ idea: "x", depth: "standard", languages: ["en"] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { estimate: { estimatedCalls: number; estimatedCostUsd: number } };
    expect(body.estimate.estimatedCalls).toBeGreaterThan(0);
  });

  it("400s an invalid config", async () => {
    const res = await POST(post({ idea: "" }));
    expect(res.status).toBe(400);
  });

  it("400s a malformed JSON body", async () => {
    const res = await POST(post("not json", true));
    expect(res.status).toBe(400);
  });
});
