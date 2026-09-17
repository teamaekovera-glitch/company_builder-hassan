import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSUMPTIONS_SECTION,
  MOCK_RESPONSE_LENGTH,
  MOCK_RESPONSE_MARKER,
  mockComplete,
} from "./mock";

describe("mockComplete", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("answers without any network access", () => {
    const response = mockComplete(
      "A specialty coffee subscription service for Nordic tech offices",
    );

    expect(response).toContain(MOCK_RESPONSE_MARKER);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is deterministic — same prompt produces byte-identical output", () => {
    expect(mockComplete("Clone of Airbnb, but for houseboats")).toBe(
      mockComplete("Clone of Airbnb, but for houseboats"),
    );
  });

  it("returns fixed-length markdown for prompts of any size", () => {
    const prompts = ["", "x", "AI due-diligence copilot", "a".repeat(5000)];

    for (const prompt of prompts) {
      const response = mockComplete(prompt);

      expect(response.length).toBe(MOCK_RESPONSE_LENGTH);
      expect(response).toContain("## Assumptions & open questions");
    }
  });

  it("always closes with the assumptions section", () => {
    const response = mockComplete("Carbon accounting SaaS for mid-size manufacturers");

    expect(response.endsWith(ASSUMPTIONS_SECTION)).toBe(true);
  });

  it("produces distinct output for distinct prompts", () => {
    expect(mockComplete("idea A")).not.toBe(mockComplete("idea B"));
  });
});
