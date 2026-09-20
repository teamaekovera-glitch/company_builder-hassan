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
};

const GENERIC_PERSONA =
  "a specialist contributor executing exactly one call of the pipeline stage below";

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

/**
 * What each role does with the context, in one instruction. Unknown roles
 * (pass calls like `audit-pair`) get the generic instruction.
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
  return `Execute the "${role}" call for this stage and produce the complete document it requires.`;
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

/** The system prompt for one call: role identity, persona, output contract. */
export function buildSystemPrompt(role: string): string {
  const persona = ROLE_PERSONAS[role] ?? GENERIC_PERSONA;
  return [
    roleLine(role),
    `Role: ${persona}.`,
    `Output contract: a complete standalone document of at least ${MIN_RESPONSE_WORDS} words, ending with an "Assumptions & open questions" section.`,
    "The user prompt embeds every prior artifact of this run, complete and verbatim — read them all; never summarize, truncate, or skip them.",
  ].join("\n");
}

/** The user prompt for one call: config, idea, stage, full context, task. */
export function buildUserPrompt(
  node: StageNode,
  role: string,
  idea: string,
  config: RunConfig,
  artifacts: readonly StageArtifactRow[],
): string {
  return [
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
  ].join("\n");
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
