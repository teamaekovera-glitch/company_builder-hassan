/**
 * Expansion and pass-stage helpers (T10) — the pure decision layer for the
 * depth-scaled fan-outs and data-dependent pass work. Kept free of store and
 * executor imports so the counts and parsers stay unit-testable:
 *
 * - expansion call counts (static or depth-scaled),
 * - the contradiction-marker parser (the audit-pair response contract),
 * - weakest-stage selection for the stage-36 auto re-run,
 * - labels for the fixed fan-out audiences, rungs, formats, and audit pairs.
 *
 * The executor (stage.ts) owns all store reads/writes and provider calls;
 * this module never touches either.
 */

import { depthMatrix } from "../graph/depth";
import {
  AUDIT_PAIRS,
  OUTPUT_FORMAT_SPECS,
  PERSONA_REWRITE_AUDIENCES,
  STAGE_NODES,
  SUMMARY_LADDER_RUNGS,
  type ExpansionDef,
  type LoopStage,
  type StageId,
} from "../graph/stages";
import type { RunConfig } from "./config";
import {
  AUDIT_PAIR_ROLE,
  CULTURAL_ADAPTATION_ROLE,
  LOCALISATION_QA_ROLE,
  OUTPUT_FORMAT_ROLE,
  PERSONA_REWRITE_ROLE,
  SUMMARY_LADDER_ROLE,
} from "../graph/roles";

/** One expansion definition (count-, depth-, language-, or document-scaled). */
export type { ExpansionDef };

/** The 26 core loop stages — the dossier's document set for localisation. */
export function documentStages(): LoopStage[] {
  return STAGE_NODES.filter((node): node is LoopStage => node.kind === "stage");
}

/** Number of calls an expansion runs for the given config. */
export function expansionCallCount(expansion: ExpansionDef, config: RunConfig): number {
  if ("perLanguage" in expansion) return config.languages.length;
  if ("perLanguageDocuments" in expansion) return documentStages().length * config.languages.length;
  if ("count" in expansion) return expansion.count;
  return depthMatrix(config.depth)[expansion.perDepth];
}

/**
 * Parses the audit-pair response contract: each pair audit ends with one
 * `CONTRADICTION: <summary>` line per contradiction found, or the literal
 * `CONTRADICTION: none`. The literal (and any blank summary) produces no
 * resolutions — the count is decided by what the audit actually reported.
 */
export function parseContradictions(text: string): string[] {
  const found: string[] = [];
  for (const rawLine of text.split("\n")) {
    const match = /^CONTRADICTION:\s*(.+?)\s*$/i.exec(rawLine.trim());
    const summary = match?.[1];
    if (summary && !/^none$/i.test(summary)) found.push(summary);
  }
  return found;
}

/** A stage selected by the stage-36 auto re-run: id plus its reconciled score. */
export interface WeakStage {
  stageId: StageId;
  score: number;
}

/**
 * Picks the `count` lowest-scored core stages for the auto re-run. Only
 * stages with a reconciled score are eligible (pass stages never run the
 * seven-call loop and are never re-looped); ties resolve by brief order so
 * the selection is deterministic. Pure — the executor passes the persisted
 * stage_status rows in.
 */
export function selectWeakStages(
  statuses: readonly { stageId: string; score: number | null }[],
  briefOrder: readonly StageId[],
  count: number,
): WeakStage[] {
  const order = new Map(briefOrder.map((id, i) => [id, i]));
  return statuses
    .filter((row): row is { stageId: string; score: number } => row.score !== null)
    .sort(
      (a, b) =>
        a.score - b.score ||
        (order.get(a.stageId as StageId) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.stageId as StageId) ?? Number.MAX_SAFE_INTEGER),
    )
    .slice(0, count)
    .map(({ stageId, score }) => ({ stageId: stageId as StageId, score }));
}

