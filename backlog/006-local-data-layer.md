---
num: 006
title: "P0 — Local data layer: SQLite + Drizzle + hybrid storage layout + migrations + seed"
owner: PLATFORM
area: platform
labels: [P0, area:platform]
iteration: "Iteration 0"
depends_on: [003]
---

## Context
Confirmed storage model (spec §4): SQLite at `%USERPROFILE%\.openfrost\db\openfrost.db` + editable Markdown workspace folders at `%USERPROFILE%\OpenFrost\workspaces\<ws>\`. This issue builds the platform: connection, migrations, seed data, DPAPI secret store.

## Scope
- `packages/db`: better-sqlite3 + Drizzle ORM, migration runner, `seed` command that creates default workspace templates (General, Learning, Coding) with template instructions.
- `packages/db` secrets module: Windows DPAPI (via `node:crypto` + dpapi bindings or `keytar`) — model keys + Telegram token only.
- Workspace folder bootstrap: `instructions.md`, `persona.md`, empty `memory/`, `notes.md`, `.allowed-folders`.

## Acceptance criteria
- [ ] Fresh fixture: `pnpm db:migrate && pnpm db:seed` leaves a usable DB + 3 template workspaces + their Markdown folders.
- [ ] Migrations are versioned; re-running is idempotent.
- [ ] DB path respects `%USERPROFILE%` and is not inside the repo.
- [ ] Secrets stored DPAPI-encrypted; decrypt succeeds only for the signed-in Windows user.
- [ ] No plaintext secret ever written to logs or config.