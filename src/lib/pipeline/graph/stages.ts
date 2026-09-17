/**
 * The 39-stage pipeline DAG.
 *
 * Pure data — no provider calls, no I/O. Transcribed from the spec's engine
 * table (waves 1–5, the operator's 39-stage brief) and its adversarial /
 * synthesis / localisation pass descriptions (waves 6–7). Sibling modules
 * (depth, schedule, plan) consume this as the single source of truth.
 */

export type StageId =
  // wave 1
  | "market-analysis"
  | "competitor-analysis"
  | "expert-roundtable"
  // wave 2
  | "business-model"
  | "user-interviews"
  | "journey-maps"
  // wave 3
  | "prd"
  | "brand-identity"
  | "legal-pack"
  // wave 4
  | "database"
  | "api-design"
  | "architecture"
  | "ui-generation"
  | "code-gen"
  | "marketing-plan"
  | "seo-strategy"
  | "pricing-strategy"
  | "sales-playbook"
  | "support-pack"
  | "financial-model"
  | "hiring-plan"
  | "gtm-timeline"
  // wave 5
  | "risk-assessment"
  | "security-threat-model"
  | "investor-pitch"
  | "board-reports"
  // wave 6 — adversarial & consistency passes
  | "devils-advocate"
  | "rebuttal"
  | "devils-advocate-2"
  | "final-rebuttal"
  | "red-team-blue-team"
  | "consistency-audit"
  // wave 7 — synthesis, localisation, persona & format passes
  | "executive-synthesis"
  | "summary-ladder"
  | "meta-score"
  | "auto-rerun"
  | "localisation"
  | "persona-rewrites"
  | "output-formats";

export type WaveNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Keys of the depth matrix that drive per-depth call counts. A fan-out marked
 * with `perDepth` is scaled by `depthMatrix(depth)[key]` (see depth.ts).
 */
export type DepthScaledKey =
  | "competitorDeepDives"
  | "personas"
  | "uiScreens"
  | "blogPosts"
  | "helpArticles"
  | "jobDescriptions"
  | "blackSwans"
  | "ads"
  | "sequenceEmails"
  | "socialPosts"
  | "minAdrs";

/**
 * One expansion fan-out: repeated role calls beyond the standard 7-call loop.
 *
 * - `count` — fixed number of calls, every depth.
 * - `perDepth` — count scaled by the depth matrix (Standard/Deep/Extreme).
 * - `perLanguage` — one call per selected language.
 * - `perLanguageDocuments` — one call per (document × language); the document
 *   set is the 26 loop stages' improved artifacts.
 * - `dataDependent` — the count is only known at runtime (e.g. one resolution
 *   call per contradiction actually found); estimated as 0 for pre-flight.
 */
export type ExpansionDef =
  | { role: string; count: number; dataDependent?: boolean; description?: string }
  | { role: string; perDepth: DepthScaledKey; description?: string }
  | { role: string; perLanguage: 1; description?: string }
  | { role: string; perLanguageDocuments: true; description?: string };

/** One fixed extra call belonging to a pass node. */
export interface PassCallDef {
  role: string;
  /** Fixed number of calls; defaults to 1. */
  count?: number;
  /** Marked when the real count is decided by pipeline data. */
  dataDependent?: boolean;
  description?: string;
}

/** Spec for stage 36 (auto re-run): re-loop the weakest stages, re-run passes. */
export interface RerunSpec {
  weakStages: number;
  recheckedPasses: StageId[];
}

interface StageBase {
  id: StageId;
  /** 1-based brief number, 1–39. */
  number: number;
  title: string;
  wave: WaveNumber;
  /** Stages that must be done before this one starts. */
  deps: StageId[];
}

/** A core stage: runs the full 7-call loop plus its expansion fan-outs. */
export interface LoopStage extends StageBase {
  kind: "stage";
  expansions: ExpansionDef[];
}

/** A synthesis/adversarial pass node: fixed calls plus any fan-outs. */
export interface PassStage extends StageBase {
  kind: "pass";
  passCalls: PassCallDef[];
  expansions: ExpansionDef[];
  rerun?: RerunSpec;
}

export type StageNode = LoopStage | PassStage;

/**
 * Waves 1–5 exactly as the spec's engine table (the spec's WAVES constant):
 * stages 1–26, each wave executed fully in parallel.
 */
export const CORE_WAVES: StageId[][] = [
  ["market-analysis", "competitor-analysis", "expert-roundtable"],
  ["business-model", "user-interviews", "journey-maps"],
  ["prd", "brand-identity", "legal-pack"],
  [
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
  ],
  ["risk-assessment", "security-threat-model", "investor-pitch", "board-reports"],
];

