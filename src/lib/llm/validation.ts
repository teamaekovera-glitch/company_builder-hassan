/**
 * Response validation — global call rule 4, enforced in code, not
 * prompted-and-prayed. A response must carry an "Assumptions & open
 * questions" section and reach the 2,000-word minimum; a miss counts as a
 * failed attempt and is retried by `retry.ts`.
 */

/** Minimum acceptable word count for every response. */
export const MIN_RESPONSE_WORDS = 2000;

const ASSUMPTIONS_HEADING = /assumptions\s*&\s*open questions/i;

/** Whitespace-delimited word count. */
export function wordCount(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/**
 * Human-readable reason the response fails validation, or null when it
 * passes. Kept separate from validateResponse so retry logging can quote the
 * verbatim reason.
 */
export function validationMissReason(text: string): string | null {
  if (!ASSUMPTIONS_HEADING.test(text)) {
    return 'missing "Assumptions & open questions" section';
  }
  const words = wordCount(text);
  if (words < MIN_RESPONSE_WORDS) {
    return `response under ${MIN_RESPONSE_WORDS} words (${words})`;
  }
  return null;
}

/** 'ok' when the response passes, 'retry' when a new attempt is needed. */
export function validateResponse(text: string): "ok" | "retry" {
  return validationMissReason(text) === null ? "ok" : "retry";
}
