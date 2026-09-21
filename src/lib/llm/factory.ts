/**
 * Provider selection by configuration (spec: "AnthropicAdapter implements
 * the same interface ... selected by AI_PROVIDER=anthropic"). Reads env at
 * call time so tests can swap providers by mutating the environment.
 *
 *   AI_PROVIDER   'openai' (default) | 'anthropic' | 'mock'
 *   AI_BASE_URL   transport base URL
 *   AI_API_KEY    provider credential (not required for 'mock')
 *   AI_MODEL      model id
 */
import { AnthropicAdapter } from "./anthropic";
import { OpenAICompatibleAdapter } from "./openai";
import { createMockProvider } from "./mock-provider";
import type { LLMAdapter } from "./types";

export type ProviderKind = "openai" | "anthropic" | "mock";

export interface LLMEnvConfig {
  AI_PROVIDER?: string;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  // Index signature lets process.env satisfy this shape without casts.
  [key: string]: string | undefined;
}

/** Resolve the configured provider kind; unknown values fail loudly. */
export function resolveProviderKind(env: LLMEnvConfig = process.env): ProviderKind {
  const raw = env.AI_PROVIDER?.trim().toLowerCase();
  if (raw === undefined || raw === "" || raw === "openai") return "openai";
  if (raw === "anthropic") return "anthropic";
  if (raw === "mock") return "mock";
  throw new Error(`Unsupported AI_PROVIDER "${env.AI_PROVIDER}" — expected "openai", "anthropic", or "mock"`);
}

/** Build the configured transport. Throws when AI_API_KEY is missing (not required for 'mock'). */
export function createAdapterFromEnv(
  env: LLMEnvConfig = process.env,
  fetchImpl: typeof fetch = fetch,
): LLMAdapter {
  const kind = resolveProviderKind(env);
  // The mock provider needs no key, base URL, or network — demo/offline runs.
  if (kind === "mock") return createMockProvider();
  if (kind === "anthropic") {
    return new AnthropicAdapter({
      baseUrl: env.AI_BASE_URL,
      apiKey: env.AI_API_KEY,
      model: env.AI_MODEL,
      fetchImpl,
    });
  }
  return new OpenAICompatibleAdapter({
    baseUrl: env.AI_BASE_URL,
    apiKey: env.AI_API_KEY,
    model: env.AI_MODEL,
    fetchImpl,
  });
}
