import { describe, expect, it, vi } from "vitest";
import { MockAdapter, mockResult } from "./mock-adapter";
import { MAX_ATTEMPTS, RETRY_BASE_DELAY_MS, RetryExhaustedError, callWithRetry } from "./retry";
import { OpenAICompatibleAdapter } from "./openai";
import { MIN_RESPONSE_WORDS, type CompletionRequest } from "./index";

const REQ: CompletionRequest = { system: "You are a domain expert.", user: "Write the dossier." };

/** A response that passes validation: long enough + assumptions section. */
function validText(): string {
  return (
    `${"Deep due-diligence reasoning spelled out in full. ".repeat(600).trim()}\n\n` +
    "## Assumptions & open questions\n\n- Assumes a self-serve deployment."
  );
}

/** Over the minimum but missing the closing section. */
function missingSectionText(): string {
  return `${"Competitor teardown content in full. ".repeat(600).trim()}\n\n## Caveats`;
}

/** Has the closing section but under the word minimum. */
function shortBodyText(): string {
  return `${"Brief outline. ".repeat(50).trim()}\n\n## Assumptions & open questions`;
}

/** Fake OpenAI-compatible HTTP endpoint backed by queued Response objects. */
function fakeOpenAI(statusesAndPayloads: Array<{ status: number; body: string }>) {
  const queue = [...statusesAndPayloads];
  const fetchImpl = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("fakeOpenAI ran out of scripted responses");
    return new Response(next.body, { status: next.status });
  });
  const adapter = new OpenAICompatibleAdapter({
    baseUrl: "https://fake.test/v1",
    apiKey: "test-key",
    model: "gpt-4.1",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { adapter, fetchImpl };
}

function openAIPayload(text: string): string {
  return JSON.stringify({
    model: "gpt-4.1",
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 123, completion_tokens: 456 },
  });
}

/** Instant no-op sleep that records the requested delays. */
function instantSleep() {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

describe("callWithRetry — provider 5xx", () => {
  it("completes after two 500s: 3 attempts logged, verbatim response returned", async () => {
    const { adapter, fetchImpl } = fakeOpenAI([
      { status: 500, body: "upstream exploded" },
      { status: 500, body: "upstream exploded" },
      { status: 200, body: openAIPayload(validText()) },
    ]);
    const { sleep, delays } = instantSleep();

    const { result, attempts } = await callWithRetry(adapter, REQ, { sleep });

    expect(result.text).toBe(validText());
    expect(result.inputTokens).toBe(123);
    expect(result.outputTokens).toBe(456);
    expect(attempts).toHaveLength(3);
    expect(attempts.map((a) => a.ok)).toEqual([false, false, true]);
    expect(attempts[0]?.attempt).toBe(1);
    expect(attempts[2]?.attempt).toBe(3);
    expect(attempts[2]?.response).toBe(validText());
    // Both failures quote the verbatim provider body.
    expect(attempts[0]?.error).toContain("upstream exploded");
    expect(attempts[1]?.error).toContain("upstream exploded");
    // Exponential backoff between attempts: base, then 2x base.
    expect(delays).toEqual([RETRY_BASE_DELAY_MS, RETRY_BASE_DELAY_MS * 2]);
    // Exactly three raw HTTP calls.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("throws a typed terminal error after three straight failures", async () => {
    const { adapter, fetchImpl } = fakeOpenAI([
      { status: 500, body: "provider down" },
      { status: 502, body: "bad gateway" },
      { status: 503, body: "unavailable" },
    ]);
    const { sleep, delays } = instantSleep();

    const err = await callWithRetry(adapter, REQ, { sleep }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(RetryExhaustedError);
    const typed = err as RetryExhaustedError;
    expect(typed.attempts).toHaveLength(MAX_ATTEMPTS);
    expect(typed.message).toContain("3 attempts");
    // Terminal failure quotes the last provider error verbatim.
    expect(typed.message).toContain("unavailable");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([RETRY_BASE_DELAY_MS, RETRY_BASE_DELAY_MS * 2]);
  });

  it("does not retry a 4xx — the request, not the provider, is broken", async () => {
    const { adapter, fetchImpl } = fakeOpenAI([{ status: 401, body: "bad key" }]);
    const { sleep } = instantSleep();

    const err = await callWithRetry(adapter, REQ, { sleep }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(RetryExhaustedError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a timeout error, then succeeds", async () => {
    const { adapter, fetchImpl } = fakeOpenAI([
      { status: 200, body: openAIPayload(validText()) },
    ]);
    // First call aborts like AbortSignal.timeout, second succeeds.
    fetchImpl.mockImplementationOnce(async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      });
    });
    const { sleep } = instantSleep();

    const { result, attempts } = await callWithRetry(adapter, REQ, { sleep });

    expect(result.text).toBe(validText());
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.error).toContain("TimeoutError");
  });
});

describe("callWithRetry — validation misses", () => {
  it("retries a missing assumptions section, then a short body, then completes", async () => {
    const mock = new MockAdapter([
      mockResult(missingSectionText()),
      mockResult(shortBodyText()),
      mockResult(validText()),
    ]);
    const { sleep } = instantSleep();

    const { result, attempts } = await callWithRetry(mock, REQ, { sleep });

    expect(result.text).toBe(validText());
    expect(attempts).toHaveLength(3);
    expect(attempts[0]?.error).toContain("Assumptions & open questions");
    expect(attempts[1]?.error).toContain(`under ${MIN_RESPONSE_WORDS} words`);
    expect(attempts[2]?.ok).toBe(true);
    // Validation misses consumed real attempts — 3 transport calls total.
    expect(mock.callCount).toBe(3);
  });

  it("fails terminally when every response misses validation", async () => {
    const mock = new MockAdapter([
      mockResult(shortBodyText()),
      mockResult(shortBodyText()),
      mockResult(shortBodyText()),
    ]);
    const { sleep } = instantSleep();

    const err = await callWithRetry(mock, REQ, { sleep }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(RetryExhaustedError);
    expect((err as RetryExhaustedError).attempts).toHaveLength(3);
    expect(mock.callCount).toBe(3);
  });
});