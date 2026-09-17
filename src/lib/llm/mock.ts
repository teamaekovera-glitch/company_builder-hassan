/**
 * Deterministic mock LLM provider.
 *
 * Pure function: same prompt in → byte-identical markdown out. No network,
 * no clock, no RNG, no secrets — safe to run in CI with zero environment.
 * Responses are fixed-length markdown skeletons that always end with an
 * "Assumptions & open questions" section, mirroring the dossier shape the
 * real pipeline stages will produce.
 */

/** Total character length of every mock response. */
export const MOCK_RESPONSE_LENGTH = 2048;

/** Marker embedded in every response so tests and tools can identify mock output. */
export const MOCK_RESPONSE_MARKER = "[mock-provider]";

/** Fixed closing section present in every response. */
export const ASSUMPTIONS_SECTION = [
  "## Assumptions & open questions",
  "- Assumes a single-tenant web deployment; multi-tenant isolation is an open question.",
  "- Pricing, funding, and legal figures are placeholders pending real research.",
].join("\n");

// FNV-1a 32-bit constants — stable, dependency-free digest for determinism.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const ECHO_BUDGET = 160;
const FILLER_LINE =
  "- Placeholder section: content is produced deterministically by later pipeline stages.\n";

/** FNV-1a 32-bit digest as 8 hex chars. */
function fnv1a(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Deterministic fixed-length markdown dossier skeleton for a one-line idea. */
export function mockComplete(prompt: string): string {
  const trimmed = prompt.trim();
  const echo = trimmed.length > ECHO_BUDGET ? `${trimmed.slice(0, ECHO_BUDGET)}…` : trimmed;
  const header = `${MOCK_RESPONSE_MARKER} idea: "${echo}" · digest: ${fnv1a(trimmed)}`;
  const sectionBlock = `\n\n${ASSUMPTIONS_SECTION}`;

  // Over-fill filler, then slice: total length is exact by construction, and
  // the assumptions section always closes the response on its own line.
  const filler = FILLER_LINE.repeat(Math.ceil(MOCK_RESPONSE_LENGTH / FILLER_LINE.length));
  const prefix = (header + filler).slice(0, MOCK_RESPONSE_LENGTH - sectionBlock.length);

  return `${prefix}${sectionBlock}`;
}
