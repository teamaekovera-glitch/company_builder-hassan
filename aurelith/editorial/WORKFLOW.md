# Aurelith Production Workflow

How the Aurelith Encyclopedia is written: 60 entries in 6 waves of 10, with a 5,000-word consistency audit after every 10 entries, running-canon harvesting between waves, and a final human read-through. Canon lives in `aurelith/canon/` (`bible.md`, `timeline.md`, `glossary.md`); the entry template and writer brief live in `aurelith/editorial/`; the task-tree dispatch scripts live in `aurelith/orchestration/`.

## Authority hierarchy

**bible.md > master timeline > glossary > individual entries.** Entries may extend the canon sideways (new towns, people, customs, minor events) but may never contradict it.

## The wave schedule (60 entries, 6 waves of 10)

| Wave | Entries | Contents |
|---|---|---|
| 1 | 01–10 | Nations 1–10 (Caldrith through the Kettle Freeholds) |
| 2 | 11–20 | Nations 11–12 (Sarhadd, the Umbral Concord) + eras I–VIII |
| 3 | 21–30 | Eras IX–X + major figures 1–8 |
| 4 | 31–40 | Figures 9–10 + religions/philosophies 1–8 |
| 5 | 41–50 | Technologies/magic systems 1–8 + languages 1–2 |
| 6 | 51–60 | Languages 3–6 + economic systems 1–6 |

## Per-entry production loop

1. **Dispatch** — a writer (agent or human) is dispatched with the locked-canon brief (`aurelith/editorial/writer-brief.md`) naming their exact files, titles, and angles.
2. **Write** — the entry follows `aurelith/editorial/entry-template.md`: section order fixed, body ≥ 2,300 words by `wc -w` excluding New Canon / New Timeline blocks, canon spellings locked, every new proper noun and dated event logged in New Canon / New Timeline.
3. **Verify** — the writer runs `wc -w` on the finished file and reports counts plus any canon conflicts or bible gaps.
4. **Harvest** — New Canon blocks merge into `glossary.md`; New Timeline rows merge into `timeline.md`. The master files are the running canon.
5. **Appendix reproduction** — the full current Master Timeline and full current Glossary are appended to the entry, headed "Appendix: Master Timeline" and "Appendix: Glossary." Every published entry therefore carries the whole running canon at the end.
6. **Publish** — the entry is published as a document artifact by the integrator, never by the writer.

## The audit loop (after every 10 entries)

After each wave closes, a **5,000-word consistency audit** covers the ten entries just finished:

- Every contradicting passage is re-quoted **in full**, with a verdict on each.
- Full replacement text is provided for affected passages.
- Affected entries are rewritten and republished.
- The audit itself is published as a document artifact.

Six audits are scheduled in total (one per wave), plus a **final human review**: a read-through of all 60 entries and all 6 audits against the bible.

## Orchestration

The dispatch scripts in `aurelith/orchestration/` automate the task tree behind this workflow via the Obvious SDK: a root task, a completed canon task, six wave tasks, six audit tasks, a final-review task, and per-batch writer tasks started with the locked-canon brief as the worker prompt. See that directory's README material and `aurelith-lint.yml` (CI gates) in `.github/workflows/`.
