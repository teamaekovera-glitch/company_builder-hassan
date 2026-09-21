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
import { artifactLabel } from "../pipeline/executor/expansions";
import { STAGE_NODES, type StageId, type StageNode } from "../pipeline/graph/stages";
import { WINNING_ARTIFACT_KIND } from "../pipeline/executor/stage";
import type { CallRow, CallVerbatimMetaRow, RunRow, StageArtifactRow, StageStatusRow } from "../store/schema";
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

/**
 * Bounded verbatim chunk: SQLite `substr` reads at most this many code points
 * per string (~24 MB of UTF-8). Sized so a typical multi-megabyte call reads
 * in ONE substr query — every substr call re-decodes the stored row, so tiny
 * chunks multiply decode cost ~row-size/chunk-fold — while peak memory stays
 * at one chunk, never one row's whole history.
 */
const VERBATIM_CHUNK_CHARS = 8_388_608;

/** Reads one verbatim column in bounded character chunks (`startChar` is 1-based, code points). */
type VerbatimChunkReader = (startChar: number, chars: number) => string;

/**
 * The fence `fenced()` would pick for text read as bounded chunks — computed
 * WITHOUT materializing the full text. Backtick runs straddling a chunk
 * boundary are stitched by carrying the open run count between chunks.
 */
