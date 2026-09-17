# Architecture — How the Builder Is Built

Technical architecture of the Autonomous Company Builder Max application. Companion documents: [PIPELINE.md](./PIPELINE.md) (what a run executes) and [WORKFLOWS.md](./WORKFLOWS.md) (how to operate it).

---

## 1. Design principles

1. **One Node server runs the pipeline; the browser only watches.** The pipeline executes server-side, so closing the laptop never stops a run. The browser subscribes to an event stream, renders state, and posts new runs — it holds no secrets and no pipeline state.
2. **SQLite is the only persistence.** No external queue, cache, or object store. Every call is persisted the moment it completes, so a disconnect, page reload, or server restart loses nothing but in-flight calls (which retry).
3. **SSE is the only realtime channel.** No token-by-token streaming — "live" means per-call events. The SSE hub replays event history on reconnect so a reloaded page never misses an update.
4. **Provider-agnostic LLM access.** The provider is a configuration change, not a code change. API keys live server-side and never reach the browser.
5. **Nothing fails silently.** Failures are first-class: every attempt is logged verbatim, failed stages quote the provider error, and dependents are visibly blocked.
6. **Everything verifies offline.** A deterministic mock provider sits behind the same adapter interface; every test and CI run uses it. CI touches no real API.

## 2. Components

| Component | Owns |
|---|---|
| **Browser dashboard** | Inputs, live progress board, stage detail tabs, downloads, header metrics. React components driven entirely by props off the run state — no business logic in components. |
| **Run API** | `POST /api/runs` (validate config, pre-flight estimate, create run), `GET /api/runs/:id` (full snapshot), `GET /api/runs/:id/events` (SSE), `GET /api/runs/:id/export?kind=dossier\|log`. |
| **Orchestrator** | Wave scheduler, stage executor, 7-call loop controller, score gate, retry policy. The only component that decides what runs next. |
| **LLM adapter** | OpenAI-compatible + Anthropic transports. Sets `max_tokens` to the model maximum, returns token counts, retries with backoff. Keys server-side only. |
| **Prompt library** | Role personas (Generator A/B/C styles, merger, three critics, improver, three judges, reconciler, translators, cultural adapters) with the global call rules injected into every prompt. |
| **Run store** | SQLite via better-sqlite3: runs, stage status, every call (verbatim prompt + response), every artifact version, scores. |
| **SSE hub** | Broadcasts run events to any number of connected tabs; replays event history on reconnect. |
| **Exporters** | Dossier builder (table of contents + every improved artifact, all languages) and run-log builder (every prompt and response, verbatim). |
| **Mock provider** | Deterministic scripted LLM behind the adapter interface — the backbone of offline tests and CI. |

## 3. Run architecture

```
┌──────────────────┐  POST /api/runs    ┌─────────────────────────────────┐
│      BROWSER     │ ─────────────────▶ │         NEXT.JS SERVER          │
│  live dashboard  │                    │  Run API ── Orchestrator        │
│  (no secrets,    │ ◀───────────────── │  waves · 7-call loop ·          │
│   no pipeline    │   SSE run events   │  score gate                     │
│   state)         │                    │  Prompt library · Exporters     │
└──────────────────┘                    │  SSE hub                        │
                                        └───────┬───────────────┬─────────┘
                                                │ completions   │ every call,
                                                ▼               ▼ verbatim
                                       ┌────────────────┐  ┌───────────────┐
                                       │  LLM PROVIDER  │  │  SQLite store │
                                       │ (server-side   │  │  runs, calls, │
                                       │  key)          │  │  artifacts    │
                                       └────────────────┘  └───────────────┘
```

Persisted **before** broadcast: an artifact or call record always survives a page reload.

## 4. LLM adapter (merged — PR #3)

```ts
export interface CompletionRequest { system: string; user: string; }
export interface CompletionResult { text: string; inputTokens: number; outputTokens: number; model: string; ms: number; }
export interface LLMAdapter { readonly model: string; complete(req: CompletionRequest): Promise<CompletionResult>; }
```

