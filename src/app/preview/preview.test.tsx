import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PreviewPage from "./preview-view";

// The preview page is the acceptance surface: it must build and render every
// dashboard section and every stage-card state from fixtures.

describe("PreviewPage", () => {
  it("renders all five sections", () => {
    render(<PreviewPage />);
    expect(screen.getByTestId("preview-page")).toBeInTheDocument();
    expect(screen.getByTestId("preview-config")).toBeInTheDocument();
    expect(screen.getByTestId("preview-board")).toBeInTheDocument();
    expect(screen.getByTestId("preview-stage-detail")).toBeInTheDocument();
    expect(screen.getByTestId("preview-done")).toBeInTheDocument();
    expect(screen.getByTestId("preview-missing-key")).toBeInTheDocument();
  });

  it("renders every stage-card state (queued/running/failed/blocked/done)", () => {
    render(<PreviewPage />);
    expect(screen.getByTestId("stage-status-expert-roundtable")).toHaveTextContent("queued");
    expect(screen.getByTestId("stage-status-competitor-analysis")).toHaveTextContent("running");
    expect(screen.getByTestId("stage-status-legal-pack")).toHaveTextContent("failed");
    expect(screen.getByTestId("stage-status-business-model")).toHaveTextContent("blocked");
    expect(screen.getByTestId("stage-status-market-analysis")).toHaveTextContent("done");
  });

  it("renders the config screen with defaults and estimate", () => {
    render(<PreviewPage />);
    expect(screen.getByTestId("depth-extreme")).toHaveAttribute("aria-checked", "true");
    for (const code of ["en", "es", "de", "ja", "hi"]) {
      expect(screen.getByTestId(`language-${code}`)).toBeChecked();
    }
    expect(screen.getByTestId("estimate-panel")).toBeInTheDocument();
    expect(screen.getByTestId("build-button")).toBeInTheDocument();
  });

  it("renders the run header and stage detail tabs", () => {
    render(<PreviewPage />);
    expect(screen.getAllByTestId("run-header")).toHaveLength(2);
    expect(screen.getByTestId("stage-detail")).toBeInTheDocument();
    expect(screen.getByTestId("tab-drafts")).toHaveAttribute("aria-selected", "true");
  });

  it("renders active downloads on the done state and disabled ones on the missing-key state", () => {
    render(<PreviewPage />);
    expect(screen.getAllByTestId("download-buttons")).toHaveLength(2);
    expect(screen.getByTestId("missing-key-banner")).toBeInTheDocument();
  });
});
