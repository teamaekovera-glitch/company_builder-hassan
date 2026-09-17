# Pipeline Reference — The 39-Stage Generation Engine

This document is the functional contract for the Autonomous Company Builder Max generation engine. It is derived from the approved specification (Blueprint `art_e7Vk9aoo`) and describes every stage a "Build Company" run executes, the quality loop each stage runs, and the depth scaling that controls cost.

**One run = one complete company dossier.** A single Extreme run executes 26 core stages in 5 dependency waves, then 13 pass stages (adversarial review, consistency audit, synthesis, auto re-run, localisation, persona rewrites, output formats) — on the order of 600–900 LLM calls and millions of tokens.

---

## 1. The 7-call quality loop (every core stage)

Every stage in waves 1–5 runs the same quality loop:

```
IDLE
 └─ GENERATING     three independent drafts in parallel (Generator A ∥ B ∥ C)
     └─ MERGING    one merger call fuses the drafts into the best single artifact
         └─ CRITIQUING    three critic personas in parallel (e.g. VC, operator, customer)
             └─ IMPROVING     one improver call, fed all three critiques
                 └─ SCORING      three judge personas score in parallel
                     └─ RECONCILING  one reconciler call settles the final score
                                       and explains the rationale
                         ├─ score ≥ threshold  → DONE
                         └─ score < threshold ∧ loop < cap → loop + 1, back to CRITIQUING
```

Rules that hold for every call in the system (the "global call rules"):

1. **`max_tokens` is always set to the model maximum.** No response is ever capped by configuration.
2. **Every prompt includes the complete text of every prior artifact.** Context is never silently truncated. If a request exceeds the model's context window it fails loudly through the retry path — the remedy is a longer-context model in config, never silent trimming.
3. **Every response is validated**: it must contain an "Assumptions & open questions" section and be at least 2,000 words, or the call is retried.
4. **Every prompt and response is persisted verbatim** to SQLite before anything is broadcast to the UI.

### Score gate and loop cap

- Default reconciled-score threshold: **9.0**.
- Steps 3–6 (critique → improve → score → reconcile) repeat while the reconciled score is below the threshold, at most **loop-cap rounds** per depth (see depth matrix): 1 at Standard, 2 at Deep, 3 at Extreme. The merger runs once per stage regardless.
- A stage still below threshold when the cap is hit **completes with its best-scoring iteration** and is flagged; the meta-score pass (stage 34) names the 5 weakest stages for the auto re-run (stage 36).
- The stricter re-run workflow raises the threshold to **9.5** in a fresh run — originals are never overwritten.

---

## 2. Wave structure

Stages run only when **all** their dependencies are done; stages without mutual dependencies within a wave run in parallel. Failure semantics: a failed stage blocks its dependents (they start `blocked`) while the rest of the run continues everywhere unaffected.

| Wave | Stages | Theme |
|---|---|---|
| 1 | 1–3 | Market reality (analysis, competitors, expert panel) |
| 2 | 4–6 | Business model and customers |
| 3 | 7–9 | Product and brand definition |
| 4 | 10–22 | The build-out: data, code, marketing, finance, hiring, GTM |
| 5 | 23–26 | Risk, security, investor and board materials |
| Pass | 27–39 | Adversarial gauntlet, audit, synthesis, re-run, localisation, personas, formats |

---

## 3. Stage catalog

Calls listed are **beyond the standard 7-call loop** that every core stage runs.

### Wave 1 — Market reality

| # | Stage | Extra calls & required content |
|---|---|---|
| 1 | **Market Analysis** | — (TAM/SAM/SOM by region, 5-year forecast, regulation by country, 15 data-backed insights — all inside the loop calls) |
| 2 | **Competitor Analysis** | +1 list call (12 named competitors), +12 deep-dive calls (one per competitor: SWOT, pricing teardown, feature matrix, review sentiment, "how we beat them"), +1 synthesis call |
| 3 | **Expert Roundtable** | — (10 named panelists with backgrounds and biases; transcript ≥ 4,000 words) |

### Wave 2 — Business model and customers

