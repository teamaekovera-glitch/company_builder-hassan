import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RunHeader from "./RunHeader";
import { buildRunMetrics } from "@/lib/dashboard/fixtures";

describe("RunHeader", () => {
  it("renders the five live metrics", () => {
    render(<RunHeader metrics={buildRunMetrics()} />);
    expect(screen.getByTestId("header-tokens")).toHaveTextContent("1.23M");
    expect(screen.getByTestId("header-calls")).toHaveTextContent("412");
    expect(screen.getByTestId("header-elapsed")).toHaveTextContent("2h 14m 30s");
    expect(screen.getByTestId("header-cost")).toHaveTextContent("$8.42");
    expect(screen.getByTestId("header-tps")).toHaveTextContent("160");
  });

  it("moves the tokens-per-second gauge with the current wave", () => {
    const { rerender } = render(<RunHeader metrics={buildRunMetrics({ tokensPerSec: 250 })} />);
    expect(screen.getByTestId("header-tps-gauge").style.width).toBe("50%");

    rerender(<RunHeader metrics={buildRunMetrics({ tokensPerSec: 500 })} />);
    expect(screen.getByTestId("header-tps-gauge").style.width).toBe("100%");

    rerender(<RunHeader metrics={buildRunMetrics({ tokensPerSec: 0 })} />);
    expect(screen.getByTestId("header-tps-gauge").style.width).toBe("0%");
  });

  it("labels the run status", () => {
    render(<RunHeader metrics={buildRunMetrics({ status: "done" })} />);
    expect(screen.getByTestId("run-header-status")).toHaveTextContent("done");
  });
});
