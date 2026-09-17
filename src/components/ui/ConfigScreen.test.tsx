import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfigScreen, {
  BuildButton,
  DepthSelector,
  EstimatePanel,
  LanguageMultiSelect,
} from "./ConfigScreen";
import { DEFAULT_CONFIG, SAMPLE_ESTIMATE } from "@/lib/dashboard/fixtures";

describe("DepthSelector", () => {
  it("defaults to Extreme", () => {
    render(<DepthSelector value={DEFAULT_CONFIG.depth} onChange={vi.fn()} />);
    expect(screen.getByTestId("depth-extreme")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("depth-standard")).toHaveAttribute("aria-checked", "false");
  });

  it("fires onChange when another depth is picked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DepthSelector value="extreme" onChange={onChange} />);
    await user.click(screen.getByTestId("depth-deep"));
    expect(onChange).toHaveBeenCalledWith("deep");
  });
});

describe("LanguageMultiSelect", () => {
  it("renders all five languages with the fixture selection", () => {
    render(<LanguageMultiSelect selected={DEFAULT_CONFIG.languages} onToggle={vi.fn()} />);
    for (const code of ["en", "es", "de", "ja", "hi"]) {
      expect(screen.getByTestId(`language-${code}`)).toBeChecked();
    }
  });

  it("fires onToggle for a language change", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<LanguageMultiSelect selected={["en"]} onToggle={onToggle} />);
    await user.click(screen.getByTestId("language-ja"));
    expect(onToggle).toHaveBeenCalledWith("ja");
  });
});

describe("EstimatePanel", () => {
  it("renders the estimate figures", () => {
    render(<EstimatePanel estimate={SAMPLE_ESTIMATE} />);
    expect(screen.getByTestId("estimate-calls")).toHaveTextContent("780");
    expect(screen.getByTestId("estimate-tokens")).toHaveTextContent("4.60M");
    expect(screen.getByTestId("estimate-cost")).toHaveTextContent("$31.40");
  });

  it("renders nothing before an estimate exists", () => {
    render(<EstimatePanel estimate={null} />);
    expect(screen.queryByTestId("estimate-panel")).not.toBeInTheDocument();
  });
});

describe("BuildButton", () => {
  it("requires a two-step confirm before onBuild fires", async () => {
    const onBuild = vi.fn();
    const user = userEvent.setup();
    render(<BuildButton onBuild={onBuild} />);

    await user.click(screen.getByTestId("build-button"));
    expect(onBuild).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("build-confirm-yes"));
    expect(onBuild).toHaveBeenCalledOnce();
  });

  it("cancel backs out without building", async () => {
    const onBuild = vi.fn();
    const user = userEvent.setup();
    render(<BuildButton onBuild={onBuild} />);

    await user.click(screen.getByTestId("build-button"));
    await user.click(screen.getByTestId("build-confirm-no"));
    expect(screen.queryByTestId("build-confirm")).not.toBeInTheDocument();
    expect(onBuild).not.toHaveBeenCalled();
  });

  it("renders disabled with the reason when one is given", () => {
    const onBuild = vi.fn();
    render(<BuildButton onBuild={onBuild} disabledReason="Enter an idea first" />);
    expect(screen.getByTestId("build-button")).toBeDisabled();
    expect(screen.getByTestId("build-disabled-reason")).toHaveTextContent("Enter an idea first");
  });
});

describe("ConfigScreen", () => {
  it("wires every input through callbacks", async () => {
    const onIdeaChange = vi.fn();
    const onDepthChange = vi.fn();
    const onToggleLanguage = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfigScreen
        config={{ idea: "", depth: "extreme", languages: ["en"] }}
        onIdeaChange={onIdeaChange}
        onDepthChange={onDepthChange}
        onToggleLanguage={onToggleLanguage}
        estimate={SAMPLE_ESTIMATE}
        onBuild={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("idea-input"), "c");
    expect(onIdeaChange).toHaveBeenCalledWith("c");
    await user.click(screen.getByTestId("depth-standard"));
    expect(onDepthChange).toHaveBeenCalledWith("standard");
    await user.click(screen.getByTestId("language-es"));
    expect(onToggleLanguage).toHaveBeenCalledWith("es");
  });

  it("shows the sample-idea placeholder on the empty state", () => {
    render(
      <ConfigScreen
        config={DEFAULT_CONFIG}
        onIdeaChange={vi.fn()}
        onDepthChange={vi.fn()}
        onToggleLanguage={vi.fn()}
        estimate={null}
        onBuild={vi.fn()}
      />,
    );
    expect(screen.getByTestId("idea-input")).toHaveAttribute(
      "placeholder",
      expect.stringContaining("specialty-coffee"),
    );
    expect(screen.queryByTestId("estimate-panel")).not.toBeInTheDocument();
  });
});
