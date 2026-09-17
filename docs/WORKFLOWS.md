# Operational Workflows — Running and Operating the Builder

How to operate the Autonomous Company Builder Max: build a company, manage cost, handle failures, localize, re-run, and develop offline. Companion documents: [PIPELINE.md](./PIPELINE.md) (stage catalog) and [ARCHITECTURE.md](./ARCHITECTURE.md) (system design).

---

## Workflow 1 — Build a company

1. **Configure** on the dashboard: enter the one-line business idea, pick a depth (Standard / Deep / **Extreme** — default), and pick languages (EN / ES / DE / JA / HI; English is always produced).
2. **Review the pre-flight estimate.** Before any provider call, the server returns a token/cost estimate derived from the depth matrix and language selection. An Extreme run is on the order of **600–900 calls and millions of tokens** — read the estimate before proceeding.
3. **Confirm.** Execution starts only after an explicit confirmation on the Build Company button. No estimate, no run.
4. **Watch live.** The board renders the dependency waves as columns; each stage card shows status, loop round, tokens, elapsed time, live score, and call count, updating over SSE — no polling, no refresh needed. A reloaded page re-attaches cleanly and replays missed events.
5. **Inspect results.** Stage detail tabs show drafts A/B/C, the merged artifact, all critiques, the improved artifact (winning iteration highlighted), scores with the reconciler's rationale, and translations. HTML screen mockups render in a sandboxed iframe.
6. **Download.** `dossier.md` — contents list + every improved artifact in all selected languages. `run-log.md` — every prompt and response, verbatim and unescaped.

The run lives on the server: closing the browser never pauses it.

## Workflow 2 — Choose a depth (the cost dial)

| Depth | Loop cap | Fan-out | When to use |
|---|---|---|---|
| Standard | 1 round | Smallest (e.g. 4 competitor deep-dives, 12 help articles) | Cheap pipeline validation, quick idea stress-test |
| Deep | 2 rounds | Medium | Balanced quality/cost for a serious candidate |
| Extreme (default) | 3 rounds | Full brief, verbatim (12 deep-dives, 25 help articles, 15 blog posts, …) | The complete, pre-investment dossier |

Depth never changes the stage list — only expansion counts and the critique-loop cap. Language selection is orthogonal and multiplies only stage 37 (localisation).

## Workflow 3 — Re-run stricter (never overwrite)

Re-runs always create a **fresh run**; originals are never touched.

- **Stricter quality**: same idea, threshold raised to **9.5**.
- **3-alternatives mode**: three full pipelines run in parallel, each with a distinct **strategy angle injected into every prompt** (set the angle at config time), followed by one comparison call that ranks the alternatives.
- **Post-completion auto re-run** is built into every run: stage 36 re-executes the full loop on the 5 weakest stages (named by the meta-score pass) and re-runs the audit/synthesis passes.

## Workflow 4 — Handle failures

- **A stage failed**: its card (and `run-log.md`) quotes the verbatim provider error. Its dependents show `blocked`. The rest of the run continues — start a fresh run to retry; failed work is never silently retried in place.
- **Context overflow**: full-artifact threading means late-stage prompts are the largest. Overflow fails loudly through the retry path — switch to a longer-context model in configuration; the app never trims silently.
- **Server restarted mid-run**: the run is marked `interrupted` on boot. Review its persisted log, then start a fresh run. (Resume-from-artifact is a documented v1 non-goal.)
- **Loop cap hit**: a stage below 9.0 after its final round completes with its best iteration and is flagged by the meta-score — check stage 34's output to see which stages were weakest.

## Workflow 5 — Develop offline (zero API keys required)

```bash
pnpm install            # Node 20, pnpm 10.x (pinned via packageManager)
pnpm lint               # gate 1
pnpm typecheck          # gate 2
pnpm test               # gate 3 — offline Vitest, deterministic mock provider, zero network
pnpm build              # gate 4 — production build
```

CI runs the same four gates on every PR. All LLM-facing tests use the injectable mock adapter behind the same interface as the real transports. A known caveat under repair: the scaffold's `mockComplete()` output is ~300 words, below the 2,000-word validation floor — executor tests will use a longer mock body or a validation-exempt mock path; production validation stays strict.

## Workflow 6 — Enable real runs

Development needs no key; real runs need one configuration pass:

1. Choose a provider and model (decision currently open). Any OpenAI-compatible endpoint works out of the box; Anthropic is behind a flag.
2. Set server-side environment variables — never in the browser, never pasted in chat: `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` (`AI_PROVIDER=anthropic` for Anthropic).
3. The adapter is already merged (PR #3): switching providers or models is configuration only. Prefer a long-context model — full-artifact threading makes context size the binding constraint.
4. Watch live cost on the run header (tokens, calls, elapsed, tokens/sec gauge); every call's usage is persisted.

## Workflow 7 — Read a finished run

- **Header**: totals reconcile exactly with the `calls` table (tokens, calls, elapsed, cost).
- **Stage tabs**: judge scores are separate per persona; the reconciler's rationale explains the final number.
- **Meta-score (stage 34)**: ranks all stages, names the 5 weakest, and feeds the auto re-run (stage 36).
- **Consistency audit (stage 32)**: lists contradictions found between stage pairs (pricing↔financials, PRD↔API, …) and their resolutions.
- **Downloads**: `dossier.md` for the deliverable, `run-log.md` for the complete audit trail.
