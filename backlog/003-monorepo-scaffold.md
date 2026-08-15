---
num: 003
title: "P0 — Monorepo scaffold: pnpm workspaces, TS, lint/format, Vitest, env validation"
owner: PLATFORM
area: platform
labels: [P0, area:platform]
iteration: "Iteration 0"
depends_on: []
---

## Context
Everything runs on this foundation. Stand up the monorepo exactly as described in spec §4: `apps/{web,api,telegram,daemon}` and `packages/{db,domain,agent,cli,ui}` with TypeScript everywhere, shared config, and Zod-validated environment loading.

## Scope
- pnpm workspaces + root `tsconfig` (strict), ESLint + Prettier, Vitest baseline.
- `packages/domain`: empty-but-wired Zod schema package.
- Dev experience: `pnpm dev` runs all apps locally with hot reload; no Docker.

## Acceptance criteria
- [ ] `pnpm install && pnpm build` passes in CI from a clean checkout.
- [ ] `pnpm lint` and `pnpm test` pass (one placeholder test per package).
- [ ] Env vars validated by Zod at startup; invalid config fails fast with a clear message.
- [ ] Windows-first: setup documented so a fresh Windows machine gets dev running in <15 min.