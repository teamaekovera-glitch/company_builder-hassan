/** Env-selectable mock provider — determinism and validation-floor behavior. */

import { describe, expect, it } from "vitest";
import { ASSUMPTIONS_SECTION, MOCK_RESPONSE_MARKER } from "./mock";
import {
  MOCK_BODY_WORD_COUNT,
  MOCK_PROVIDER_MODEL,
  MOCK_RECONCILED_SCORE,
  createMockProvider,
  mockProviderBody,
} from "./mock-provider";

const STAGE_PROMPT = {
  system: "You are market-research.\nDepth: extreme.",
  user: "Produce the market research section for: A coffee subscription box",
};

describe("createMockProvider", () => {
  it("returns the mock model id", () => {
    expect(createMockProvider().model).toBe(MOCK_PROVIDER_MODEL);
  });

  it("is deterministic — identical prompts produce byte-identical responses", async () => {
    const adapter = createMockProvider();
    const first = await adapter.complete(STAGE_PROMPT);
    const second = await adapter.complete(STAGE_PROMPT);
    expect(second).toEqual(first);
  });

  it("varies with the prompt", async () => {
    const adapter = createMockProvider();
    const first = await adapter.complete(STAGE_PROMPT);
    const second = await adapter.complete({ ...STAGE_PROMPT, user: `${STAGE_PROMPT.user} (v2)` });
    expect(second.text).not.toBe(first.text);
  });

  it("clears the production validation floor: >=2,000 words", async () => {
    const result = await createMockProvider().complete(STAGE_PROMPT);
    const words = result.text.split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(2000);
  });

  it("carries the mock marker and the assumptions section", async () => {
    const result = await createMockProvider().complete(STAGE_PROMPT);
    expect(result.text.startsWith(MOCK_RESPONSE_MARKER)).toBe(true);
    expect(result.text.endsWith(ASSUMPTIONS_SECTION)).toBe(true);
  });

  it("reports the reconciled score above the default gate for the reconciler role", async () => {
    const result = await createMockProvider().complete({
      system: "You are reconciler.\nScore the section.",
      user: "Reconcile",
    });
    expect(result.text).toContain(`RECONCILED_SCORE: ${MOCK_RECONCILED_SCORE}`);
  });

  it("omits the score marker for non-reconciler roles", async () => {
    const result = await createMockProvider().complete(STAGE_PROMPT);
    expect(result.text).not.toContain("RECONCILED_SCORE");
  });

  it("reports deterministic usage and duration", async () => {
    const result = await createMockProvider().complete(STAGE_PROMPT);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.ms).toBeGreaterThanOrEqual(600);
    expect(result.ms).toBeLessThanOrEqual(1500);
    expect(result.model).toBe(MOCK_PROVIDER_MODEL);
  });
});

describe("mockProviderBody", () => {
  it("handles prompts without a parsable role line", () => {
    const body = mockProviderBody({ system: "no role line here", user: "x" });
    expect(body).toContain("role generic");
    expect(body.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(MOCK_BODY_WORD_COUNT);
  });
});
