/**
 * Injectable mock transport for tests and offline CI.
 *
 * Implements the same LLMAdapter contract as the real transports and replays
 * a scripted sequence of outcomes (CompletionResult or Error) in order. The
 * LAST scripted outcome repeats once the script is exhausted, so callers that
 * exercise steady-state behavior don't need special-casing; the recorded call
 * count exposes over-calling in tests.
 */
import type { CompletionRequest, CompletionResult, LLMAdapter } from "./types";

/** A scripted outcome: a successful result or an error to throw. */
export type ScriptedOutcome = CompletionResult | Error;

export interface MockAdapterOptions {
  model?: string;
}

export class MockAdapter implements LLMAdapter {
  readonly model: string;
  readonly requests: CompletionRequest[] = [];

  private readonly script: ScriptedOutcome[];
  private cursor = 0;

  constructor(script: ScriptedOutcome[], options: MockAdapterOptions = {}) {
    if (script.length === 0) throw new Error("MockAdapter requires at least one scripted outcome");
    this.script = script;
    this.model = options.model ?? "mock-model";
  }

  /** Number of raw transport calls made so far (attempts, across retries). */
  get callCount(): number {
    return this.requests.length;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(req);
    const outcome = this.script[Math.min(this.cursor, this.script.length - 1)];
    this.cursor += 1;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

/** Build a scripted success with explicit usage tokens. */
export function mockResult(
  text: string,
  usage: { inputTokens?: number; outputTokens?: number; model?: string } = {},
): CompletionResult {
  return {
    text,
    inputTokens: usage.inputTokens ?? 100,
    outputTokens: usage.outputTokens ?? 1000,
    model: usage.model ?? "mock-model",
    ms: 1,
  };
}
