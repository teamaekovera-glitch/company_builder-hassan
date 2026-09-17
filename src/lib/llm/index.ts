/**
 * Provider-agnostic LLM adapter.
 *
 * Public surface: the adapter contract, both transports, the env-based
 * factory, the injectable mock, response validation, and the retry policy.
 */
export { ProviderError, isRetryableTransportError } from "./types";
export type { CompletionRequest, CompletionResult, LLMAdapter } from "./types";
export { AnthropicAdapter } from "./anthropic";
export { OpenAICompatibleAdapter, readPositiveInt } from "./openai";
export { createAdapterFromEnv, resolveProviderKind } from "./factory";
export type { LLMEnvConfig, ProviderKind } from "./factory";
export { MockAdapter, mockResult } from "./mock-adapter";
export type { ScriptedOutcome } from "./mock-adapter";
export {
  MIN_RESPONSE_WORDS,
  validateResponse,
  validationMissReason,
  wordCount,
} from "./validation";
export {
  MAX_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  RetryExhaustedError,
  callWithRetry,
} from "./retry";
export type { AttemptRecord, RetryOptions } from "./retry";
