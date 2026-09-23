# Aurelith Entry Template

The mandatory section template for every entry in the Aurelith Encyclopedia, extracted from the Series Bible (`aurelith/canon/bible.md`, section 10 — "Style and Process Rules"). Sections appear in exactly this order; none may be dropped.

## Length floor

The entry body must be **at least 2,300 words**, verified with `wc -w` on the finished file. The count **excludes** the New Canon and New Timeline blocks at the end. The floor is a minimum, not a target — richness is welcome.

## Template (in this exact order)

```markdown
# <Entry title>

<One-line epigraph: an invented in-world quotation, attributed to a named
source with a year in "X AR" form>

## Overview

<States plainly what the subject is and why it matters in 1147 AR.>

## History

<Chronological; every date written "X AR".>

## Government and Society

<Power, law, daily life. Use the section set appropriate to the entry type.>

## Culture

<Language(s), faith, arts, food, dress.>

## Foreign Relations

<Neighbors and rivals.>

## The Present Height (Year 1147)

<The subject's situation in the current year; see bible section 9 for the
locked world state.>

## In-World Sources

<2–4 invented sources (author, title, year AR) an in-world scholar might
cite, each with a one-line note on its bias.>

## New Canon

<Every new proper noun invented in the entry, logged as:
**Term** — one-line definition>

## New Timeline

<Every new dated event invented in the entry, logged as table rows:
| YEAR | event |>
```

## Notes for writers

- The epigraph is one line: an invented in-world quotation with a named attribution and a year in "X AR" form.
- Every date is written "X AR." No real-world places, faiths, or idioms. No hedging — the encyclopedia is confident even about contested facts; attribute disputes to in-world historians instead.
- Prose paragraphs only inside the entry body; tables are reserved for genuine reference data (vocabulary, units, rosters).
- Canon discipline: every date, name, and spelling must match `aurelith/canon/bible.md` and `aurelith/canon/timeline.md` exactly. Invent freely sideways (new towns, families, customs, minor events) — never backward (re-dating established events).
- Do **not** append the master timeline or glossary yourself: the integrator adds the "Appendix: Master Timeline" and "Appendix: Glossary" sections at publish time.
- The New Canon and New Timeline blocks exist for harvest: at integration they are merged into the master files, and the full current master files are appended to the entry as appendices.