| # | Stage | Extra calls & required content |
|---|---|---|
| 4 | **Business Model Design** | — (Business Model Canvas, Lean Canvas, Value Proposition Canvas, unit economics with formulas, 3 alternative models compared) |
| 5 | **User Interview Simulation** | +12 transcript calls (25 questions each), +12 Jobs-To-Be-Done calls, +1 pain-point clustering call, +1 persona-card call (12 cards) |
| 6 | **Customer Journey Mapping** | +12 per-persona journey calls (awareness → purchase → retention → churn, with emotions and touchpoints) |

### Wave 3 — Product and brand

| # | Stage | Extra calls & required content |
|---|---|---|
| 7 | **PRD** | — (epics, 60+ Gherkin user stories, NFRs, 4-quarter roadmap, RICE backlog) |
| 8 | **Brand Identity** | — (20 names with rationale, 20 taglines, tone-of-voice guide, palette, typography, logo concepts, brand story) |
| 9 | **Legal & Compliance Pack** | +5 separate full-length calls: Terms of Service, Privacy Policy, DPA, GDPR/CCPA checklist, cookie policy |

### Wave 4 — The build-out

| # | Stage | Extra calls & required content |
|---|---|---|
| 10 | **Database Design** | — (full schema with columns/types/constraints/indexes, Mermaid ERD, migration SQL, seed script, query-performance notes) |
| 11 | **API Design** | +1 call per resource group (example requests/responses, error handling), +1 webhook & events spec — after the OpenAPI 3.1 YAML call |
| 12 | **Architecture Design** | +8 or more ADR calls (one per decision), after the Mermaid system diagram / infra / scaling / cost call |
| 13 | **UI Generation** | +1 page inventory, +1 design system spec, +12 per-screen single-file HTML/Tailwind mockups, +12 per-screen accessibility audits |
| 14 | **Code Generation** | +6 backend module calls (auth, users, billing, core domain, notifications, admin), +1 frontend wiring call per screen, +1 test-suite call per module |
| 15 | **Marketing Plan** | +30 ad copies, +15 blog-post calls (one per 1,500-word post), +20 sequence emails, +50 social posts, +1 launch playbook |
| 16 | **SEO Strategy** | — (100 keyword clusters, content-gap analysis, 20 landing-page briefs, technical checklist) |
| 17 | **Pricing Strategy** | — (tiers, packaging, Van Westendorp simulation, anchoring, 5 alternatives with revenue projections, pricing-page copy) |
| 18 | **Sales Playbook** | — (ICP, discovery script, 30 objection handlers, demo script, 10 cold-email and 10 LinkedIn sequences) |
| 19 | **Customer Support Pack** | +25 help-centre article calls, +chatbot intents, +escalation matrix, +SLA definitions |
| 20 | **Financial Model** | +3 scenario calls (bear / base / bull) after P&L, cash flow, balance sheet, hiring-linked cost model, sensitivity analysis, cap table |
| 21 | **Hiring Plan** | +20 job-description calls (one per role), +interview scorecards, +compensation bands, +onboarding plans |
| 22 | **Go-To-Market Timeline** | — (52-week plan, quarterly OKRs, dependency map) |

### Wave 5 — Risk and capital

| # | Stage | Extra calls & required content |
|---|---|---|
| 23 | **Risk Assessment** | +5 black-swan narrative calls, after the 40-risk matrix, mitigations, owners, and pre-mortem |
| 24 | **Security & Threat Model** | — (STRIDE per component, threat scenarios, incident-response runbook, pen-test plan) |
| 25 | **Investor Pitch** | — (20-slide script with speaker notes, 3,000-word narrative memo, 50 anticipated Q&As, one-page teaser, data-room index) |
| 26 | **Board Report Simulation** | +4 calls — one simulated quarterly report each, with metrics derived from stage 20's financial model |

### Pass stages 27–39

