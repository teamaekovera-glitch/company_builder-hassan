/**
 * Prompt construction — global call rules 2 and 3, made concrete.
 *
 * Rule 2 (context threading): every prompt embeds the COMPLETE text of every
 * artifact the run has produced so far, byte-for-byte, in production order
 * (store `rowid` order). Nothing is ever truncated or summarized; when a
 * request outgrows the model's context window it fails loudly through the
 * retry path, and the remedy is a longer-context model in config.
 *
 * Rule 3 (output contract): every system prompt states the two validation
 * rules the retry layer enforces — the closing assumptions section and the
 * 2,000-word floor — so the model is told the contract it is held to.
 */

import { MIN_RESPONSE_WORDS } from "../../llm/validation";
import type { StageArtifactRow } from "../../store/schema";
import type { StageNode } from "../graph/stages";
import type { RunConfig } from "./config";
import { ScoreParseError } from "./errors";

/**
 * The marker the reconciler must end its response with; the executor parses
 * the reconciled score from it. Prompted explicitly, parsed strictly — a
 * missing marker fails the call rather than guessing a score.
 */
export const RECONCILED_SCORE_MARKER = "RECONCILED_SCORE:";

/**
 * The marker the pair audits must use to report contradictions (stage 32,
 * spec "contradiction detection + resolution"): one line per contradiction,
 * `CONTRADICTION: <summary>`, or the literal `CONTRADICTION: none`. The
 * executor parses these lines to size the resolution fan-out.
 */
export const CONTRADICTION_MARKER = "CONTRADICTION:";

/** The marker the localisation QA calls must end their verdict with. */
export const LOCALISATION_QA_VERDICT_MARKER = "LOCALISATION_QA_VERDICT:";

