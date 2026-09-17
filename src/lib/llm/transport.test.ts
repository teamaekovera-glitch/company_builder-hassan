import { describe, expect, it, vi } from "vitest";
import { AnthropicAdapter } from "./anthropic";
import { OpenAICompatibleAdapter } from "./openai";
import { createAdapterFromEnv, resolveProviderKind } from "./factory";
import { MockAdapter, mockResult } from "./mock-adapter";
import type { CompletionRequest } from "./types";

const REQ: CompletionRequest = {
  system: "You are a market analyst.",
  user: "Analyze the idea.",
};

/** Capture the outgoing request for assertions. Body is the RAW payload string. */
function capturingFetch(status = 200, body = "") {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

function openAIPayload(text = "ok"): unknown {
  return {
    model: "gpt-4.1",
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 11, completion_tokens: 22 },
  };
}

describe("OpenAICompatibleAdapter request shape", () => {
  it("posts to {baseUrl}/chat/completions with bearer auth and max_tokens at the model maximum", async () => {
    const { calls, fetchImpl } = capturingFetch(200, JSON.stringify(openAIPayload()));
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: "https://fake.test/v1",
      apiKey: "sk-test",
      model: "gpt-4.1",
      maxOutputTokens: 32768,
      fetchImpl,
    });

    await adapter.complete(REQ);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://fake.test/v1/chat/completions");
    const headers = new Headers(call.init.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-test");
    expect(headers.get("content-type")).toBe("application/json");

    const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
    // Rule 1: every request sets max_tokens to the model maximum.
    expect(body.max_tokens).toBe(32768);
    expect(body.model).toBe("gpt-4.1");
    expect(body.messages).toEqual([
      { role: "system", content: "You are a market analyst." },
      { role: "user", content: "Analyze the idea." },
    ]);
  });

  it("propagates a configured maxOutputTokens and parses the response verbatim", async () => {
    const { calls, fetchImpl } = capturingFetch(200, JSON.stringify(openAIPayload("full dossier body")));
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: "https://fake.test/v1",
      apiKey: "sk-test",
      maxOutputTokens: 64000,
      fetchImpl,
    });

    const result = await adapter.complete(REQ);

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body.max_tokens).toBe(64000);
    expect(result.text).toBe("full dossier body");
    expect(result.inputTokens).toBe(11);
    expect(result.outputTokens).toBe(22);
    expect(result.model).toBe("gpt-4.1");
  });

  it("throws ProviderError with the verbatim body on non-2xx", async () => {
    const { fetchImpl } = capturingFetch(500, "upstream exploded");
    const adapter = new OpenAICompatibleAdapter({
      baseUrl: "https://fake.test/v1",
      apiKey: "sk-test",
      fetchImpl,
    });

    await expect(adapter.complete(REQ)).rejects.toMatchObject({
      name: "ProviderError",
      status: 500,
      body: "upstream exploded",
    });
  });

  it("refuses to build without an API key", () => {
    expect(
      () =>
        new OpenAICompatibleAdapter({ baseUrl: "https://fake.test/v1", apiKey: "", fetchImpl: fetch }),
    ).toThrow("AI_API_KEY is not set");
  });
});

describe("AnthropicAdapter request shape", () => {
  it("posts to {baseUrl}/v1/messages with x-api-key, system top-level, and max_tokens at the maximum", async () => {
    const { calls, fetchImpl } = capturingFetch(
      200,
      JSON.stringify({
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text: "dossier text" }],
        usage: { input_tokens: 33, output_tokens: 44 },
      }),
    );
    const adapter = new AnthropicAdapter({
      baseUrl: "https://fake.test",
      apiKey: "ak-test",
      model: "claude-sonnet-4-20250514",
      maxOutputTokens: 32768,
      fetchImpl,
    });

    const result = await adapter.complete(REQ);

    const call = calls[0]!;
    expect(call.url).toBe("https://fake.test/v1/messages");
    const headers = new Headers(call.init.headers);
    expect(headers.get("x-api-key")).toBe("ak-test");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");

    const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
    // Rule 1 holds on this transport too.
    expect(body.max_tokens).toBe(32768);
    expect(body.system).toBe("You are a market analyst.");
    expect(body.messages).toEqual([{ role: "user", content: "Analyze the idea." }]);

    expect(result.text).toBe("dossier text");
    expect(result.inputTokens).toBe(33);
    expect(result.outputTokens).toBe(44);
  });
});

describe("provider swap via config", () => {
  it("defaults to the OpenAI-compatible transport when AI_PROVIDER is unset", () => {
    expect(
      resolveProviderKind({ AI_API_KEY: "k", AI_MODEL: "gpt-4.1", AI_BASE_URL: "https://x/v1" }),
    ).toBe("openai");
    const adapter = createAdapterFromEnv({
      AI_API_KEY: "k",
      AI_MODEL: "gpt-4.1",
      AI_BASE_URL: "https://fake.test/v1",
    });
    expect(adapter).toBeInstanceOf(OpenAICompatibleAdapter);
    expect(adapter.model).toBe("gpt-4.1");
  });

  it("selects the Anthropic transport when AI_PROVIDER=anthropic", () => {
    expect(resolveProviderKind({ AI_PROVIDER: "anthropic", AI_API_KEY: "k" })).toBe("anthropic");
    const adapter = createAdapterFromEnv({
      AI_PROVIDER: "anthropic",
      AI_API_KEY: "k",
      AI_MODEL: "claude-sonnet-4-20250514",
    });
    expect(adapter).toBeInstanceOf(AnthropicAdapter);
  });

  it("resolves case-insensitively and rejects unknown providers", () => {
    expect(resolveProviderKind({ AI_PROVIDER: "  Anthropic " })).toBe("anthropic");
    expect(() => resolveProviderKind({ AI_PROVIDER: "bedrock" })).toThrow(/Unsupported AI_PROVIDER/);
  });

  it("swaps the transport end-to-end through the factory against a fake endpoint", async () => {
    const { calls, fetchImpl } = capturingFetch(
      200,
      JSON.stringify({
        content: [{ type: "text", text: "anthropic response" }],
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    );
    const adapter = createAdapterFromEnv(
      {
        AI_PROVIDER: "anthropic",
        AI_API_KEY: "k",
        AI_MODEL: "claude-sonnet-4-20250514",
        AI_BASE_URL: "https://fake.test",
      },
      fetchImpl,
    );

    const result = await adapter.complete(REQ);

    expect(calls[0]?.url).toBe("https://fake.test/v1/messages");
    expect(result.text).toBe("anthropic response");
  });
});

describe("MockAdapter", () => {
  it("replays scripted outcomes in order and records every request verbatim", async () => {
    const mock = new MockAdapter([mockResult("first"), new Error("boom"), mockResult("third")]);

    await expect(mock.complete(REQ)).resolves.toMatchObject({ text: "first" });
    await expect(mock.complete(REQ)).rejects.toThrow("boom");
    await expect(mock.complete(REQ)).resolves.toMatchObject({ text: "third" });

    expect(mock.callCount).toBe(3);
    expect(mock.requests[0]).toEqual(REQ);
  });

  it("repeats the last scripted outcome after exhaustion", async () => {
    const mock = new MockAdapter([mockResult("final")]);
    await expect(mock.complete(REQ)).resolves.toMatchObject({ text: "final" });
    await expect(mock.complete(REQ)).resolves.toMatchObject({ text: "final" });
    expect(mock.callCount).toBe(2);
  });

  it("rejects an empty script", () => {
    expect(() => new MockAdapter([])).toThrow("at least one scripted outcome");
  });
});