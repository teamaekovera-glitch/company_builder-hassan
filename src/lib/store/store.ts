/**
 * SQLite run store — the pipeline's only persistence layer, on better-sqlite3.
 *
 * Responsibilities per the spec: hold runs, per-stage status (loop/score/
 * calls/tokens), every LLM call verbatim (prompt, response, role, loop,
 * attempt, usage, duration, error), and stage artifacts keyed by kind +
 * language. Also owns the queries the header and context builder need:
 * exact run totals (spec verification row 8) and ordered artifact threading.
 *
 * Invariants:
 * - Every call attempt is inserted before anything is broadcast; recording a
 *   call and bumping its stage counters happen in one transaction, so the
 *   denormalized counters can never drift from the calls table.
 * - Failed attempts are rows too: response stays NULL, the provider error is
 *   stored verbatim in `error`, and they still consume an attempt (1..3).
 */

import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import {
  SCHEMA_SQL,
  type CallMetaRow,
  type CallRow,
  type RunRow,
  type RunStatus,
  type RunTotals,
  type StageArtifactRow,
  type StageStatus,
  type StageStatusRow,
} from "./schema";

/** Base62 alphabet for nanoid-style identifiers. */
const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Nanoid default length (21 base62 chars ≈ 125 bits of entropy). */
const ID_LENGTH = 21;

/** Generates a nanoid-style identifier (spec: runs.id / calls.id are nanoid). */
export function newId(): string {
  const bytes = randomBytes(ID_LENGTH);
  let id = "";
  for (const byte of bytes) {
    id += ID_ALPHABET[byte % ID_ALPHABET.length];
  }
  return id;
}

/** Inputs for creating a run. */
export interface CreateRunInput {
  id: string;
  idea: string;
  config: Record<string, unknown>;
  status?: RunStatus;
  createdAt?: number;
}

/** Inputs for recording one LLM call attempt, verbatim. */
export interface RecordCallInput {
  id: string;
  runId: string;
  stageId: string;
  role: string;
  loop: number;
  attempt: number;
  prompt: string;
  response?: string | null;
  error?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  ms?: number | null;
  createdAt?: number;
}

/** Partial stage-progress patch; omitted fields keep their current value. */
export interface StageProgressPatch {
  status?: StageStatus;
  loop?: number;
  score?: number | null;
}

/** Inputs for writing a stage artifact (latest wins per run+stage+kind+language). */
export interface PutArtifactInput {
  runId: string;
  stageId: string;
  kind: string;
  language?: string;
  text: string;
  score?: number | null;
}

export class RunStore {
  private readonly db: Database.Database;
  private readonly now: () => number;

  private readonly insertRun: Database.Statement<[RunRow], unknown>;
  private readonly selectRun: Database.Statement<[string], RunRow>;
  private readonly updateRunStatus: Database.Statement<[RunStatus, string], unknown>;
  private readonly selectRuns: Database.Statement<[], RunRow>;

  private readonly upsertStageCounters: Database.Statement<
    [string, string, number, number],
    unknown
  >;
  private readonly patchStage: Database.Statement<
    [StageStatus | null, number | null, number | null, string, string],
    unknown
  >;
  private readonly selectStage: Database.Statement<[string, string], StageStatusRow>;
  private readonly selectStages: Database.Statement<[string], StageStatusRow>;

  private readonly insertCall: Database.Statement<[CallRow], unknown>;
  private readonly selectStageCalls: Database.Statement<[string, string], CallRow>;
  private readonly selectRunCalls: Database.Statement<[string], CallRow>;

  private readonly selectRunCallMeta: Database.Statement<[string], CallMetaRow>;

  private readonly upsertArtifact: Database.Statement<[StageArtifactRow], unknown>;
  private readonly selectArtifact: Database.Statement<
    [string, string, string, string],
    StageArtifactRow
  >;
  private readonly selectStageArtifacts: Database.Statement<[string, string], StageArtifactRow>;
  private readonly selectRunArtifacts: Database.Statement<[string], StageArtifactRow>;

  private readonly selectTotals: Database.Statement<[string], RunTotals>;

  private readonly recordCallTx: (input: RecordCallInput) => void;

  constructor(path: string, options?: { now?: () => number }) {
    this.now = options?.now ?? Date.now;
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);