/** `prefix:rest` → rest when kind starts with `prefix:`, else null. */
function stripPrefix(kind: string, prefix: string): string | null {
  return kind.startsWith(`${prefix}:`) ? kind.slice(prefix.length + 1) : null;
}

/**
 * Operator-facing label for a recorded artifact kind on a pass or expansion
 * call — "audit-pair:3" reads as "Pair audit 3 of 6 — pricing ↔ financial
 * model"; "rerun:financial-model:improved" reads as "Re-run winner —
 * Financial Model". Falls back to a prettified kind for anything unnamed.
 */
export function artifactLabel(
  kind: string,
  stageTitleOf: (stageId: string) => string | undefined,
): string {
  const auditPair = stripPrefix(kind, "audit-pair");
  if (auditPair && /^\d+$/.test(auditPair)) {
    const index = Number(auditPair) - 1;
    const pair = AUDIT_PAIRS[index];
    return pair ? `Pair audit ${index + 1} of ${AUDIT_PAIRS.length} — ${pair.label}` : kind;
  }
  const resolution = stripPrefix(kind, "audit-resolution");
  if (resolution && /^\d+$/.test(resolution)) return `Resolution ${resolution}`;

  const ladder = stripPrefix(kind, SUMMARY_LADDER_ROLE);
  if (ladder && /^\d+$/.test(ladder)) {
    const index = Number(ladder) - 1;
    const rung = SUMMARY_LADDER_RUNGS[index];
    return rung ? `Summary ladder ${index + 1} — ${rung}` : kind;
  }
  const persona = stripPrefix(kind, PERSONA_REWRITE_ROLE);
  if (persona && /^\d+$/.test(persona)) {
    const index = Number(persona) - 1;
    const audience = PERSONA_REWRITE_AUDIENCES[index];
    return audience ? `Persona rewrite — ${audience}` : kind;
  }
  const format = stripPrefix(kind, OUTPUT_FORMAT_ROLE);
  if (format && /^\d+$/.test(format)) {
    const index = Number(format) - 1;
    const spec = OUTPUT_FORMAT_SPECS[index];
    return spec ? `Output format — ${spec}` : kind;
  }

  if (kind === "rerun-selection") return "Auto re-run — weakest-stage selection";
  const rerunOutcome = stripPrefix(kind, "rerun-outcome");
  if (rerunOutcome) return `Re-run outcome — ${stageTitleOf(rerunOutcome) ?? rerunOutcome}`;
  const rerunWinner = stripPrefix(kind, "rerun");
  if (rerunWinner?.endsWith(":improved")) {
    const stageId = rerunWinner.slice(0, -":improved".length);
    return `Re-run winner — ${stageTitleOf(stageId) ?? stageId}`;
  }

  const recheck = stripPrefix(kind, "recheck");
  if (recheck) {
    const separator = recheck.indexOf(":");
    if (separator > 0) {
      const passId = recheck.slice(0, separator);
      const rest = recheck.slice(separator + 1);
      return `Recheck — ${stageTitleOf(passId) ?? passId} — ${plainCallLabel(rest)}`;
    }
  }

  const qa = stripPrefix(kind, LOCALISATION_QA_ROLE);
  if (qa && /^[a-z-]+$/.test(qa)) return `Localisation QA — ${languageName(qa)}`;
  const adaptation = stripPrefix(kind, CULTURAL_ADAPTATION_ROLE);
  if (adaptation && /^[a-z-]+$/.test(adaptation)) return `Cultural adaptation — ${languageName(adaptation)}`;

  return plainCallLabel(kind);
}