/** All 26 core stages in brief order. */
export const ALL_CORE_STAGES: StageId[] = CORE_WAVES.flat();

/** Stages whose pairs the consistency audit cross-checks (stage 32's deps). */
const AUDIT_PAIR_STAGES: StageId[] = [
  "pricing-strategy",
  "financial-model",
  "prd",
  "api-design",
  "database",
  "marketing-plan",
  "brand-identity",
  "hiring-plan",
  "gtm-timeline",
];

const PASS_WAVE_6: StageId[] = [
  "devils-advocate",
  "rebuttal",
  "devils-advocate-2",
  "final-rebuttal",
  "red-team-blue-team",
  "consistency-audit",
];

const PASS_WAVE_7: StageId[] = [
  "executive-synthesis",
  "summary-ladder",
  "meta-score",
  "auto-rerun",
  "localisation",
  "persona-rewrites",
  "output-formats",
];

const AUTO_RERUN_RECHECKED: StageId[] = [
  "consistency-audit",
  "executive-synthesis",
  "summary-ladder",
  "meta-score",
];

/**
 * The 39 nodes in brief order. Dependencies follow the spec's engine table:
 * every core stage depends only on earlier waves (waves run fully parallel),
 * and the passes chain exactly as the brief numbers them.
 */
export const STAGE_NODES: StageNode[] = [
  // ── Wave 1 ──────────────────────────────────────────────────────────────
  {
    id: "market-analysis",
    number: 1,
    title: "Market Analysis",
    wave: 1,
    kind: "stage",
    deps: [],
    expansions: [],
  },
  {
    id: "competitor-analysis",
    number: 2,
    title: "Competitor Analysis",
    wave: 1,
    kind: "stage",
    deps: [],
    expansions: [
      { role: "competitor-list", count: 1, description: "12 named competitors" },
      {
        role: "competitor-deep-dive",
        perDepth: "competitorDeepDives",
        description: "one deep dive per competitor: SWOT, pricing, features, sentiment",
      },
      { role: "competitor-synthesis", count: 1 },
    ],
  },
  {
    id: "expert-roundtable",
    number: 3,
    title: "Industry Expert Roundtable",
    wave: 1,
    kind: "stage",
    deps: [],
    expansions: [],
  },

  // ── Wave 2 ──────────────────────────────────────────────────────────────
  {
    id: "business-model",
    number: 4,
    title: "Business Model Design",
    wave: 2,
    kind: "stage",
    deps: [],
    expansions: [],
  },
  {
    id: "user-interviews",
    number: 5,
    title: "User Interview Simulation",
    wave: 2,
    kind: "stage",
    deps: [],
    expansions: [
      { role: "interview-transcript", perDepth: "personas", description: "25-question transcript per persona" },
      { role: "jtbd-analysis", perDepth: "personas" },
      { role: "pain-point-clustering", count: 1 },
      { role: "persona-cards", count: 1 },
    ],
  },
  {
    id: "journey-maps",
    number: 6,
    title: "Customer Journey Mapping",
    wave: 2,
    kind: "stage",
    deps: [],
    expansions: [{ role: "journey-map", perDepth: "personas", description: "one journey per persona" }],
  },

  // ── Wave 3 ──────────────────────────────────────────────────────────────
  {
    id: "prd",
    number: 7,
    title: "Product Requirements Document",
    wave: 3,
    kind: "stage",
    deps: [],
    expansions: [],
  },
  {
    id: "brand-identity",
    number: 8,
    title: "Brand Identity",
    wave: 3,
    kind: "stage",
    deps: [],
    expansions: [],
  },
  {
    id: "legal-pack",
    number: 9,
    title: "Legal & Compliance Pack",
    wave: 3,
    kind: "stage",
    deps: [],
    expansions: [{ role: "legal-document", count: 5, description: "ToS, Privacy Policy, DPA, GDPR/CCPA checklist, cookie policy" }],
  },

  // ── Wave 4 ──────────────────────────────────────────────────────────────
  {
    id: "database",
    number: 10,
    title: "Database Design",
    wave: 4,
    kind: "stage",
    deps: [],
    expansions: [],
  },
  {
    id: "api-design",
    number: 11,
    title: "API Design",
    wave: 4,
    kind: "stage",
    deps: [],
    expansions: [
      { role: "api-resource-group", count: 6, description: "OpenAPI examples and error handling per resource group" },
      { role: "api-webhook-spec", count: 1 },
    ],
  },
  {
    id: "architecture",
    number: 12,
    title: "Architecture Design",
    wave: 4,
    kind: "stage",
    deps: [],
    expansions: [{ role: "adr", perDepth: "minAdrs", description: "one call per architecture decision record" }],
  },
  {
    id: "ui-generation",
    number: 13,
    title: "UI Generation",
    wave: 4,
    kind: "stage",
    deps: [],
    expansions: [
      { role: "page-inventory", count: 1 },
      { role: "design-system-spec", count: 1 },
      { role: "screen-mockup", perDepth: "uiScreens", description: "single-file HTML/Tailwind mockup per screen" },
      { role: "screen-a11y-audit", perDepth: "uiScreens" },
    ],
  },
  {
    id: "code-gen",
    number: 14,
    title: "Code Generation",
    wave: 4,
    kind: "stage",
    deps: [],
    expansions: [
      { role: "backend-module", count: 6, description: "auth, users, billing, core domain, notifications, admin" },
      { role: "frontend-wiring", perDepth: "uiScreens" },
      { role: "module-test-suite", count: 6 },
    ],
  },
  {
    id: "marketing-plan",
    number: 15,
    title: "Marketing Plan",
    wave: 4,
    kind: "stage",
    deps: [],
    expansions: [
      { role: "ad-copy", perDepth: "ads" },
      { role: "blog-post", perDepth: "blogPosts", description: "one 1,500-word post per call" },
      { role: "email-sequence", perDepth: "sequenceEmails" },
      { role: "social-post", perDepth: "socialPosts" },
      { role: "launch-playbook", count: 1 },
    ],
  },
  {
    id: "seo-strategy",
    number: 16,
    title: "SEO Strategy",
    wave: 4,
    kind: "stage",
    deps: [],
    expansions: [],
  },
  {
    id: "pricing-strategy",
    number: 17,
    title: "Pricing Strategy",
    wave: 4,
    kind: "stage",
    deps: [],
    expansions: [],
  },
  {
    id: "sales-playbook",
    number: 18,
    title: "Sales Playbook",
    wave: 4,
    kind: "stage",
    deps: [],
    expansions: [],
  },
  {
    id: "support-pack",
    number: 19,
    title: "Customer Support Pack",
    wave: 4,
    kind: "stage",
    deps: [],
    expansions: [
      { role: "help-article", perDepth: "helpArticles", description: "one help-centre article per call" },
      { role: "chatbot-intents", count: 1 },
      { role: "escalation-matrix", count: 1 },
      { role: "sla-definitions", count: 1 },
    ],
  },
  {
    id: "financial-model",
    number: 20,
    title: "Financial Model",
    wave: 4,
    kind: "stage",
    deps: [],
    expansions: [{ role: "financial-scenario", count: 3, description: "bear / base / bull" }],
  },
  {
    id: "hiring-plan",
    number: 21,
    title: "Hiring Plan",
    wave: 4,
    kind: "stage",
    deps: [],
    expansions: [
      { role: "job-description", perDepth: "jobDescriptions" },
      { role: "interview-scorecards", count: 1 },
      { role: "compensation-bands", count: 1 },
      { role: "onboarding-plans", count: 1 },
    ],
  },
  {
    id: "gtm-timeline",
    number: 22,
    title: "Go-To-Market Timeline",
    wave: 4,
    kind: "stage",
    deps: [],
    expansions: [],
  },

  // ── Wave 5 ──────────────────────────────────────────────────────────────
  {
    id: "risk-assessment",
    number: 23,
    title: "Risk Assessment",
    wave: 5,
    kind: "stage",
    deps: [],
    expansions: [{ role: "black-swan", perDepth: "blackSwans", description: "fully narrated black-swan scenario per call" }],
  },
  {
    id: "security-threat-model",
    number: 24,
    title: "Security & Threat Model",
    wave: 5,
    kind: "stage",
    deps: [],
    expansions: [],
  },
  {
    id: "investor-pitch",
    number: 25,
    title: "Investor Pitch",
    wave: 5,
    kind: "stage",
    deps: [],
    expansions: [],
  },
  {
    id: "board-reports",
    number: 26,
    title: "Board Report Simulation",
    wave: 5,
    kind: "stage",
    deps: ["financial-model"],
    expansions: [{ role: "quarterly-report", count: 4, description: "metrics derived from the financial model" }],
  },

  // ── Wave 6 — adversarial & consistency passes ───────────────────────────
  {
    id: "devils-advocate",
    number: 27,
    title: "Devil's Advocate",
    wave: 6,
    kind: "pass",
    deps: ALL_CORE_STAGES,
    passCalls: [{ role: "devils-advocate", count: 1 }],
    expansions: [],
  },
  {
    id: "rebuttal",
    number: 28,
    title: "Rebuttal",
    wave: 6,
    kind: "pass",
    deps: ["devils-advocate"],
    passCalls: [{ role: "rebuttal", count: 1 }],
    expansions: [],
  },
  {
    id: "devils-advocate-2",
    number: 29,
    title: "Second Devil's Advocate",
    wave: 6,
    kind: "pass",
    deps: ["rebuttal"],
    passCalls: [{ role: "devils-advocate-2", count: 1 }],
    expansions: [],
  },
  {
    id: "final-rebuttal",
    number: 30,
    title: "Final Rebuttal",
    wave: 6,
    kind: "pass",
    deps: ["devils-advocate-2"],
    passCalls: [{ role: "final-rebuttal", count: 1 }],
    expansions: [],
  },
  {
    id: "red-team-blue-team",
    number: 31,
    title: "Red Team vs Blue Team",
    wave: 6,
    kind: "pass",
    deps: ["final-rebuttal"],
    passCalls: [{ role: "red-team-blue-team", count: 1, description: "3-round debate transcript" }],
    expansions: [],
  },
  {
    id: "consistency-audit",
    number: 32,
    title: "Cross-Stage Consistency Audit",
    wave: 6,
    kind: "pass",
    deps: AUDIT_PAIR_STAGES,
    passCalls: [
      { role: "audit-pair", count: 6, description: "one call per related stage pair" },
      { role: "audit-resolution", count: 0, dataDependent: true, description: "one call per contradiction found" },
    ],
    expansions: [],
  },

  // ── Wave 7 — synthesis, localisation, persona & format passes ──────────
  {
    id: "executive-synthesis",
    number: 33,
    title: "Executive Synthesis",
    wave: 7,
    kind: "pass",
    deps: ["red-team-blue-team", "consistency-audit"],
    passCalls: [{ role: "executive-synthesis", count: 1 }],
    expansions: [],
  },
  {
    id: "summary-ladder",
    number: 34,
    title: "Executive Summary Ladder",
    wave: 7,
    kind: "pass",
    deps: ["executive-synthesis"],
    passCalls: [{ role: "summary-ladder", count: 6, description: "10k / 5k / 2k / 500 / 100 words / one tweet" }],
    expansions: [],
  },
  {
    id: "meta-score",
    number: 35,
    title: "Meta-Score",
    wave: 7,
    kind: "pass",
    deps: ALL_CORE_STAGES,
    passCalls: [{ role: "meta-score", count: 1 }],
    expansions: [],
  },
  {
    id: "auto-rerun",
    number: 36,
    title: "Auto Re-run",
    wave: 7,
    kind: "pass",
    deps: ["executive-synthesis", "summary-ladder", "meta-score"],
    passCalls: [],
    expansions: [],
    rerun: { weakStages: 5, recheckedPasses: AUTO_RERUN_RECHECKED },
  },
  {
    id: "localisation",
    number: 37,
    title: "Localisation",
    wave: 7,
    kind: "pass",
    deps: ["auto-rerun"],
    passCalls: [],
    expansions: [
      { role: "translation", perLanguageDocuments: true, description: "one call per improved document × language" },
      { role: "localisation-qa", perLanguage: 1 },
      { role: "cultural-adaptation", perLanguage: 1 },
    ],
  },
  {
    id: "persona-rewrites",
    number: 38,
    title: "Persona Rewrites",
    wave: 7,
    kind: "pass",
    deps: ["auto-rerun"],
    passCalls: [{ role: "persona-rewrite", count: 6, description: "CEO, CTO, CFO, CMO, first engineer, first customer" }],
    expansions: [],
  },
  {
    id: "output-formats",
    number: 39,
    title: "Output Formats",
    wave: 7,
    kind: "pass",
    deps: ["auto-rerun"],
    passCalls: [{ role: "output-format", count: 6, description: "markdown, slide deck, podcast, FAQ, wiki, investor emails" }],
    expansions: [],
  },
];

/** All seven waves: five core waves plus the two pass waves, in order. */
export const WAVES: StageId[][] = [...CORE_WAVES, PASS_WAVE_6, PASS_WAVE_7];

const NODE_BY_ID = new Map<string, StageNode>(STAGE_NODES.map((n) => [n.id, n]));

/** Look up a node by id; throws on unknown ids (graph data is closed). */
export function stageNode(id: StageId): StageNode {
  const node = NODE_BY_ID.get(id);
  if (!node) throw new Error(`Unknown stage id: ${id}`);
  return node;
}

/** Number of core (7-call-loop) stages — the localisation document set size. */
export const LOOP_STAGE_COUNT = STAGE_NODES.filter((n) => n.kind === "stage").length;
