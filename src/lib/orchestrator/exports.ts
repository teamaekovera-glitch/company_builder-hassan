/**
 * Markdown export builders (spec global actions): dossier.md and run-log.md.
 *
 * Pure functions over the store — the HTTP layer only sets headers. Both are
 * deterministic for a given store state (no clocks, no locale formatting) so
 * the golden-file tests can compare byte-exact output, and every artifact
 * that should exist but does not is marked MISSING in the output instead of
 * silently dropped (spec failure mode: missing or escaped artifacts).
 */

import { LANGUAGE_LABELS } from "../dashboard/types";
import { STAGE_NODES, type StageId, type StageNode } from "../pipeline/graph/stages";
import { WINNING_ARTIFACT_KIND } from "../pipeline/executor/stage";
import type { RunRow, StageArtifactRow, StageStatusRow } from "../store/schema";
import type { RunStore } from "../store/store";

/** Label for a kind-encoded language code; unknown codes render as themselves. */
function translationLabel(code: string): string {
  const known = (LANGUAGE_LABELS as Record<string, { label: string } | undefined>)[code];
  return known?.label ?? code;
}

/** Fences the text verbatim, sizing the fence so embedded backticks cannot escape it. */
function fenced(text: string): string {
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

/** Kinds a loop stage's quality loop must have produced. */
function isLoopStage(node: StageNode | undefined): boolean {
  return node?.kind === "stage";
}

/** One dossier entry: the winning improved draft plus every translation. */
interface StageExport {
  stageId: string;
  title: string;
  isLoop: boolean;
  /** Stage rows in stage_status, for the MISSING marker. */
  status: StageStatusRow | undefined;
  /** Winning improved draft (English), when the loop produced one. */
  improved: StageArtifactRow | undefined;
  /** Kind-encoded translations (`translation:<lang>`), sorted by language code. */
  translations: { code: string; row: StageArtifactRow }[];
}

function stageExports(store: RunStore, runId: string): StageExport[] {
  const byStage = new Map<string, StageArtifactRow[]>();
  for (const row of store.listRunArtifacts(runId)) {
    const rows = byStage.get(row.stage_id) ?? [];
    rows.push(row);
    byStage.set(row.stage_id, rows);
  }
  // Stage order: the 39-stage brief order for known stages, then any
  // artifact-only stages (e.g. the alternatives comparison) last.
  const known = STAGE_NODES.filter((node) => byStage.has(node.id) || store.getStageStatus(runId, node.id));
  const unknown = [...byStage.keys()].filter((stageId) => !STAGE_NODES.some((node) => node.id === stageId));
  return [...known.map((node) => node.id), ...unknown].map((stageId) => {
    const node = STAGE_NODES.find((n) => n.id === (stageId as StageId));
    const rows = byStage.get(stageId) ?? [];
    return {
      stageId,
      title: node?.title ?? stageId,
      isLoop: isLoopStage(node),
      status: store.getStageStatus(runId, stageId),
      improved: rows.find((row) => row.kind === WINNING_ARTIFACT_KIND),
      translations: rows
        .flatMap((row) => {
          const match = /^translation:([a-z-]+)$/.exec(row.kind);
          return match ? [{ code: match[1] ?? "", row }] : [];
        })
        .sort((a, b) => a.code.localeCompare(b.code)),
    };
  });
}

function configLine(run: RunRow): string {
  const config = JSON.parse(run.config_json) as { depth?: string; languages?: string[]; scoreThreshold?: number; strategyAngle?: string };
  const languages = (config.languages ?? []).join(", ");
  const threshold = config.scoreThreshold === undefined ? "—" : config.scoreThreshold.toFixed(1);
  return `Config: depth ${config.depth ?? "—"} · languages ${languages || "—"} · score gate ${threshold} · strategy angle ${config.strategyAngle ?? "none"}`;
}

/**
 * dossier.md — contents list plus every improved artifact grouped by stage
 * and language (spec global actions). Verbatim texts; a loop stage whose
 * improved draft is absent is marked MISSING, never dropped. The caller has
 * already resolved the run row.
 */
export function buildDossierMarkdown(store: RunStore, run: RunRow): string {
  const stages = stageExports(store, run.id);

  const lines: string[] = [
    "# Company dossier",
    "",
    `Run: \`${run.id}\``,
    `Idea: ${run.idea}`,
    configLine(run),
    "",
    "## Contents",
    "",
  ];
  if (stages.length === 0) lines.push("_No artifacts yet — the run has not produced deliverables._");
  for (const stage of stages) {
    const languages = [stage.improved ? "English" : null, ...stage.translations.map((t) => translationLabel(t.code))]
      .filter(Boolean)
      .join(", ");
    lines.push(`- ${stage.title} (\`${stage.stageId}\`)${languages ? ` — ${languages}` : ""}`);
  }
  lines.push("", `Cross-references: every prompt and response verbatim in the run log (\`run-log.md\`).`, "");

  for (const stage of stages) {
    lines.push(`---`, "", `## ${stage.title} (\`${stage.stageId}\`)`, "");
    const hasBody = stage.improved !== undefined || stage.translations.length > 0;
    if (stage.isLoop && stage.improved === undefined) {
      lines.push(
        `> MISSING: the winning improved draft for this stage was not found in the store${stage.status ? ` (stage status: ${stage.status.status})` : ""}.`,
        "",
      );
    } else if (!hasBody) {
      lines.push(
        `> MISSING: no artifacts recorded for this stage${stage.status ? ` (stage status: ${stage.status.status})` : ""}.`,
        "",
      );
    }
    if (stage.improved) {
      lines.push(`### English`, "", fenced(stage.improved.text), "");
    }
    for (const t of stage.translations) {
      lines.push(`### ${translationLabel(t.code)} (\`${t.code}\`)`, "", fenced(t.row.text), "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * run-log.md — every prompt and every response, verbatim, in run order with
 * per-call metadata (stage, role, loop, attempt, tokens, ms). Failed
 * attempts quote the error verbatim; usage arrives only with the successful
 * result (T2 contract). The caller has already resolved the run row.
 */
export function buildRunLogMarkdown(store: RunStore, run: RunRow): string {
  const calls = store.listRunCalls(run.id);

  const lines: string[] = [
    "# Run log",
    "",
    `Run: \`${run.id}\``,
    `Idea: ${run.idea}`,
    configLine(run),
    "",
    `${calls.length} call${calls.length === 1 ? "" : "s"}, verbatim, in run order.`,
    "",
  ];
  calls.forEach((call, index) => {
    lines.push(
      `---`,
      "",
      `## Call ${index + 1} — \`${call.stage_id}\` / \`${call.role}\``,
      "",
      `- loop: ${call.loop} · attempt: ${call.attempt}`,
      `- tokens: ${call.input_tokens ?? "—"} in / ${call.output_tokens ?? "—"} out · ${call.ms ?? "—"} ms`,
      "",
      `### Prompt`,
      "",
      fenced(call.prompt),
      "",
    );
    if (call.error !== null && call.error !== undefined && call.error !== "") {
      lines.push(`### Error`, "", fenced(call.error), "");
    }
    if (call.response !== null && call.response !== undefined && call.response !== "") {
      lines.push(`### Response`, "", fenced(call.response), "");
    } else if (call.error === null || call.error === "") {
      lines.push(`### Response`, "", "> MISSING: no response and no error recorded for this attempt.", "");
    }
  });
  return `${lines.join("\n").trimEnd()}\n`;
}