- **Transports**: OpenAI-compatible by default (`AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`); Anthropic behind `AI_PROVIDER=anthropic`. An injectable `MockAdapter` serves tests.
- **Retry policy**: exactly 3 attempts with exponential backoff on provider 5xx, timeouts, and validation misses; terminal failure raises a typed `RetryExhaustedError` with the full `AttemptRecord` log.
- **Response validation**: must include an "Assumptions & open questions" section and be ≥ 2,000 words.
- **Token accounting**: `max_tokens` set to the model maximum on every request; input/output usage returned per call for cost accounting.

## 5. Persistence schema (SQLite)

```sql
CREATE TABLE runs (
  id TEXT PRIMARY KEY,              -- nanoid
  idea TEXT NOT NULL,
  config_json TEXT NOT NULL,        -- depth, languages, scoreThreshold, strategyAngle
  status TEXT NOT NULL,             -- queued | running | completed | failed | interrupted
  created_at INTEGER NOT NULL
);

CREATE TABLE stage_status (
  run_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  status TEXT NOT NULL,             -- pending | running | done | failed | blocked
  loop INTEGER DEFAULT 0,
  score REAL,
  calls INTEGER DEFAULT 0,
  tokens INTEGER DEFAULT 0,
  PRIMARY KEY (run_id, stage_id)
);

CREATE TABLE calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  stage_id TEXT NOT NULL,
  role TEXT NOT NULL,               -- generatorA | critic:vc | judge:harsh | translator:es | ...
  loop INTEGER NOT NULL,
  attempt INTEGER NOT NULL,         -- 1..3 per the retry rule
  prompt TEXT NOT NULL,             -- verbatim
  response TEXT,                    -- verbatim; NULL while in flight or after terminal failure
  input_tokens INTEGER,
  output_tokens INTEGER,
  ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE stage_artifacts (
  run_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  kind TEXT NOT NULL,               -- genA | genB | genC | merged | critique:vc | improved | scores | translation:es | ...
  language TEXT NOT NULL DEFAULT 'en',
  text TEXT NOT NULL,
  score REAL
  -- primary key (run_id, stage_id, kind, language)
);
```

The dashboard header's token/call totals are computed from the `calls` table and must reconcile exactly.

## 6. Tech stack and CI

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) + TypeScript + React + Tailwind v4 |
| Runtime | Node 20, pnpm 10.x (`packageManager` pinned) |
| Persistence | SQLite via better-sqlite3 |
| Realtime | Server-Sent Events |
| Tests | Vitest + Testing Library, offline fixtures, deterministic mock provider — zero network |
| CI (GitHub Actions) | lint → typecheck → offline tests → production build, on Node 20 with frozen lockfile |

## 7. Security posture

- API keys are server-side environment configuration; the browser never sees one.
- Generated HTML mockups (stage 13) are **untrusted markup**: they render only inside a sandboxed iframe with the `sandbox` attribute — never injected into the app's DOM.
- No authentication by design (v1 non-goal: internal single-team tool). Other v1 non-goals: in-app editing of generated documents (view/download only), token-by-token streaming, resuming interrupted runs.

## 8. Implementation status

| Workstream | State |
|---|---|
| Scaffold + CI gates (PR #2) | ✅ Merged (`b3e779e`) |
| LLM adapter + mock provider (PR #3) | ✅ Merged (`54adb04`) |
| SQLite run store | 🔄 In progress |
| 39-stage graph, waves, depth matrix | 🔄 In progress |
| Dashboard components | 🔄 In progress |
| Executor loop, orchestration/SSE, live dashboard, exports | Planned (staged tasks) |
| Extreme mocked end-to-end verification | Planned (final task) |
| Real provider/model + API key | ⏸️ Operator decision — blocks the first real run only; development is fully offline until then |
