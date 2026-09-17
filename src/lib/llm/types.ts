/**
 * Provider-agnostic LLM adapter contract (spec: "LLM adapter — provider-agnostic, max_tokens maxed").
 *
 * Every transport implements this interface with a SINGLE raw call: no retry,
 * no validation. Policy (3 attempts, exponential backoff, response validation)
 * lives in `retry.ts` so it is enforced in exactly one place.
 */

/** A single LLM call's verbatim prompts — persisted with the response. */
export interface CompletionRequest {
  system: string;
  user: string;
}

/** A successful raw completion with verbatim text and usage tokens. */
export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  ms: number;
}

/** The adapter contract every transport (and the test mock) implements. */
export interface LLMAdapter {
  readonly model: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

/**
 * Non-2xx provider response. Status >= 500 is retryable; 4xx fails the call
 * immediately — re-sending the same request cannot fix bad credentials or a
 * malformed body.
 */
export class ProviderError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Provider error ${status}: ${body}`);
    this.name = "ProviderError";
    this.status = status;
    this.body = body;
  }
}

/**
 * True when the transport error is transient and worth another attempt:
 * provider 5xx, timeouts (AbortSignal), and network-level failures.
 * 4xx and unknown error shapes are NOT retried.
 */
export function isRetryableTransportError(err: unknown): boolean {
  if (err instanceof ProviderError) return err.status >= 500;
  if (err instanceof Error) {
    // TimeoutError: AbortSignal.timeout abort; AbortError: caller abort;
    // TypeError: fetch-level network failure in Node's undici.
    return (
      err.name === "TimeoutError" || err.name === "AbortError" || err instanceof TypeError
    );
  }
  return false;
}
