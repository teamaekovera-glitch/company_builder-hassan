/**
 * Env-selectable mock provider (AI_PROVIDER=mock) — the demo/offline stand-in
 * for real transports. Unlike the scripted test MockAdapter, this one clears
 * the production validation floor (≥2,000 words + assumptions section) so a
 * full orchestrated run completes end-to-end: loops clear the default 9.0
 * gate in one round via the reconciler's RECONCILED_SCORE marker.
 *
 * Deterministic: same prompts → byte-identical responses, tokens, and ms —
 * browser-level tests and dogfood runs are reproducible with zero network
 * and zero secrets.
 */

import { ASSUMPTIONS_SECTION, MOCK_RESPONSE_MARKER } from "./mock";
import type { CompletionRequest, CompletionResult, LLMAdapter } from "./types";

/** Model id reported by the mock provider. */
export const MOCK_PROVIDER_MODEL = "mock-provider";

/**
 * Score every reconciler response reports — above the default 9.0 gate, so
 * critique loops clear in one round and mock runs stay fast.
 */
export const MOCK_RECONCILED_SCORE = 9.4;

/** Minimum body word count — safely above the 2,000-word validation floor. */
export const MOCK_BODY_WORD_COUNT = 2_100;

/** Reconciler role — the only role whose response carries the score marker. */
const RECONCILER_ROLE = "reconciler";

/** Pair-audit role — responses carry the contradiction lines the executor parses. */
const AUDIT_PAIR_ROLE = "audit-pair";

/** Localisation QA role — responses end with the pass/fail verdict marker. */
const LOCALISATION_QA_ROLE = "localisation-qa";

// FNV-1a 32-bit — same digest scheme as mock.ts, kept local so the llm layer
// stays dependency-free of the executor.
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Role embedded in every executor system prompt as the first line
 * ("You are <role>.") — the same contract executor/prompt.ts's
 * roleFromSystem enforces; parsed locally because the llm layer must not
 * import from the executor. Unknown shapes get the generic body.
 */
function roleFromSystem(system: string): string | null {
  const first = system.split("\n")[0] ?? "";
  const match = /^You are ([a-z0-9:-]+)\.$/.exec(first);
  return match?.[1] ?? null;
}

const VOCAB = [
  "market", "brand", "pricing", "funnel", "cohort", "margin", "roadmap", "moat",
  "demand", "supply", "churn", "growth", "channel", "retention", "segment",
  "forecast", "positioning", "differentiator", "assumption", "risk", "moq",
  "onboarding", "activation", "ltv", "cac", "gm", "arr", "sku", "kyc", "gdpr",
];

/**
 * Deterministic response body for a prompt: header with the prompt digest,
 * a fixed-length word stream, and the closing assumptions section. Reconciler
 * prompts additionally end with the score marker the executor parses.
 */
export function mockProviderBody(req: CompletionRequest): string {
  const role = roleFromSystem(req.system);
  const digest = fnv1a(`${req.system}\n${req.user}`);
  const words: string[] = [];
  for (let i = 0; i < MOCK_BODY_WORD_COUNT; i++) {
    words.push(`${VOCAB[(digest.length + i * 7) % VOCAB.length]}-${(i + digest.charCodeAt(i % digest.length)) % 89}`);
  }
  const lines = [
    `${MOCK_RESPONSE_MARKER} role ${role ?? "generic"} · digest ${digest}`,
    `Deterministic offline analysis (mock provider). Prompt digest ${digest}; role ${role ?? "generic"}.`,
    words.join(" "),
    ASSUMPTIONS_SECTION,
  ];
  // The executor parses markers off specific roles — including executor-
  // prefixed forms (`rerun:<stage>:reconciler`, `recheck:<pass>:audit-pair`)
  // recorded during the auto re-run pass.
  if (role === RECONCILER_ROLE || role?.endsWith(`:${RECONCILER_ROLE}`)) {
    lines.push(`RECONCILED_SCORE: ${MOCK_RECONCILED_SCORE}`);
  }
  if (role === AUDIT_PAIR_ROLE || role?.endsWith(`:${AUDIT_PAIR_ROLE}`)) {
    lines.push(`CONTRADICTION: C-1 — the pair artifacts disagree on one load-bearing number (digest ${digest})`);
  }
  if (role === LOCALISATION_QA_ROLE || role?.endsWith(`:${LOCALISATION_QA_ROLE}`)) {
    lines.push(`LOCALISATION_QA_VERDICT: pass`);
  }
  return lines.join("\n\n");
}

/** Deterministic mock adapter for AI_PROVIDER=mock. */
export function createMockProvider(): LLMAdapter {
  return {
    model: MOCK_PROVIDER_MODEL,
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const digest = fnv1a(`${req.system}\n${req.user}`);
      const seed = parseInt(digest, 16);
      const text = mockProviderBody(req);
      return {
        text,
        inputTokens: 2_400 + (seed % 900),
        outputTokens: 2_700 + ((seed >> 8) % 700),
        model: MOCK_PROVIDER_MODEL,
        // 600–1500ms: header elapsed and the tokens/sec gauge move at a
        // believable pace in mock runs; deterministic via the prompt digest.
        ms: 600 + ((seed >> 16) % 900),
      };
    },
  };
}