/** Role personas: concise operator-facing briefs, keyed by canonical role. */
const ROLE_PERSONAS: Record<string, string> = {
  "gen-a": "the canonical first-drafter: thorough, conventional, evidence-first",
  "gen-b": "the contrarian first-drafter: attack the idea's weakest assumptions and explore the bolder version",
  "gen-c": "the third-lens first-drafter: produce a genuinely different structural take, not a blend of the other two",
  merger: "the merger: fuse the three drafts into one superset document, keeping the best of each and dropping nothing load-bearing",
  "critic:pessimistic-vc": "the pessimistic venture-capitalist critic: hunt for market-size lies, weak moats, and death-by-unit-economics",
  "critic:enterprise-buyer": "the enterprise-buyer critic: raise procurement, compliance, integration, and switching-cost objections",
  "critic:senior-engineer": "the senior-engineer critic: raise feasibility, tech-debt, scaling, and operational-gap objections",
  improver: "the improver: rewrite the merged draft so every critique point is addressed, without shrinking it",
  "judge:harsh": "the harsh judge: score demandingly across your 12 criteria",
  "judge:balanced": "the balanced judge: score even-handedly across your 12 criteria",
  "judge:generous": "the generous judge: score charitably across your 12 criteria",
  reconciler: `the score reconciler: read all three judges' scores, settle one final score for this round, and explain the rationale in full. End your response with the exact final line "${RECONCILED_SCORE_MARKER} <0-10>"`,
  // Adversarial gauntlet (stages 27-31).
  "devils-advocate": "the devil's advocate: argue the strongest possible case that this company fails",
  rebuttal: "the founder-rebuttal voice: answer every attack using only what the dossier's artifacts actually say",
  "devils-advocate-2": "the second devil's advocate: a fresh, harder attack round that finds what the first missed",
  "final-rebuttal": "the final defender: close every remaining attack with evidence from the artifacts",
  "red-team-blue-team": "the red-team/blue-team lead: run both sides of the debate and land a reasoned verdict",
  // Consistency audit + resolutions (stage 32).
  "audit-pair": `the consistency auditor: read both artifacts of your assigned pair and hunt for contradictions. Report each contradiction as its own line "${CONTRADICTION_MARKER} <summary>", or end with the literal "${CONTRADICTION_MARKER} none"`,
  "audit-resolution": "the contradiction resolver: settle the contradiction named in your instructions and write the resolution the two stages must adopt",
  // Synthesis pass (stages 33-35).
  "executive-synthesis": "the executive editor: write the dossier's narrative spine plus a glossary of every significant term",
  "summary-ladder": "the summarizer: compress the executive synthesis to exactly the length your rung demands, losing no load-bearing claim",
  "meta-score": "the meta-scorer: rank every stage by its reconciled score and name the weakest ones",
  // Localisation pass (stage 37).
  translation: "the translator: faithful, complete, structure-preserving translation of the named deliverable",
  "localisation-qa": `the localisation QA reviewer: audit the translations for fidelity, completeness, and cultural fit. End with the exact final line "${LOCALISATION_QA_VERDICT_MARKER} pass" or "${LOCALISATION_QA_VERDICT_MARKER} fail"`,
  "cultural-adaptation": "the cultural adaptation lead: rewrite marketing and pricing for the target market's conventions and expectations",
  // Final formats (stages 38-39).
  "persona-rewrite": "the audience editor: rewrite the executive synthesis for one named audience, in their terms",
  "output-format": "the format producer: convert the dossier into one named output format",
  // Core-stage expansion specialists.
  "competitor-list": "the competitive-intelligence analyst: name and profile the competitive set",
  "competitor-deep-dive": "the competitive-intelligence analyst: one competitor deep dive — SWOT, pricing, features, sentiment",
  "competitor-synthesis": "the competitive-intelligence synthesizer: merge the deep dives into one landscape read",
  "interview-transcript": "the user researcher: a 25-question interview transcript for one persona",
  "jtbd-analysis": "the jobs-to-be-done strategist: one job map per persona",
  "pain-point-clustering": "the user researcher: cluster the interviews' pain points into themes",
  "persona-cards": "the product marketer: full persona cards built from the interviews",
  "journey-map": "the service designer: one end-to-end journey for one persona",
  "legal-document": "the startup counsel: one legal document, jurisdiction-aware, per call",
  "api-resource-group": "the API designer: one resource group's REST surface — routes, schemas, errors",
  "api-webhook-spec": "the API designer: the webhook and async-event specification",
  adr: "the principal engineer: one architecture decision record — context, options, decision, consequences",
  "page-inventory": "the product designer: the complete page inventory with routes and states",
  "design-system-spec": "the design-system lead: tokens, components, and interaction states",
  "screen-mockup": "the UI engineer: one single-file HTML/Tailwind screen mockup — the full page, no truncation",
  "screen-a11y-audit": "the accessibility auditor: WCAG audit of one screen mockup",
  "backend-module": "the backend lead: one service module's contract, data flow, and failure handling",
  "frontend-wiring": "the frontend lead: one screen's API wiring — data needs, states, errors",
  "module-test-suite": "the quality engineer: one module's test suite — cases, fixtures, edge cases",
  "ad-copy": "the performance marketer: one advertising batch per call",
  "blog-post": "the content lead: one 1,500-word post per call",
  "email-sequence": "the lifecycle marketer: one email sequence per call",
  "social-post": "the social lead: one channel's post batch per call",
  "launch-playbook": "the launch lead: the complete launch playbook",
  "help-article": "the support lead: one help-centre article per call",
  "chatbot-intents": "the conversation designer: the chatbot intent catalogue",
  "escalation-matrix": "the support lead: the escalation matrix",
  "sla-definitions": "the customer-success lead: the SLA definitions",
  "financial-scenario": "the finance lead: one financial scenario — bear, base, or bull",
  "job-description": "the talent lead: one role's job description",
  "interview-scorecards": "the talent lead: one role's interview scorecards",
  "compensation-bands": "the compensation lead: one role's compensation band",
  "onboarding-plans": "the people lead: one role's 90-day onboarding plan",
  "black-swan": "the risk lead: one fully narrated black-swan scenario and its early warnings",
  "quarterly-report": "the finance lead: one quarterly report derived from the financial model",
};

const GENERIC_PERSONA =
  "a specialist contributor executing exactly one call of the pipeline stage below";

/**
 * Resolves the persona for a role, unwrapping executor prefixes: a re-run
 * call `rerun:financial-model:gen-a` inherits Generator A's persona, a
 * recheck call `recheck:summary-ladder:summary-ladder:2` inherits the
 * summarizer's. Unknown roles get the generic persona.
 */
