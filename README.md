# company_builder-hassan

Autonomous Company Builder — Max. Turns a one-line business idea into a
comprehensive, multilingual company dossier through a staged, dependency-aware
AI generation pipeline.

Scaffold: [Next.js](https://nextjs.org) 15 (App Router) + TypeScript + Tailwind
CSS, on pnpm 10 / Node 20.

## Getting started

```bash
pnpm install
pnpm dev          # dev server on http://localhost:3000
```

## Verification gates

```bash
pnpm lint         # ESLint 9 (flat config, next/core-web-vitals + typescript)
pnpm typecheck    # tsc --noEmit
pnpm test         # Vitest — offline harness, zero network
pnpm build        # production build
```

CI (`.github/workflows/ci.yml`) runs the same four gates on every PR and push
to `main`, on Node 20 with pnpm.

## Mock LLM provider

`src/lib/llm/mock.ts` exposes `mockComplete(prompt)` — a pure, deterministic
mock LLM: no network, no clock, no RNG. It returns fixed-length markdown
(always `MOCK_RESPONSE_LENGTH` chars) ending with an
`Assumptions & open questions` section. All tests run against it, so the suite
is hermetic and secret-free.
