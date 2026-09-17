import { describe, expect, it } from "vitest";
import {
  MIN_RESPONSE_WORDS,
  validateResponse,
  validationMissReason,
  wordCount,
} from "./validation";

/** A response that passes: well over the word minimum, closing section present. */
const VALID_TEXT =
  `${"Detailed market analysis with full reasoning. ".repeat(600).trim()}\n\n` +
  "## Assumptions & open questions\n\n" +
  "- Assumes a single-tenant deployment.\n" +
  "- Pricing figures are placeholders pending research.";

/** Over the word minimum but missing the required closing section. */
const MISSING_SECTION =
  `${"Exhaustive competitive teardown content. ".repeat(600).trim()}\n\n` +
  "## Caveats\n\n- Some caveats.";

/** Has the required section but is far under the word minimum. */
const SHORT_BODY =
  `${"Brief summary. ".repeat(60).trim()}\n\n` +
  "## Assumptions & open questions\n\n- Assumes nothing yet.";

describe("wordCount", () => {
  it("counts whitespace-delimited words", () => {
    expect(wordCount("one two three")).toBe(3);
    expect(wordCount("  spaced   out\twords\nhere  ")).toBe(4);
    expect(wordCount("")).toBe(0);
  });
});

describe("validateResponse", () => {
  it("accepts a response with the assumptions section and enough words", () => {
    expect(validateResponse(VALID_TEXT)).toBe("ok");
    expect(validationMissReason(VALID_TEXT)).toBeNull();
  });

  it("rejects a response missing the assumptions section", () => {
    expect(validateResponse(MISSING_SECTION)).toBe("retry");
    expect(validationMissReason(MISSING_SECTION)).toContain("Assumptions & open questions");
  });

  it("rejects a short body even when the section is present", () => {
    expect(validateResponse(SHORT_BODY)).toBe("retry");
    expect(validationMissReason(SHORT_BODY)).toContain(`under ${MIN_RESPONSE_WORDS} words`);
  });

  it("matches the section heading case-insensitively with flexible spacing", () => {
    expect(
      validateResponse(`${"word ".repeat(MIN_RESPONSE_WORDS)}assumptions  & Open Questions`),
    ).toBe("ok");
    expect(validateResponse(`${"word ".repeat(MIN_RESPONSE_WORDS)}ASSUMPTIONS & OPEN QUESTIONS`)).toBe(
      "ok",
    );
  });

  it("sits exactly at the word boundary", () => {
    // The heading itself contributes 4 words: Assumptions, &, open, questions.
    const HEADING_WORDS = 4;
    const atMinimum = `${"word ".repeat(MIN_RESPONSE_WORDS - HEADING_WORDS).trim()}\n\nAssumptions & open questions`;
    expect(wordCount(atMinimum)).toBe(MIN_RESPONSE_WORDS);
    expect(validateResponse(atMinimum)).toBe("ok");

    const oneUnder = `${"word ".repeat(MIN_RESPONSE_WORDS - HEADING_WORDS - 1).trim()}\n\nAssumptions & open questions`;
    expect(wordCount(oneUnder)).toBe(MIN_RESPONSE_WORDS - 1);
    expect(validateResponse(oneUnder)).toBe("retry");
  });
});