function personaFor(role: string): string {
  const exact = ROLE_PERSONAS[role];
  if (exact) return exact;
  for (const prefix of ["rerun", "recheck"] as const) {
    const rest = role.startsWith(`${prefix}:`) ? role.slice(prefix.length + 1) : null;
    if (rest !== null) {
      const separator = rest.indexOf(":");
      const base = separator === -1 ? rest : rest.slice(separator + 1);
      return ROLE_PERSONAS[base] ?? GENERIC_PERSONA;
    }
  }
  return GENERIC_PERSONA;
}

/** First line of every system prompt — the canonical role identity. */
function roleLine(role: string): string {
  return `You are ${role}.`;
}

/** Extracts the canonical role back out of an executor-built system prompt. */
export function roleFromSystem(system: string): string {
  const first = system.split("\n")[0] ?? "";
  const match = /^You are ([a-z0-9:-]+)\.$/.exec(first);
  if (!match) {
    throw new Error(`system prompt does not open with a role line: ${first.slice(0, 80)}`);
  }
  return match[1];
}

/** Strips a leading `rerun:<stage>:` or `recheck:<pass>:` executor prefix. */
function baseRoleOf(role: string): string {
  for (const prefix of ["rerun", "recheck"] as const) {
    const rest = role.startsWith(`${prefix}:`) ? role.slice(prefix.length + 1) : null;
    if (rest !== null) {
      const separator = rest.indexOf(":");
      return separator === -1 ? rest : rest.slice(separator + 1);
    }
  }
  return role;
}

/**
 * What each role does with the context, in one instruction. Unknown roles
 * get a generic instruction naming their (prefix-stripped) role.
 */
function taskFor(role: string): string {
  if (role.startsWith("gen-")) {
    return "Write your complete independent draft of this stage — a full document, not an outline.";
  }
  if (role === "merger") {
    return "Fuse the three generator drafts into the single best version of this stage.";
  }
  if (role.startsWith("critic:")) {
    return "Critique the current best draft across 20 numbered points, ordered by severity.";
  }
  if (role === "improver") {
    return "Rewrite the merged draft addressing every critique point from all three critics.";
  }
  if (role.startsWith("judge:")) {
    return "Score the current draft against your 12 criteria (0-10 each) and justify every score.";
  }
  if (role === "reconciler") {
    return `Reconcile the three judges into one final score for this round, then end with "${RECONCILED_SCORE_MARKER} <score>".`;
  }
  if (role === "devils-advocate") {
    return "Argue the strongest possible case that this company fails, using only the artifacts in context as evidence.";
  }
  if (role === "rebuttal" || role === "final-rebuttal") {
    return "Rebut every attack in full, citing the artifacts that refute it; concede what cannot be refuted.";
  }
  if (role === "devils-advocate-2") {
    return "Launch a second, harder attack round: find the failure modes the first attack missed.";
  }
  if (role === "red-team-blue-team") {
    return "Run the red team (attacks) and the blue team (defenses) against the dossier, then land a reasoned verdict.";
  }
  if (role === "audit-pair") {
    return `Audit the two artifacts of your assigned pair against each other and report every contradiction as its own "${CONTRADICTION_MARKER}" line (or "${CONTRADICTION_MARKER} none").`;
  }
  if (role === "audit-resolution") {
    return "Settle the contradiction named in your call detail: write the resolution both stages must adopt, and name what changes in each artifact.";
  }
  if (role === "executive-synthesis") {
    return "Write the executive synthesis: the dossier's narrative spine plus a glossary of at least 100 significant terms.";
  }
  if (role === "summary-ladder") {
    return "Compress the executive synthesis to exactly the length your rung demands without losing a load-bearing claim.";
  }
  if (role === "meta-score") {
    return "Rank every completed stage by its reconciled score and name the weakest stages with their scores.";
  }
  if (role === "translation") {
    return "Translate the named deliverable faithfully and completely into the target language, preserving structure and numbers.";
  }
  if (role === "localisation-qa") {
    return `Audit the target language's localisations for fidelity, completeness, and cultural fit, then end with the final line "${LOCALISATION_QA_VERDICT_MARKER} <pass|fail>".`;
  }
  if (role === "cultural-adaptation") {
    return "Rewrite the marketing and pricing deliverables for the target market: currency, register, examples, and cultural claims.";
  }
  if (role === "persona-rewrite") {
    return "Rewrite the executive synthesis for the named audience, in their terms, at least 3,000 words.";
  }
  if (role === "output-format") {
    return "Produce the named output format from the dossier, complete and self-contained.";
  }
  return `Execute the "${baseRoleOf(role)}" call for this stage and produce the complete document it requires.`;
}

