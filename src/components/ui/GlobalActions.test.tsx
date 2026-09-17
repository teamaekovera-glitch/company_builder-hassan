import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DownloadButtons, MissingKeyBanner, RerunControls } from "./GlobalActions";

describe("RerunControls", () => {
  it("fires the stricter-critic rerun and the alternatives run", async () => {
    const onRerunStricter = vi.fn();
    const onAlternatives = vi.fn();
    const user = userEvent.setup();
    render(
      <RerunControls onRerunStricter={onRerunStricter} onAlternatives={onAlternatives} />,
    );

    await user.click(screen.getByTestId("rerun-stricter"));
    expect(onRerunStricter).toHaveBeenCalledOnce();
    expect(screen.getByTestId("rerun-stricter")).toHaveTextContent("9.5 gate");

    await user.click(screen.getByTestId("rerun-alternatives"));
    expect(onAlternatives).toHaveBeenCalledOnce();
  });
});

describe("DownloadButtons", () => {
  it("fires both download callbacks when active", async () => {
    const onDownloadDossier = vi.fn();
    const onDownloadRunLog = vi.fn();
    const user = userEvent.setup();
    render(
      <DownloadButtons
        onDownloadDossier={onDownloadDossier}
        onDownloadRunLog={onDownloadRunLog}
      />,
    );

    await user.click(screen.getByTestId("download-dossier"));
    await user.click(screen.getByTestId("download-run-log"));
    expect(onDownloadDossier).toHaveBeenCalledOnce();
    expect(onDownloadRunLog).toHaveBeenCalledOnce();
  });

  it("stays disabled with the reason before the run completes", () => {
    render(
      <DownloadButtons
        onDownloadDossier={vi.fn()}
        onDownloadRunLog={vi.fn()}
        disabledReason="Activate after a completed run"
      />,
    );
    expect(screen.getByTestId("download-dossier")).toBeDisabled();
    expect(screen.getByTestId("download-run-log")).toBeDisabled();
    expect(screen.getByTestId("download-disabled-reason")).toHaveTextContent(
      "Activate after a completed run",
    );
  });
});

describe("MissingKeyBanner", () => {
  it("names the exact env vars instead of hanging silently", () => {
    render(<MissingKeyBanner />);
    expect(screen.getByTestId("missing-key-banner")).toHaveTextContent("AI_API_KEY");
    expect(screen.getByTestId("missing-key-banner")).toHaveTextContent("AI_BASE_URL");
  });
});
