import { describe, expect, it } from "vitest";
import {
  formatElapsed,
  formatScore,
  formatTokens,
  formatUsd,
  gaugeFraction,
} from "./format";

describe("formatTokens", () => {
  it("keeps sub-k counts plain", () => {
    expect(formatTokens(940)).toBe("940");
  });

  it("abbreviates thousands with one decimal", () => {
    expect(formatTokens(12_300)).toBe("12.3k");
  });

  it("abbreviates millions with two decimals", () => {
    expect(formatTokens(4_600_000)).toBe("4.60M");
  });
});

describe("formatUsd", () => {
  it("always shows two decimals", () => {
    expect(formatUsd(0.4)).toBe("$0.40");
    expect(formatUsd(12.5)).toBe("$12.50");
  });
});

describe("formatElapsed", () => {
  it("formats sub-hour durations", () => {
    expect(formatElapsed(65_000)).toBe("1m 05s");
  });

  it("formats multi-hour durations", () => {
    expect(formatElapsed(4_500_000)).toBe("1h 15m 00s");
  });
});

describe("formatScore", () => {
  it("renders one decimal", () => {
    expect(formatScore(9.25)).toBe("9.3");
  });

  it("renders an em dash when judging has not completed", () => {
    expect(formatScore(null)).toBe("—");
  });
});

describe("gaugeFraction", () => {
  it("clamps to the 0–1 range", () => {
    expect(gaugeFraction(250, 500)).toBe(0.5);
    expect(gaugeFraction(900, 500)).toBe(1);
    expect(gaugeFraction(-10, 500)).toBe(0);
  });

  it("is zero when the ceiling is zero", () => {
    expect(gaugeFraction(100, 0)).toBe(0);
  });
});