/** Verbatim context block: every artifact so far, production order. */
export function formatArtifacts(artifacts: readonly StageArtifactRow[]): string {
  if (artifacts.length === 0) {
    return "(none yet — this call starts the run's first artifact)";
  }
  return artifacts
    .map(
      (a) =>
        `<<<ARTIFACT stage=${a.stage_id} kind=${a.kind} language=${a.language}>>>\n${a.text}\n<<<END ARTIFACT>>>`,
    )
    .join("\n\n");
}

/**
 * The system prompt for one call: role identity, persona, output contract,
 * and — for the roles whose responses the executor parses — the explicit
 * marker contract (contradiction lines for pair audits, the verdict line
 * for localisation QA).
 */
export function buildSystemPrompt(role: string): string {
  const persona = personaFor(role);
  const lines = [
    roleLine(role),
    `Role: ${persona}.`,
    `Output contract: a complete standalone document of at least ${MIN_RESPONSE_WORDS} words, ending with an "Assumptions & open questions" section.`,
    "The user prompt embeds every prior artifact of this run, complete and verbatim — read them all; never summarize, truncate, or skip them.",
  ];
  if (isAuditPairRole(role)) {
    lines.push(
      `Marker contract: report each contradiction you find on its own line as "${CONTRADICTION_MARKER} <summary>". If the two artifacts genuinely conflict on nothing, end with the literal "${CONTRADICTION_MARKER} none".`,
    );
  }
  if (isLocalisationQaRole(role)) {
    lines.push(
      `Marker contract: end your response with the exact final line "${LOCALISATION_QA_VERDICT_MARKER} pass" or "${LOCALISATION_QA_VERDICT_MARKER} fail".`,
    );
  }
  return lines.join("\n");
}

/** True for the pair-audit role in plain and executor-prefixed forms. */
export function isAuditPairRole(role: string): boolean {
  return role === "audit-pair" || role.endsWith(":audit-pair");
}

/** True for the localisation-QA role in plain and executor-prefixed forms. */
export function isLocalisationQaRole(role: string): boolean {
  return role === "localisation-qa" || role.endsWith(":localisation-qa");
}

/** The user prompt for one call: config, idea, stage, full context, task, optional per-call detail. */
export function buildUserPrompt(
  node: StageNode,
  role: string,
  idea: string,
  config: RunConfig,
  artifacts: readonly StageArtifactRow[],
  detail?: string,
): string {
  const lines = [
    "# Run configuration",
    `Depth: ${config.depth}. Score threshold: ${config.scoreThreshold}. Languages: ${config.languages.join(", ")}. Strategy angle: ${config.strategyAngle ?? "none"}.`,
    "",
    "# Business idea",
    idea,
    "",
    "# Stage",
    `Stage ${node.number} — ${node.title} (${node.kind === "stage" ? "core loop stage" : "pass stage"}, wave ${node.wave})`,
    "",
    "# Prior artifacts of this run (complete, verbatim — never summarize or truncate)",
    formatArtifacts(artifacts),
    "",
    "# Your task",
    taskFor(role),
  ];
  if (detail) {
    lines.push("", "# Call detail", detail);
  }
  return lines.join("\n");
}

/** The verbatim composite persisted to `calls.prompt` for every attempt. */
export function composePersistedPrompt(req: { system: string; user: string }): string {
  return `SYSTEM:\n${req.system}\n\nUSER:\n${req.user}`;
}

/**
 * Parses the reconciled score out of the reconciler's response. Takes the
 * LAST marker occurrence so stray mentions of the marker cannot override the
 * final verdict. Throws `ScoreParseError` when absent or out of range.
 */
export function extractReconciledScore(response: string): number {
  const matches = [...response.matchAll(/RECONCILED_SCORE:\s*([0-9]+(?:\.[0-9]+)?)/gi)];
  const last = matches[matches.length - 1];
  if (!last) {
    throw new ScoreParseError(`reconciler response is missing the "${RECONCILED_SCORE_MARKER}" marker`);
  }
  const score = Number(last[1]);
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    throw new ScoreParseError(`reconciled score out of range: ${last[1]}`);
  }
  return score;
}