function fenceLengthOf(chunks: readonly string[]): number {
  let longest = 0;
  let carry = 0; // open backtick run at the current chunk boundary
  for (const chunk of chunks) {
    const runs = [...chunk.matchAll(/`+/g)];
    if (runs.length === 0) {
      longest = Math.max(longest, carry);
      carry = 0;
      continue;
    }
    for (const match of runs) {
      const length = (match.index === 0 ? carry : 0) + match[0].length;
      carry = 0;
      if (match.index! + match[0].length === chunk.length) {
        carry = length; // may continue into the next chunk
      } else {
        longest = Math.max(longest, length);
      }
    }
  }
  return Math.max(3, Math.max(longest, carry) + 1);
}

/**
 * Yields a fenced verbatim block as bounded fragments: opening fence, text
 * chunks, closing fence. Byte-identical to `fenced()` over the whole text,
 * but no single string ever exceeds one chunk and the full text never
 * materializes as one value. Chunks are read exactly once (one pass), so
 * peak memory is one row's chunk list, not the whole call history.
 */
function* fencedFragments(reader: VerbatimChunkReader, chars: number): Generator<string> {
  const chunks: string[] = [];
  for (let start = 1; start <= chars; start += VERBATIM_CHUNK_CHARS) {
    chunks.push(reader(start, VERBATIM_CHUNK_CHARS));
  }
  const fence = "`".repeat(fenceLengthOf(chunks));
  yield `${fence}\n`;
  for (const chunk of chunks) yield chunk;
  yield `\n${fence}`;
}

/** Kinds a loop stage's quality loop must have produced. */
function isLoopStage(node: StageNode | undefined): boolean {
  return node?.kind === "stage";
}

/** Human stage title from the graph, or undefined for artifact-only stages. */
function stageTitleOf(stageId: string): string | undefined {
  return STAGE_NODES.find((node) => node.id === stageId)?.title;
}

/** One dossier entry: the winning improved draft, every translation, and all pass outputs. */
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
  /**
   * Pass-stage outputs beyond translations, in run order — audit pair
   * reports and resolutions, localisation QA verdicts, cultural
   * adaptations, re-run selections/outcomes, rechecks, syntheses, persona
   * rewrites, output formats. Rendered verbatim and labeled; never dropped.
   */
  passArtifacts: StageArtifactRow[];
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
    const translations = rows
      .flatMap((row) => {
        const match = /^translation:([a-z-]+)$/.exec(row.kind);
        return match ? [{ code: match[1] ?? "", row }] : [];
      })
      .sort((a, b) => a.code.localeCompare(b.code));
    return {
      stageId,
      title: node?.title ?? stageId,
      isLoop: isLoopStage(node),
      status: store.getStageStatus(runId, stageId),
      improved: rows.find((row) => row.kind === WINNING_ARTIFACT_KIND),
      translations,
      passArtifacts: isLoopStage(node)
        ? []
        : rows.filter((row) => !/^translation:/.test(row.kind)),
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
 * dossier.md — contents list plus every deliverable grouped by stage and
 * language (spec global actions): the improved draft and translations for
 * loop stages, every pass-stage output verbatim (audit reports and
 * resolutions, localisation QA verdicts, cultural adaptations, re-run
 * selection/outcomes, rechecks, syntheses, persona rewrites, output
 * formats). A stage whose expected deliverable is absent is marked MISSING,
 * never dropped or fabricated (spec failure mode: missing or escaped
 * artifacts). The caller has already resolved the run row.
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
    const hasBody = stage.improved !== undefined || stage.translations.length > 0 || stage.passArtifacts.length > 0;
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
    // Pass-stage outputs (audits, resolutions, QA verdicts, adaptations,
    // re-runs, rechecks, syntheses, persona rewrites, formats) render in run
    // order under their kind's human label — verbatim, never fabricated.
    for (const artifact of stage.passArtifacts) {
      lines.push(`### ${artifactLabel(artifact.kind, stageTitleOf)} (\`${artifact.kind}\`)`, "", fenced(artifact.text), "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * run-log.md — header block. Pure. The call count arrives from the store's
 * cheap COUNT aggregate so the streaming path never reads rows just to number
 * the log.
 */
export function buildRunLogHeader(run: RunRow, callCount: number): string {
  return [
    "# Run log",
    "",
    `Run: \`${run.id}\``,
    `Idea: ${run.idea}`,
    configLine(run),
    "",
    `${callCount} call${callCount === 1 ? "" : "s"}, verbatim, in run order.`,
    "",
  ].join("\n");
}

/**
 * run-log.md — one verbatim call section. Pure: every prompt and response,
 * verbatim, with per-call metadata (stage, role, loop, attempt, tokens, ms).
 * Failed attempts quote the error verbatim; usage arrives only with the
 * successful result (T2 contract).
 */
export function buildRunLogCallSection(call: CallRow, index: number): string {
  const lines = [
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
  ];
  if (call.error !== null && call.error !== undefined && call.error !== "") {
    lines.push(`### Error`, "", fenced(call.error), "");
  }
  if (call.response !== null && call.response !== undefined && call.response !== "") {
    lines.push(`### Response`, "", fenced(call.response), "");
  } else if (call.error === null || call.error === "") {
    lines.push(`### Response`, "", "> MISSING: no response and no error recorded for this attempt.", "");
  }
  return lines.join("\n");
}

/**
 * run-log.md as a lazy fragment stream: the header, then each call's section
 * as bounded fragments whose concatenation reproduces the document byte for
 * byte. Late-pipeline prompts thread every upstream artifact and can reach
 * megabytes each — fragments read the verbatim columns through SQLite
 * `substr` chunks so no string ever exceeds one chunk, keeping multi-gigabyte
 * call histories out of memory (see store.iterateRunCallVerbatimMeta).
 *
 * Each fragment ends with exactly the newlines the full document needs —
 * including the one-line separator between sections — so the stream is also
 * self-consistent: concatenated fragments are the download, and the same
 * fragments build the materialized document.
 */
export function* runLogSections(store: RunStore, run: RunRow): Generator<string> {
  yield `${buildRunLogHeader(run, store.countRunCalls(run.id))}\n`;
  let index = 0;
  for (const meta of store.iterateRunCallVerbatimMeta(run.id)) {
    yield* runLogCallFragments(store, meta, index);
    yield "\n";
    index += 1;
  }
}

/**
 * One call's section as bounded fragments. Byte-identical to
 * `${buildRunLogCallSection(...)}\n` (the trailing newline is the section
 * separator); the prompt and response bodies stream through chunked reads
 * and never materialize whole.
 */
function* runLogCallFragments(
  store: RunStore,
  meta: CallVerbatimMetaRow,
  index: number,
): Generator<string> {
  yield [
    `---`,
    ``,
    `## Call ${index + 1} — \`${meta.stage_id}\` / \`${meta.role}\``,
    ``,
    `- loop: ${meta.loop} · attempt: ${meta.attempt}`,
    `- tokens: ${meta.input_tokens ?? "—"} in / ${meta.output_tokens ?? "—"} out · ${meta.ms ?? "—"} ms`,
    ``,
    `### Prompt`,
    ``,
    ``,
  ].join("\n");
  yield* fencedFragments((start, chars) => store.getCallPromptChunk(meta.id, start, chars), meta.promptChars);

  const errorText = meta.error;
  const hasError = errorText !== null && errorText !== "";
  const hasResponse = meta.hasResponse === 1 && meta.responseChars > 0;
  if (hasError && errorText) {
    yield `\n\n### Error\n\n${fenced(errorText)}`;
  }
  if (hasResponse) {
    yield "\n\n### Response\n\n";
    yield* fencedFragments(
      (start, chars) => store.getCallResponseChunk(meta.id, start, chars),
      meta.responseChars,
    );
  } else if (!hasError) {
    yield "\n\n### Response\n\n> MISSING: no response and no error recorded for this attempt.";
  }
  // The section's trailing empty line — every buildRunLogCallSection array
  // ends with "" — then runLogSections adds the one-line section separator.
  yield "\n";
}

/**
 * run-log.md — the full document as one string. Materializes every call;
 * test-seam convenience for small seeded stores. Production downloads stream
 * runLogSections instead (see handleExportRunLog).
 */
export function buildRunLogMarkdown(store: RunStore, run: RunRow): string {
  return `${[...runLogSections(store, run)].join("").trimEnd()}\n`;
}