| # | Pass | What it does |
|---|---|---|
| 27–31 | **Adversarial gauntlet** | 5 sequential calls: Devil's Advocate → Rebuttal → second Devil's Advocate → Final Rebuttal → 3-round Red-vs-Blue debate transcript |
| 32 | **Consistency Audit** | +1 call per stage pair (pricing↔financial model, PRD↔API, API↔database, marketing↔brand, hiring↔financial model, roadmap↔GTM), +1 resolution call per contradiction found |
| 33–35 | **Synthesis & ladder** | Executive synthesis (dossier + 100+ term glossary), +6 summary-ladder calls (10,000 / 5,000 / 2,000 / 500 / 100 words / one tweet), meta-score ranking all stages and naming the 5 weakest |
| 36 | **Auto Re-run** | Full 7-call loop on the 5 weakest stages, then passes 32–35 re-run |
| 37 | **Localisation** | Per selected language: 1 call per document × language, +1 localisation-QA call, +1 cultural-adaptation call (marketing and pricing rewritten for the market) |
| 38 | **Persona Rewrites** | +6 calls (CEO, CTO, CFO, CMO, first engineer hire, first customer), each ≥ 3,000 words, rewriting the executive synthesis |
| 39 | **Output Formats** | +6 calls: Markdown dossier, slide-deck script, two-host podcast script (6,000 words), 100-question FAQ, Notion-style wiki structure, 12-email investor-update series |

---

## 4. Depth matrix (the cost dial)

Depth scales expansion counts and loop caps only — never the stage list. **Extreme reproduces the founding brief verbatim and is the default.**

| Parameter | Standard | Deep | Extreme (default) |
|---|---|---|---|
| Competitor deep-dives | 4 | 8 | 12 |
| Personas (interview + JTBD + journeys) | 4 | 8 | 12 |
| UI screen mockups + a11y audits | 6 | 9 | 12 |
| Blog posts (1,500 words each) | 5 | 10 | 15 |
| Help-centre articles | 12 | 18 | 25 |
| Job descriptions | 8 | 14 | 20 |
| Keyword clusters / landing briefs | 40 / 8 | 70 / 14 | 100 / 20 |
| Risks / black swans | 20 / 3 | 30 / 4 | 40 / 5 |
| Ads / emails / social posts | 15 / 12 / 25 | 20 / 16 / 35 | 30 / 20 / 50 |
| Objections / cold / LinkedIn sequences | 15 / 5 / 5 | 20 / 7 / 7 | 30 / 10 / 10 |
| Critique-loop cap (rounds of steps 3–6) | 1 | 2 | 3 |
| ADRs (minimum) | 8 | 8 | 8 |

Language selection (EN / ES / DE / JA / HI) is **orthogonal** to depth: localisation (stage 37) runs only for the languages selected at config time, and costs one call per document per selected language plus QA and cultural-adaptation calls.

---

## 5. Failure semantics, precisely

| Level | Behavior |
|---|---|
| **Call** | Provider 5xx, timeouts, and validation misses (missing assumptions section, under 2,000 words) all consume one of 3 attempts, each logged verbatim with its error. Exponential backoff between attempts. |
| **Stage** | Terminal failure quotes the provider error on the stage card and in the run log; the stage ends `failed` and its dependents start `blocked`. The run continues everywhere unaffected — only an unrecoverable store error fails the whole run. |
| **Context overflow** | Rule 2 forbids truncation, so an oversized request fails loudly through the same retry path. The fix is a longer-context model chosen by config, never silent trimming. |
| **Loop cap** | A stage still below threshold after its final round completes with its best iteration; the meta-score pass flags it for the auto re-run. |
| **Server restart** | On boot, a run found mid-flight is marked `interrupted`; the operator starts a fresh run. Resume-from-artifact is a deliberate v1 non-goal (everything needed is persisted; it is flagged as adjacent work, not silently missing). |

---

## 6. Run configuration

A run is created with:

| Parameter | Default | Notes |
|---|---|---|
| `idea` | — (required) | One-line business idea; injected into every prompt |
| `depth` | `extreme` | `standard` / `deep` / `extreme` per the matrix above |
| `languages` | `["en"]` | Any of EN, ES, DE, JA, HI; localisation runs only for selections |
| `scoreThreshold` | `9.0` | Stricter re-runs use `9.5` in a fresh run |
| `strategyAngle` | — (optional) | Used by the 3-alternatives mode; injected into every prompt |

Every parameter is shown with a **pre-flight token/cost estimate**, and execution requires an explicit confirmation before any provider call is made.

---

*Source of truth: "Autonomous Company Builder Max — Spec" (project blueprint). Where this document and the spec disagree, the spec wins — file an issue.*
