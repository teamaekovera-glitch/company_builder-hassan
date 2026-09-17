/**
 * OpenAI-compatible transport (default provider).
 *
 * Global call rule 1: every request sets `max_tokens` to the model's maximum
 * output. Single raw call — retry/backoff/validation live in `retry.ts`.
 * `fetchImpl` is injected so tests never touch the network.
 */
import { ProviderError, type CompletionRequest, type CompletionResult, type LLMAdapter } from "./types";

export interface OpenAIAdapterOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /** Maximum output tokens sent as `max_tokens` on every request (rule 1). */
  maxOutputTokens?: number;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface OpenAIChatResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Positive-integer env read; garbage falls back to the default. */
export function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export class OpenAICompatibleAdapter implements LLMAdapter {
  readonly model: string;
  readonly maxOutputTokens: number;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIAdapterOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.AI_BASE_URL ?? "https://api.openai.com/v1";
    this.apiKey = options.apiKey ?? process.env.AI_API_KEY ?? "";
    this.model = options.model ?? process.env.AI_MODEL ?? "gpt-4.1";
    this.maxOutputTokens =
      options.maxOutputTokens ?? readPositiveInt(process.env.AI_MAX_OUTPUT_TOKENS, 32768);
    this.timeoutMs = options.timeoutMs ?? readPositiveInt(process.env.AI_TIMEOUT_MS, 120_000);
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (!this.apiKey) throw new Error("AI_API_KEY is not set");
  }

  async complete({ system, user }: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxOutputTokens, // rule 1: always the model maximum
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) throw new ProviderError(res.status, await res.text());

    const json = (await res.json()) as OpenAIChatResponse;
    const text = json.choices?.[0]?.message?.content ?? "";
    return {
      text,
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      model: json.model ?? this.model,
      ms: Date.now() - started,
    };
  }
}