    this.insertRun = this.db.prepare<[RunRow], unknown>(
      "INSERT INTO runs (id, idea, config_json, status, created_at) VALUES (@id, @idea, @config_json, @status, @created_at)",
    );
    this.selectRun = this.db.prepare<[string], RunRow>("SELECT * FROM runs WHERE id = ?");
    this.updateRunStatus = this.db.prepare<[RunStatus, string], unknown>(
      "UPDATE runs SET status = ? WHERE id = ?",
    );
    this.selectRuns = this.db.prepare<[], RunRow>("SELECT * FROM runs ORDER BY created_at, id");

    this.upsertStageCounters = this.db.prepare<[string, string, number, number], unknown>(`
      INSERT INTO stage_status (run_id, stage_id, status, loop, score, calls, tokens)
      VALUES (?, ?, 'running', 0, NULL, ?, ?)
      ON CONFLICT (run_id, stage_id) DO UPDATE SET
        calls = calls + excluded.calls,
        tokens = tokens + excluded.tokens
    `);
    this.patchStage = this.db.prepare<
      [StageStatus | null, number | null, number | null, string, string],
      unknown
    >(`
      UPDATE stage_status SET
        status = COALESCE(?, status),
        loop = COALESCE(?, loop),
        score = COALESCE(?, score)
      WHERE run_id = ? AND stage_id = ?
    `);
    this.selectStage = this.db.prepare<[string, string], StageStatusRow>(
      "SELECT * FROM stage_status WHERE run_id = ? AND stage_id = ?",
    );
    this.selectStages = this.db.prepare<[string], StageStatusRow>(
      "SELECT * FROM stage_status WHERE run_id = ? ORDER BY stage_id",
    );

    this.insertCall = this.db.prepare<[CallRow], unknown>(`
      INSERT INTO calls (id, run_id, stage_id, role, loop, attempt, prompt, response, error,
                         input_tokens, output_tokens, ms, created_at)
      VALUES (@id, @run_id, @stage_id, @role, @loop, @attempt, @prompt, @response, @error,
              @input_tokens, @output_tokens, @ms, @created_at)
    `);
    this.selectStageCalls = this.db.prepare<[string, string], CallRow>(
      "SELECT * FROM calls WHERE run_id = ? AND stage_id = ? ORDER BY rowid",
    );
    this.selectRunCalls = this.db.prepare<[string], CallRow>(
      "SELECT * FROM calls WHERE run_id = ? ORDER BY rowid",
    );
    this.selectRunCallMeta = this.db.prepare<[string], CallMetaRow>(`
      SELECT id, run_id, stage_id, role, loop, attempt,
             response IS NOT NULL AS ok, input_tokens, output_tokens, ms, error
      FROM calls WHERE run_id = ? ORDER BY rowid
    `);

    this.upsertArtifact = this.db.prepare<[StageArtifactRow], unknown>(`
      INSERT INTO stage_artifacts (run_id, stage_id, kind, language, text, score)
      VALUES (@run_id, @stage_id, @kind, @language, @text, @score)
      ON CONFLICT (run_id, stage_id, kind, language) DO UPDATE SET
        text = excluded.text,
        score = excluded.score
    `);
    this.selectArtifact = this.db.prepare<[string, string, string, string], StageArtifactRow>(
      "SELECT * FROM stage_artifacts WHERE run_id = ? AND stage_id = ? AND kind = ? AND language = ?",
    );
    this.selectStageArtifacts = this.db.prepare<[string, string], StageArtifactRow>(
      "SELECT * FROM stage_artifacts WHERE run_id = ? AND stage_id = ? ORDER BY rowid",
    );
    // Insertion order is the threading order: the context builder replays
    // prior artifacts in exactly the order the pipeline produced them.
    this.selectRunArtifacts = this.db.prepare<[string], StageArtifactRow>(
      "SELECT * FROM stage_artifacts WHERE run_id = ? ORDER BY rowid",
    );

    this.selectTotals = this.db.prepare<[string], RunTotals>(`
      SELECT COUNT(*) AS calls,
             COALESCE(SUM(input_tokens), 0) AS inputTokens,
             COALESCE(SUM(output_tokens), 0) AS outputTokens,
             COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) AS tokens,
             COALESCE(SUM(ms), 0) AS ms
      FROM calls WHERE run_id = ?
    `);

    // Insert the call and bump its stage counters atomically — the stage card
    // and the header reconcile by construction, not by discipline.
    this.recordCallTx = this.db.transaction((input: RecordCallInput) => {
      const row = this.toCallRow(input);
      this.insertCall.run(row);
      const tokens = (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
      this.upsertStageCounters.run(row.run_id, row.stage_id, 1, tokens);
    });
  }

