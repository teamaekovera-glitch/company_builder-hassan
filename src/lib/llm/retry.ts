/**
 * Call policy: exactly 3 attempts with exponential backoff, wrapping ANY
 * LLMAdapter (spec: "Failed calls retry up to 3 times with exponential
 * backoff"; "Provider 5xx, timeouts, and validation misses ... all consume
 * one of 3 attempts, each logged verbatim").
 *
 * Transport errors only retry when transient (5xx, timeout, network);
 * response-validation misses always retry. A non-transient transport error
 * (e.g. 401) fails immediately — re-sending cannot fix it.
 *
 * Result carries every attempt verbatim so persistence can log the full
 * attempt history (`calls.attempt` 1..3 per the schema).
 */
import type { CompletionRequest, CompletionResult } from "./types";
import { isRetryableTransportError } from "./types";
import { validationMissReason } from "./validation";

/** Hard attempt budget: attempt 1, 2, 3 — then terminal. */
export const MAX_ATTEMPTS = 3;

/** Base delay for exponential backoff: attempt n sleeps 2^(n-1) * base ms. */
export const RETRY_BASE_DELAY_MS = 500;

/** One recorded attempt — success or failure, quoted verbatim. */
export interface AttemptRecord {
  /** 1-based attempt number (1..3). */
  attempt: number;
  ok: boolean;
  /** Verbatim response text on success. */
  response?: string;
  /** Verbatim error string on failure (provider body, message, or validation reason). */
  error?: string;
  ms: number;
}

/** Typed terminal failure after the attempt budget is exhausted. */
export class RetryExhaustedError extends Error {
  readonly attempts: AttemptRecord[];

  constructor(attempts: AttemptRecord[]) {
    const last = attempts[attempts.length - 1];
    super(`LLM call failed after ${attempts.length} attempts: ${last?.error ?? "unknown error"}`);
    this.name = "RetryExhaustedError";
    this.attempts = attempts;
  }
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Test seam: replaces the sleep between attempts. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run one logical LLM call (with retries + validation) against a raw
 * transport. Resolves with the validated result plus the verbatim attempt
 * log; rejects with RetryExhaustedError when all attempts fail.
 */
export async function callWithRetry(
  transport: { complete(req: CompletionRequest): Promise<CompletionResult> },
  req: CompletionRequest,
  options: RetryOptions = {},
): Promise<{ result: CompletionResult; attempts: AttemptRecord[] }> {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? RETRY_BASE_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  const attempts: AttemptRecord[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    // Attempt outcome, resolved outside the try so the exhausted-retry throw
    // is never re-caught and each attempt is recorded exactly once.
    let outcome:
      | { ok: true; result: CompletionResult }
      | { ok: false; error: string; retryable: boolean };

    try {
      const result = await transport.complete(req);
      const miss = validationMissReason(result.text);
      // A validation miss consumes an attempt (rule 4) and is retryable.
      outcome = miss
        ? { ok: false, error: miss, retryable: true }
        : { ok: true, result };
    } catch (err) {
      outcome = {
        ok: false,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        retryable: isRetryableTransportError(err),
      };
    }

    if (outcome.ok) {
      attempts.push({
        attempt,
        ok: true,
        response: outcome.result.text,
        ms: Date.now() - started,
      });
      return { result: outcome.result, attempts };
    }

    attempts.push({ attempt, ok: false, error: outcome.error, ms: Date.now() - started });
    if (!outcome.retryable || attempt === maxAttempts) throw new RetryExhaustedError(attempts);
    await sleep(baseDelayMs * 2 ** (attempt - 1));
  }
  // Unreachable: every branch above either returns or throws.
  throw new RetryExhaustedError(attempts);
}
