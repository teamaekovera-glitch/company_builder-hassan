/**
 * Public surface of the stage executor (T6): the run configuration, the
 * 7-call quality loop, the wave-scheduled pipeline runner, and the typed
 * failure boundary. The T7 orchestration layer builds on exactly these.
 */

export { DEFAULT_RUN_CONFIG, DEFAULT_SCORE_THRESHOLD, type RunConfig } from "./config";
export { ScoreParseError, StageFailedError, describeError } from "./errors";
export {
  RECONCILED_SCORE_MARKER,
  buildSystemPrompt,
  buildUserPrompt,
  composePersistedPrompt,
  extractReconciledScore,
  formatArtifacts,
  roleFromSystem,
} from "./prompt";
export { runPipeline, type PipelineRunOptions, type PipelineRunResult } from "./runner";
export {
  WINNING_ARTIFACT_KIND,
  runLoopStage,
  runPassNode,
  type StageRunOptions,
  type StageRunResult,
} from "./stage";