  /** Creates a run row; `config` is stored as JSON (depth, languages, scoreThreshold, strategyAngle). */
  createRun(input: CreateRunInput): RunRow {
    const row: RunRow = {
      id: input.id,
      idea: input.idea,
      config_json: JSON.stringify(input.config),
      status: input.status ?? "queued",
      created_at: input.createdAt ?? this.now(),
    };
    this.insertRun.run(row);
    return row;
  }

  getRun(id: string): RunRow | undefined {
    return this.selectRun.get(id);
  }

  setRunStatus(id: string, status: RunStatus): void {
    const result = this.updateRunStatus.run(status, id);
    // changes can be number or bigint depending on safeIntegers mode.
    if (Number(result.changes) === 0) {
      throw new Error(`setRunStatus: unknown run ${id}`);
    }
  }

  listRuns(): RunRow[] {
    return this.selectRuns.all();
  }

  /**
   * Records one call attempt verbatim and advances its stage counters in the
   * same transaction. Failed attempts are rows: `response` NULL, `error`
   * verbatim, attempt counted per the retry rule (1..3).
   */
  recordCall(input: RecordCallInput): void {
    this.recordCallTx(input);
  }

  /** All call rows for a stage, in insertion (chronological) order. */
  getStageCalls(runId: string, stageId: string): CallRow[] {
    return this.selectStageCalls.all(runId, stageId);
  }

  countStageCalls(runId: string, stageId: string): number {
    return this.selectStageCalls.all(runId, stageId).length;
  }

  /** All call rows for a run, in insertion (chronological) order. */
  listRunCalls(runId: string): CallRow[] {
    return this.selectRunCalls.all(runId);
  }

  /**
   * Event-replay rows for a run as a lazy cursor, in insertion order — the
   * metadata columns only, no verbatim TEXT, so replay hydration stays
   * bounded in memory no matter how large the calls table has grown.
   */
  iterateRunCalls(runId: string): IterableIterator<CallMetaRow> {
    return this.selectRunCallMeta.iterate(runId);
  }

  /** Creates the stage row if absent, then applies a partial progress patch. */
  updateStageProgress(runId: string, stageId: string, patch: StageProgressPatch): boolean {
    this.upsertStageCounters.run(runId, stageId, 0, 0);
    const result = this.patchStage.run(
      patch.status ?? null,
      patch.loop ?? null,
      patch.score ?? null,
      runId,
      stageId,
    );
    return Number(result.changes) > 0;
  }

  getStageStatus(runId: string, stageId: string): StageStatusRow | undefined {
    return this.selectStage.get(runId, stageId);
  }

  /** Stage status for every stage of a run, stage_id-ordered for the board. */
  listStageStatus(runId: string): StageStatusRow[] {
    return this.selectStages.all(runId);
  }

  /** Writes a stage artifact; same (run, stage, kind, language) overwrites, latest wins. */
  putArtifact(input: PutArtifactInput): StageArtifactRow {
    const row: StageArtifactRow = {
      run_id: input.runId,
      stage_id: input.stageId,
      kind: input.kind,
      language: input.language ?? "en",
      text: input.text,
      score: input.score ?? null,
    };
    this.upsertArtifact.run(row);
    return row;
  }

  getArtifact(runId: string, stageId: string, kind: string, language = "en"): StageArtifactRow | undefined {
    return this.selectArtifact.get(runId, stageId, kind, language);
  }

  listStageArtifacts(runId: string, stageId: string): StageArtifactRow[] {
    return this.selectStageArtifacts.all(runId, stageId);
  }

  /** Context threading: every artifact of a run in production order. */
  listRunArtifacts(runId: string): StageArtifactRow[] {
    return this.selectRunArtifacts.all(runId);
  }

  /**
   * Header totals reconciled exactly against the calls table (spec
   * verification row 8): calls count, summed token usage, summed duration.
   */
  getRunTotals(runId: string): RunTotals {
    return this.selectTotals.get(runId) as RunTotals;
  }

  /** Closes the underlying database handle (WAL checkpoints on close). */
  close(): void {
    this.db.close();
  }

  private toCallRow(input: RecordCallInput): CallRow {
    return {
      id: input.id,
      run_id: input.runId,
      stage_id: input.stageId,
      role: input.role,
      loop: input.loop,
      attempt: input.attempt,
      prompt: input.prompt,
      response: input.response ?? null,
      error: input.error ?? null,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      ms: input.ms ?? null,
      created_at: input.createdAt ?? this.now(),
    };
  }
}