/** Human label for a bare role/kind ("gen-a" → "Generator A", "audit-pair" → "Audit pair"). */
export function plainCallLabel(role: string): string {
  const gen = /^gen-([a-z])$/.exec(role);
  if (gen?.[1]) return `Generator ${gen[1].toUpperCase()}`;
  return role
    .split(/[:\-]/)
    .filter(Boolean)
    .map((word) => (/^\d+$/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ")
    .replace(/\bVc\b/, "VC")
    .replace(/\bJtbd\b/, "JTBD")
    .replace(/\bApi\b/g, "API")
    .replace(/\bSla\b/g, "SLA")
    .replace(/\bHtml\b/g, "HTML")
    .replace(/\bGtm\b/g, "GTM")
    .replace(/\bPrd\b/g, "PRD");
}

/** The audit pair descriptions in call order — one audit-pair call per pair. */
export function auditPairDescription(index: number): string {
  const pair = AUDIT_PAIRS[index];
  return pair ? `Audit the ${pair.label} pair for contradictions` : `Audit pair ${index + 1}`;
}

/** Language display name for the five pipeline languages (codes otherwise). */
export function languageName(code: string): string {
  const labels: Record<string, string> = {
    en: "English",
    es: "Spanish",
    hi: "Hindi",
    ar: "Arabic (RTL)",
    fr: "French",
  };
  return labels[code] ?? code;
}

/**
 * The per-language callDetail for a localisation call: which language, and
 * what the call must do with it. `sourceStage` names the document being
 * translated when the call is a translation.
 */
export function localisationCallDetail(
  role: string,
  language: string,
  sourceStage: string | undefined,
): string {
  const name = languageName(language);
  if (role === LOCALISATION_QA_ROLE) {
    return (
      `Review the ${name} localisations for fidelity, completeness, and cultural fit. ` +
      `List every issue found, then end with a line exactly "LOCALISATION_QA_VERDICT: pass" or "LOCALISATION_QA_VERDICT: fail".`
    );
  }
  if (role === CULTURAL_ADAPTATION_ROLE) {
    return `Rewrite the marketing and pricing deliverables for the ${name}-market reader: currency, register, examples, and any culturally specific claims.`;
  }
  if (role === "translation") {
    return sourceStage
      ? `Translate the complete ${sourceStage} deliverable into ${name}. Preserve structure, numbers, and formatting; translate faithfully rather than summarising.`
      : `Translate the complete deliverable into ${name}. Preserve structure, numbers, and formatting.`;
  }
  return `Localisation work in ${name}.`;
}

/**
 * The callDetail for a fixed-index expansion call (deep dives, interviews,
 * mockups, and the other per-item fan-outs). `index` is 0-based.
 */
export function expansionCallDetail(role: string, index: number, total: number): string {
  const nth = `item ${index + 1} of ${total}`;
  switch (role) {
    case "competitor-list":
      return "List the competitive set: named competitors with positioning, pricing, and traction.";
    case "competitor-deep-dive":
      return `Deep-dive competitor ${index + 1} of ${total}: SWOT, pricing, features, and customer sentiment.`;
    case "competitor-synthesis":
      return "Merge the deep dives into one competitive-landscape read.";
    case "interview-transcript":
      return `Produce the 25-question interview transcript for persona ${index + 1} of ${total}.`;
    case "jtbd-analysis":
      return `Produce the jobs-to-be-done map for persona ${index + 1} of ${total}.`;
    case "pain-point-clustering":
      return "Cluster the interviews' pain points into named themes with frequency and severity.";
    case "persona-cards":
      return "Produce the full persona cards built from the interview transcripts.";
    case "journey-map":
      return `Map the end-to-end journey for persona ${index + 1} of ${total}.`;
    case "legal-document":
      return `Produce legal document ${index + 1} of ${total} (ToS, Privacy Policy, DPA, GDPR/CCPA checklist, cookie policy).`;
    case "api-resource-group":
      return `Design resource group ${index + 1} of ${total}: routes, request/response schemas, and errors.`;
    case "api-webhook-spec":
      return "Specify the webhook and async-event surface: events, payloads, retries, and signatures.";
    case "adr":
      return `Write architecture decision record ${index + 1} of ${total}: context, options, decision, consequences.`;
    case "page-inventory":
      return "Inventory every page: route, purpose, primary states, and data needs.";
    case "design-system-spec":
      return "Specify the design system: tokens, components, and interaction states.";
    case "screen-mockup":
      return `Produce the single-file HTML/Tailwind mockup for screen ${index + 1} of ${total} — the complete page, no truncation.`;
    case "screen-a11y-audit":
      return `Audit screen mockup ${index + 1} of ${total} for WCAG compliance, in depth.`;
    case "backend-module":
      return `Specify backend module ${index + 1} of ${total}: contract, data flow, and failure handling.`;
    case "frontend-wiring":
      return `Specify screen ${index + 1} of ${total}'s API wiring: data needs, states, and error handling.`;
    case "module-test-suite":
      return `Write the test suite for module ${index + 1} of ${total}: cases, fixtures, and edge cases.`;
    case "ad-copy":
      return `Produce the advertising batch for channel ${index + 1} of ${total}.`;
    case "blog-post":
      return `Write blog post ${index + 1} of ${total}: 1,500 words, grounded in the research artifacts.`;
    case "email-sequence":
      return `Produce the email sequence for segment ${index + 1} of ${total}.`;
    case "social-post":
      return `Produce the social post batch for channel ${index + 1} of ${total}.`;
    case "launch-playbook":
      return "Write the complete launch playbook: timeline, channels, assets, and owners.";
    case "help-article":
      return `Write help-centre article ${index + 1} of ${total}.`;
    case "chatbot-intents":
      return "Catalogue the chatbot intents with example utterances and escalation triggers.";
    case "escalation-matrix":
      return "Write the support escalation matrix: tiers, triggers, and response targets.";
    case "sla-definitions":
      return "Define the SLAs: uptime, response, and resolution targets per plan tier.";
    case "financial-scenario":
      return `Produce the ${["bear", "base", "bull"][index] ?? nth} financial scenario.`;
    case "job-description":
      return `Write job description ${index + 1} of ${total}.`;
    case "interview-scorecards":
      return `Write the interview scorecards for role ${index + 1} of ${total}.`;
    case "compensation-bands":
      return `Define the compensation band for role ${index + 1} of ${total}.`;
    case "onboarding-plans":
      return `Write the 90-day onboarding plan for role ${index + 1} of ${total}.`;
    case "black-swan":
      return `Narrate black-swan scenario ${index + 1} of ${total} with early warnings and contingencies.`;
    case "quarterly-report":
      return `Produce the quarter ${index + 1} report with metrics derived from the financial model.`;
    default:
      return `Produce the "${role}" deliverable — ${nth}.`;
  }
}

/**
 * The callDetail for a fixed-index pass call (ladder rung, persona, format,
 * audit pair). `index` is 0-based; roles without a fixed catalogue have no
 * detail line.
 */
export function passCallDetail(role: string, index: number, total: number): string | undefined {
  if (role === AUDIT_PAIR_ROLE) return `${auditPairDescription(index)} (pair ${index + 1} of ${total}).`;
  if (role === SUMMARY_LADDER_ROLE) {
    const rung = SUMMARY_LADDER_RUNGS[index];
    return `Produce the ${rung ?? `rung ${index + 1}`} version of the executive synthesis.`;
  }
  if (role === PERSONA_REWRITE_ROLE) {
    const audience = PERSONA_REWRITE_AUDIENCES[index];
    return audience
      ? `Rewrite the executive synthesis for the ${audience} audience: what they care about, in their terms, at least 3,000 words.`
      : `Persona rewrite ${index + 1} of ${total}.`;
  }
  if (role === OUTPUT_FORMAT_ROLE) {
    const spec = OUTPUT_FORMAT_SPECS[index];
    return spec ? `Produce the ${spec} output.` : `Output format ${index + 1} of ${total}.`;
  }
  return undefined;
}
