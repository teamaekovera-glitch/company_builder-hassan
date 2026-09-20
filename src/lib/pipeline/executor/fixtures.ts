/**
 * Offline test fixtures for the executor: a deterministic ≥2,000-word
 * response body (clears the production word/assumptions validation — the
 * scaffold's ~300-word mock body would burn attempts on validation misses)
 * and a role-aware scripted adapter that records every completed call.
 */

import { ProviderError, type CompletionRequest, type CompletionResult, type LLMAdapter } from "../../llm/types";
import { roleFromSystem } from "./prompt";

const HEADING = "## Assumptions & open questions";

/**
 * Deterministic valid body: >2,000 whitespace-separated words and the closing
 * assumptions section, so callWithRetry's validation accepts it unchanged.
 * `round` seeds the word stream — two rounds of the same role produce
 * different texts, which is what "best iteration wins" assertions need.
 */
export function longBody(seed: string, round = 0): string {
  const words: string[] = [];
  const salt = round === 0 ? seed : `${seed}#r${round}`;
  for (let i = 0; i < 2100; i++) {
    words.push(`${salt}-w${(i + round) % 53}`);
  }
  return [
    `Analysis for ${salt}.`,
    words.join(" "),
    HEADING,
    `Open question one for ${salt}; open question two for ${salt}.`,
  ].join("\n\n");
}

/** A reconciler response that also passes validation: analysis + score marker. */
export function reconciledBody(score: number, round = 0): string {
  return `${longBody("reconciler", round)}\n\nRECONCILED_SCORE: ${score}`;
}

/** A body that fails the word-count validation (for retry-miss tests). */
export function shortBody(seed: string): string {
  return `Too short: a handful of words about ${seed}. ${HEADING}`;
}

export interface RecordedCall {
  role: string;
  user: string;
  /** The verbatim response the adapter produced for this completed call. */
  response: string;
}

export type AttemptBehavior = "ok" | "fail" | "short";

export interface ScriptedAdapterOptions {
  /** Reconciled score per round (1-based). */
  scores: readonly number[] | ((round: number) => number);
  /** Per-attempt hook: runs before the default response is produced. */
  onAttempt?: (info: { role: string; user: string; call: number; attempt: number }) => AttemptBehavior;
  /** Called for every completed (validated) call, in completion order. */
  onCall?: (call: RecordedCall) => void;
}

export interface ScriptedAdapter extends LLMAdapter {
  /** Every completed call, in completion order. */
  calls: RecordedCall[];
}

/**
 * Role-aware mock transport. Roles are parsed from the system prompt with the
 * executor's own `roleFromSystem`, so fixtures stay tied to the real prompt
 * contract. Reconciler calls receive `scores[round - 1]`.
 *
 * Attempts are keyed by the full logical-call identity (system + user), not a
 * mutable "last system" cursor — the three sibling calls of a phase interleave
 * their completions, so a cursor would mis-attribute attempts.
 */
export function createScriptedAdapter(opts: ScriptedAdapterOptions): ScriptedAdapter {
  const calls: RecordedCall[] = [];
  let callNo = 0;
  let reconciles = 0;
  const attemptByKey = new Map<string, number>();

  return {
    model: "scripted-mock",
    calls,
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const role = roleFromSystem(req.system);
      const key = `${req.system}\u0000${req.user}`;
      const attempt = (attemptByKey.get(key) ?? 0) + 1;
      attemptByKey.set(key, attempt);
      callNo += 1;

      const behavior = opts.onAttempt?.({ role, user: req.user, call: callNo, attempt }) ?? "ok";
      if (behavior === "fail") {
        throw new ProviderError(502, "upstream reset");
      }

      // Round numbering: the reconciler completes round N (1-based); every
      // other loop call runs inside round reconciles+1 (generators/merger: 0).
      const round = role === "reconciler" ? reconciles + 1 : reconciles;
      let text: string;
      if (behavior === "short") {
        text = shortBody(role);
      } else if (role === "reconciler") {
        const score = typeof opts.scores === "function" ? opts.scores(round) : opts.scores[round - 1];
        if (score === undefined) {
          throw new Error(`fixture misconfigured: no scripted score for round ${round}`);
        }
        reconciles = round;
        text = reconciledBody(score, round);
      } else {
        text = longBody(role, round);
      }

      calls.push({ role, user: req.user, response: text });
      opts.onCall?.({ role, user: req.user, response: text });
      return { text, inputTokens: 100, outputTokens: 1000, model: "scripted-mock", ms: 1 };
    },
  };
}
