/**
 * SQLite persistence schema — verbatim translation of the spec's persistence
 * block (runs, stage_status, calls, stage_artifacts) with three additive
 * conveniences that do not change shape: IF NOT EXISTS guards for idempotent
 * boot, an `error` column on calls (the spec's failure semantics require
 * failed attempts to be logged verbatim with their provider error), and one
 * index for per-stage call reads.
 */

/** Run lifecycle: queued → running → completed | failed | interrupted. */
export type RunStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

/** Stage lifecycle: pending → running → done | failed | blocked. */
export type StageStatus = "pending" | "running" | "done" | "failed" | "blocked";

/** Artifact kinds: genA | genB | genC | merged | critique:vc | improved | scores | translation:es | … */
export type ArtifactKind = string;

/** Call roles: generatorA | critic:vc | judge:harsh | translator:es | … */
export type CallRole = string;

/** ISO language codes; "en" is the default and the dossier source language. */
export type Language = string;

/** Row shape of the runs table. */
export interface RunRow {
  id: string;
  idea: string;
  config_json: string;
  status: RunStatus;
  created_at: number;
}

/** Row shape of the stage_status table (denormalized per-stage progress counters). */
export interface StageStatusRow {
  run_id: string;
  stage_id: string;
  status: StageStatus;
  loop: number;
  score: number | null;
  calls: number;
  tokens: number;
}

/** Row shape of the calls table — one row per LLM call attempt, verbatim. */
export interface CallRow {
  id: string;
  run_id: string;
  stage_id: string;
  role: CallRole;
  loop: number;
  attempt: number;
  prompt: string;
  response: string | null;
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  ms: number | null;
  created_at: number;
}

/**
 * The calls table narrowed to event-replay fields. Deliberately excludes the
 * verbatim prompt/response TEXT — megabyte-scale on context-threaded runs —
 * because SSE call events never carry it; the calls table itself remains the
 * verbatim record. `ok` mirrors the store's broadcast mapping (a row with a
 * response is a successful attempt).
 */
export interface CallMetaRow {
  id: string;
  run_id: string;
  stage_id: string;
  role: CallRole;
  loop: number;
  attempt: number;
  ok: 0 | 1;
  input_tokens: number | null;
  output_tokens: number | null;
  ms: number | null;
  error: string | null;
}

/**
 * Per-call metadata for the verbatim run-log stream — everything the streamed
 * call sections render EXCEPT the prompt/response text, plus the text lengths
 * (SQLite `length()` counts Unicode code points) that bound the chunked reads.
 * Never materializes a multi-MB TEXT column.
 */
export interface CallVerbatimMetaRow {
  id: string;
  run_id: string;
  stage_id: string;
  role: CallRole;
  loop: number;
  attempt: number;
  input_tokens: number | null;
  output_tokens: number | null;
  ms: number | null;
  error: string | null;
  promptChars: number;
  hasResponse: 0 | 1;
  responseChars: number;
}

/** Row shape of the stage_artifacts table — latest artifact per (run, stage, kind, language). */
export interface StageArtifactRow {
  run_id: string;
  stage_id: string;
  kind: ArtifactKind;
  language: Language;
  text: string;
  score: number | null;
}

/** Run-level header totals, reconciled exactly against the calls table. */
export interface RunTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  ms: number;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  idea TEXT NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stage_status (
  run_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  status TEXT NOT NULL,
  loop INTEGER DEFAULT 0,
  score REAL,
  calls INTEGER DEFAULT 0,
  tokens INTEGER DEFAULT 0,
  PRIMARY KEY (run_id, stage_id)
);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  stage_id TEXT NOT NULL,
  role TEXT NOT NULL,
  loop INTEGER NOT NULL,
  attempt INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT,
  error TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calls_run_stage ON calls (run_id, stage_id);

CREATE TABLE IF NOT EXISTS stage_artifacts (
  run_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  text TEXT NOT NULL,
  score REAL,
  PRIMARY KEY (run_id, stage_id, kind, language)
);
`;
