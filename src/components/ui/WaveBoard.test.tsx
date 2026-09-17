import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WaveBoard, { StageCard } from "./WaveBoard";
import { buildWaveColumns, stageCard } from "@/lib/dashboard/fixtures";

function baseCard(status: Parameters<typeof stageCard>[0]["status"]) {
  return stageCard({
    stageId: "market-analysis",
    title: "Market Analysis",
    waveIndex: 1,
    status,
  });
}

describe("StageCard", () => {
  it("shows the six live figures", () => {
    render(
      <StageCard
        stage={{
          ...baseCard("done"),
          loop: 2,
          tokens: 184_320,
          elapsedMs: 312_000,
          score: 9.2,
          calls: 17,
        }}
      />,
    );

    expect(screen.getByTestId("stage-card-market-analysis")).toHaveAttribute("data-status", "done");
    expect(screen.getByTestId("stage-status-market-analysis")).toHaveTextContent("done");
    expect(screen.getByTestId("stage-loop-market-analysis")).toHaveTextContent("loop 2/3");
    expect(screen.getByTestId("stage-tokens-market-analysis")).toHaveTextContent("184.3k");
    expect(screen.getByTestId("stage-elapsed-market-analysis")).toHaveTextContent("5m 12s");
    expect(screen.getByTestId("stage-score-market-analysis")).toHaveTextContent("9.2");
    expect(screen.getByTestId("stage-calls-market-analysis")).toHaveTextContent("17");
  });

  it("shows an em-dash score and zero counters for a queued card", () => {
    render(<StageCard stage={{ ...baseCard("queued"), loop: 0 }} />);
    expect(screen.getByTestId("stage-score-market-analysis")).toHaveTextContent("—");
    expect(screen.getByTestId("stage-loop-market-analysis")).toHaveTextContent("loop 0/3");
  });

  it("quotes the provider error verbatim on a failed card", () => {
    const error = "provider error 503: upstream overloaded — exhausted 3 retries";
    render(<StageCard stage={{ ...baseCard("failed"), errorMessage: error }} />);
    expect(screen.getByTestId("stage-error-market-analysis")).toHaveTextContent(error);
  });

  it("names the blocking dependency on a blocked card", () => {
    render(<StageCard stage={{ ...baseCard("blocked"), blockedBy: "market-analysis" }} />);
    expect(screen.getByTestId("stage-blocked-by-market-analysis")).toHaveTextContent(
      "blocked by market-analysis",
    );
  });

  it("fires onSelect with the stage when clickable", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<StageCard stage={baseCard("running")} onSelect={onSelect} />);
    await user.click(screen.getByTestId("stage-card-market-analysis"));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe("WaveBoard", () => {
  it("renders one column per wave from fixtures", () => {
    render(<WaveBoard waves={buildWaveColumns()} />);
    for (const waveIndex of [1, 2, 3, 4, 5]) {
      expect(screen.getByTestId(`wave-column-${waveIndex}`)).toBeInTheDocument();
    }
  });

  it("renders all five card states from fixtures", () => {
    render(<WaveBoard waves={buildWaveColumns()} />);
    expect(screen.getByTestId("stage-status-market-analysis")).toHaveTextContent("done");
    expect(screen.getByTestId("stage-status-competitor-analysis")).toHaveTextContent("running");
    expect(screen.getByTestId("stage-status-expert-roundtable")).toHaveTextContent("queued");
    expect(screen.getByTestId("stage-status-legal-pack")).toHaveTextContent("failed");
    expect(screen.getByTestId("stage-status-business-model")).toHaveTextContent("blocked");
  });

  it("highlights the selected stage", () => {
    render(<WaveBoard waves={buildWaveColumns()} selectedStageId="market-analysis" />);
    expect(screen.getByTestId("stage-card-market-analysis").className).toContain("ring-sky-400");
  });
});
