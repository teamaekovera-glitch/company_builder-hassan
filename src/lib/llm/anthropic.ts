/**
 * Anthropic transport (selected by AI_PROVIDER=anthropic).
 *
 * Same LLMAdapter contract against POST {baseUrl}/v1/messages. `max_tokens`
 * is mandatory in Anthropic's API and set to the model maximum (rule 1).
 * Single raw call — retry/backoff/validation live in `retry.ts`.
 */
import { ProviderError, type CompletionRequest, type CompletionResult, type LLMAdapter } from "./types";
import { readPositiveInt } from "./openai";

export interface AnthropicAdapterOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** Maximum output tokens sent as `max_tokens` on every request (rule 1). */
  maxOutputTokens?: number;
  /** Anthropic API version header. */
  version?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface AnthropicMessagesResponse {
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicAdapter implements LLMAdapter {
  readonly model: string;
  readonly maxOutputTokens: number;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly version: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicAdapterOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.AI_BASE_URL ?? "https://api.anthropic.com";
    this.apiKey = options.apiKey ?? process.env.AI_API_KEY ?? "";
    this.model = options.model ?? process.env.AI_MODEL ?? "claude-sonnet-4-20250514";
    this.maxOutputTokens =
      options.maxOutputTokens ?? readPositiveInt(process.env.AI_MAX_OUTPUT_TOKENS, 32768);
    this.version =
      options.version ?? process.env.AI_ANTHROPIC_VERSION ?? DEFAULT_ANTHROPIC_VERSION;
    this.timeoutMs = options.timeoutMs ?? readPositiveInt(process.env.AI_TIMEOUT_MS, 120_000);
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (!this.apiKey) throw new Error("AI_API_KEY is not set");
  }

  async complete({ system, user }: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": this.version,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxOutputTokens, // rule 1: always the model maximum
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) throw new ProviderError(res.status, await res.text());

    const json = (await res.json()) as AnthropicMessagesResponse;
    const text = (json.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("");
    return {
      text,
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
      model: json.model ?? this.model,
      ms: Date.now() - started,
    };
  }
}
