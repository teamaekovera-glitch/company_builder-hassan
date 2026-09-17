import { describe, expect, it } from "vitest";

import {
  ALL_CORE_STAGES,
  LOOP_STAGE_COUNT,
  STAGE_NODES,
  WAVES,
  stageNode,
  type StageId,
} from "./stages";
import { DEPTH_MATRIX } from "./depth";

describe("stage graph structure", () => {
  it("has exactly 39 nodes numbered 1–39 in brief order", () => {
    expect(STAGE_NODES).toHaveLength(39);
    STAGE_NODES.forEach((node, index) => {
      expect(node.number).toBe(index + 1);
    });
  });

  it("has 26 core loop stages and 13 pass stages", () => {
    const stages = STAGE_NODES.filter((n) => n.kind === "stage");
    const passes = STAGE_NODES.filter((n) => n.kind === "pass");
    expect(stages).toHaveLength(26);
    expect(passes).toHaveLength(13);
    expect(ALL_CORE_STAGES).toHaveLength(LOOP_STAGE_COUNT);
  });

  it("assigns every node to exactly one of the seven waves, and node.wave agrees", () => {
    expect(WAVES).toHaveLength(7);
    const waveMembers = WAVES.flat();
    expect(waveMembers).toHaveLength(39);
    for (const node of STAGE_NODES) {
      expect(waveMembers.filter((id) => id === node.id)).toHaveLength(1);
      const waveIndex = WAVES.findIndex((wave) => wave.includes(node.id));
      expect(waveIndex).toBeGreaterThanOrEqual(0);
      expect(node.wave).toBe(waveIndex + 1);
    }
  });

  it("matches the spec's engine table wave membership", () => {
    expect(WAVES[0]).toEqual(["market-analysis", "competitor-analysis", "expert-roundtable"]);
    expect(WAVES[1]).toEqual(["business-model", "user-interviews", "journey-maps"]);
    expect(WAVES[2]).toEqual(["prd", "brand-identity", "legal-pack"]);
    expect(WAVES[3]).toEqual([
      "database",
      "api-design",
      "architecture",
      "ui-generation",
      "code-gen",
      "marketing-plan",
      "seo-strategy",
      "pricing-strategy",
      "sales-playbook",
      "support-pack",
      "financial-model",
      "hiring-plan",
      "gtm-timeline",
    ]);
    expect(WAVES[4]).toEqual(["risk-assessment", "security-threat-model", "investor-pitch", "board-reports"]);
  });

  it("chains the wave-6 adversarial passes in order", () => {
    expect(stageNode("devils-advocate").deps).toEqual(ALL_CORE_STAGES);
    expect(stageNode("rebuttal").deps).toEqual(["devils-advocate"]);
    expect(stageNode("devils-advocate-2").deps).toEqual(["rebuttal"]);
    expect(stageNode("final-rebuttal").deps).toEqual(["devils-advocate-2"]);
    expect(stageNode("red-team-blue-team").deps).toEqual(["final-rebuttal"]);
  });

  it("gates wave-7 passes on their wave-6 inputs", () => {
    expect(stageNode("executive-synthesis").deps).toEqual(["red-team-blue-team", "consistency-audit"]);
    expect(stageNode("summary-ladder").deps).toEqual(["executive-synthesis"]);
    expect(stageNode("auto-rerun").deps).toEqual(["executive-synthesis", "summary-ladder", "meta-score"]);
    expect(stageNode("localisation").deps).toEqual(["auto-rerun"]);
    expect(stageNode("persona-rewrites").deps).toEqual(["auto-rerun"]);
    expect(stageNode("output-formats").deps).toEqual(["auto-rerun"]);
  });

  it("models board reports as dependent on the financial model", () => {
    expect(stageNode("board-reports").deps).toEqual(["financial-model"]);
  });

  it("specifies the auto re-run: 5 weakest stages, passes 32–35 rechecked", () => {
    const rerun = stageNode("auto-rerun");
    expect(rerun.kind).toBe("pass");
    if (rerun.kind !== "pass" || !rerun.rerun) return;
    expect(rerun.rerun.weakStages).toBe(5);
    expect(rerun.rerun.recheckedPasses).toEqual([
      "consistency-audit",
      "executive-synthesis",
      "summary-ladder",
      "meta-score",
    ]);
  });

  it("only references known stage ids in dependencies", () => {
    const known = new Set<string>(STAGE_NODES.map((n) => n.id));
    for (const node of STAGE_NODES) {
      for (const dep of node.deps) expect(known.has(dep)).toBe(true);
    }
  });

  it("only scales fan-outs by depth-matrix keys that exist", () => {
    for (const node of STAGE_NODES) {
      for (const expansion of node.expansions) {
        if ("perDepth" in expansion) {
          expect(DEPTH_MATRIX.extreme[expansion.perDepth]).toBeGreaterThan(0);
        }
      }
    }
  });

  it("models the wave-4 expansion fan-outs per the spec table (Extreme)", () => {
    const countOf = (id: StageId, role: string): number | undefined => {
      const expansion = stageNode(id).expansions.find((e) => e.role === role);
      if (!expansion) return undefined;
      if ("perDepth" in expansion) return DEPTH_MATRIX.extreme[expansion.perDepth];
      return "count" in expansion ? expansion.count : undefined;
    };
    expect(countOf("competitor-analysis", "competitor-deep-dive")).toBe(12);
    expect(countOf("support-pack", "help-article")).toBe(25);
    expect(countOf("hiring-plan", "job-description")).toBe(20);
    expect(countOf("marketing-plan", "social-post")).toBe(50);
    expect(countOf("marketing-plan", "blog-post")).toBe(15);
    expect(countOf("ui-generation", "screen-mockup")).toBe(12);
    expect(countOf("risk-assessment", "black-swan")).toBe(5);
    // The operator brief's "20 social posts" reconciled to the matrix's
    // 20 sequence emails + 50 social posts (Extreme = the brief verbatim).
    expect(countOf("marketing-plan", "email-sequence")).toBe(20);
  });

  it("keeps SEO and sales content inside the loop calls (no extra calls)", () => {
    expect(stageNode("seo-strategy").expansions).toEqual([]);
    expect(stageNode("sales-playbook").expansions).toEqual([]);
  });
});
