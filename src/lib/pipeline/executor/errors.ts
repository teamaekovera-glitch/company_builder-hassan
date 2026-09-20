/**
 * Executor-level failure types — nothing fails silently (spec failure
 * semantics): a terminal call failure surfaces the verbatim provider error on
 * the stage, and a stage failure is a typed, catchable boundary for the
 * pipeline runner so sibling stages keep running.
 */

/** Human-readable message for any thrown value. */
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The reconciler's response carried no parseable `RECONCILED_SCORE` marker.
 * Treated as a failed call: the stage fails loudly rather than guessing a
 * score (a silent default would corrupt the score gate).
 */
export class ScoreParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoreParseError";
  }
}

/**
 * Terminal stage failure. Wraps the first failure of the stage (a
 * `RetryExhaustedError`, a `ScoreParseError`, or anything unexpected) and
 * quotes its message verbatim; the run runner catches this per stage, marks
 * the stage failed, blocks dependents, and keeps the rest of the run going.
 */
export class StageFailedError extends Error {
  readonly stageId: string;
  /** Critique rounds completed before the failure (0 when unknown). */
  rounds?: number;

  constructor(
    stageId: string,
    message: string,
    options: ErrorOptions & { rounds?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "StageFailedError";
    this.stageId = stageId;
    this.rounds = options.rounds;
  }
}
