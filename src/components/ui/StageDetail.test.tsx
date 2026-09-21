import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StageDetailPanel from "./StageDetail";
import { buildStageDetail } from "@/lib/dashboard/fixtures";
import type { StageDetailTab } from "@/lib/dashboard/types";

function renderPanel(activeTab: StageDetailTab = "drafts") {
  const onTabChange = vi.fn();
  const onLanguageChange = vi.fn();
  render(
    <StageDetailPanel
      detail={buildStageDetail()}
      activeTab={activeTab}
      onTabChange={onTabChange}
      activeLanguage={null}
      onLanguageChange={onLanguageChange}
    />,
  );
  return { onTabChange, onLanguageChange };
}

describe("StageDetailPanel", () => {
  it("renders all eight tabs", () => {
    renderPanel();
    for (const tab of ["drafts", "merged", "critiques", "improved", "scores", "translations", "mockup", "loop-history"]) {
      expect(screen.getByTestId(`tab-${tab}`)).toBeInTheDocument();
    }
  });

  it("shows draft artifacts on the drafts tab and fires tab changes", async () => {
    const { onTabChange } = renderPanel("drafts");
    expect(screen.getByTestId("panel-drafts")).toHaveTextContent("Draft A");
    expect(screen.getByTestId("panel-drafts")).toHaveTextContent("Generator C");

    await userEvent.click(screen.getByTestId("tab-merged"));
    expect(onTabChange).toHaveBeenCalledWith("merged");
  });

  it("renders judge scores with dimension breakdowns on the scores tab", async () => {
    renderPanel("scores");
    // Defaults to the winning iteration and labels it in the round picker.
    expect(screen.getByTestId("round-winner-2")).toBeInTheDocument();
    expect(screen.getByTestId("score-judge-harsh")).toHaveTextContent("Accuracy 9.1");
    expect(screen.getByTestId("reconciler-rationale")).toHaveTextContent("reconciled 9.2");
    await userEvent.click(screen.getByTestId("round-1"));
    expect(screen.getByTestId("score-judge-harsh")).toHaveTextContent("Accuracy 8.4");
    expect(screen.getByTestId("reconciler-rationale")).toHaveTextContent("reconciled 8.6");
  });

  it("switches translation sub-tabs per language", async () => {
    const { onLanguageChange } = renderPanel("translations");
    expect(screen.getByTestId("panel-translations")).toHaveTextContent("Spanish translation");

    await userEvent.click(screen.getByTestId("translation-lang-de"));
    expect(onLanguageChange).toHaveBeenCalledWith("de");
  });

  it("renders the mockup in a sandboxed iframe, never injected", () => {
    renderPanel("mockup");
    const frame = screen.getByTestId("stage-mockup-frame");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("Market Analysis mockup"));
  });

  it("lists loop history with attempts and token counts", () => {
    renderPanel("loop-history");
    expect(screen.getByTestId("loop-history-table")).toHaveTextContent("critic:pessimistic-vc");
    expect(screen.getByTestId("loop-history-table")).toHaveTextContent("14.2k");
  });
});
