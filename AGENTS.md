# AGENTS.md — AI Agent Guidance & Coding Standards for OpenFrost

> **Universal AI Agent Instructions**: This document is the primary instruction manual for any AI Coding Agent (Cursor, Claude Code, GitHub Copilot, Cline, Aider, Antigravity, OpenCode) contributing code to OpenFrost. All changes must adhere strictly to the rules below.

---

## 1. Project Overview & Architecture

OpenFrost is a self-hosted personal **AI Operating System** for Windows. It isolates workspaces (Coding, Learning, General, Custom) into distinct "AI apps"—each with its own system prompt, isolated Markdown memory, model overrides, and scoped tool permissions.

### Monorepo Structure (`pnpm` workspaces)

```text
apps/
  web/          # Next.js App Router dashboard (React) — local Control Center
  api/          # Fastify API server + WebSocket/SSE realtime event hub
  telegram/     # grammY Telegram bot (long polling, pairing, inline buttons)
  daemon/       # Background scheduler (node-cron), job queue, run lock manager
packages/
  db/           # better-sqlite3 + Drizzle ORM, schema, migrations, seed, DPAPI secrets
  domain/       # Shared TypeScript types + Zod validation schemas (SINGLE SOURCE OF TRUTH)
  agent/        # Vercel AI SDK agent loop, providers (OpenAI/Anthropic), tool executor, memory
  cli/          # openfrost CLI (commander) — onboard, start, stop, status, backup
  ui/           # Shared React components (primitives, forms, timeline, approval cards)
docs/           # Comprehensive specs (ai-os-project-spec.md) and design docs
backlog/        # 28 sequenced issue descriptions with acceptance criteria
.github/        # Issue forms, PR templates, and CI workflows
```

---

## 2. Hard Architectural Rules

1. **Strict TypeScript Everywhere**: No `any` types. Enable strict null checks.
2. **Domain-Driven Schemas (`packages/domain`)**:
   - All shared data models (`User`, `Workspace`, `Conversation`, `Message`, `Event`, `Approval`, `Schedule`, `AgentRun`, `MemoryRecord`) MUST be defined with **Zod schemas** in `packages/domain`.
   - Never redefine data structures or duplicate types across apps.
3. **Local Database & Storage Boundary**:
   - **Database**: SQLite via `better-sqlite3` and `Drizzle ORM` located at `%USERPROFILE%\.openfrost\db\openfrost.db`.
   - **User Workspace Data**: Markdown files located at `%USERPROFILE%\OpenFrost\workspaces\<workspace>\` (`instructions.md`, `persona.md`, `memory/*.md`, `notes.md`, `.allowed-folders`).
   - No Docker dependencies in the core local runtime.
4. **Security & Permission Hierarchy**:
   - All tool executions must be classified into one of three risk tiers:
     - `auto`: Safe reads & planning (execute immediately, log audit event).
     - `telegram`: Standard writes / workspace commands (requires user approval via Telegram inline buttons or web inbox).
     - `local`: High-risk actions (file deletion, overwriting, execution outside `.allowed-folders`, network changes, credential updates). **MUST be approved in the local web Control Center session.** Cannot be approved remotely.
   - **Host Terminal Execution**: Commands run as the signed-in Windows user (OpenClaw-style), but MUST be restricted to the workspace's `.allowed-folders` paths. Path traversal (`../`) must be rejected.
   - **Secrets Management**: Model API keys and Telegram tokens MUST be encrypted with Windows **DPAPI** (`node:crypto` / `keytar`). NEVER write plaintext secrets to disk, `.env` commits, logs, or agent memory.
5. **Real-time Sync (`Telegram <-> Web`)**:
   - Messages from both Telegram and Web are saved into the canonical `Message` SQLite table.
   - Fastify SSE/WebSocket broadcasts events so the web UI updates in real time (<1s).
6. **Agent Concurrency**:
   - **One active agent run per workspace**. Simultaneous runs in the same workspace must queue.

---

## 3. Workflow for AI Agents Working on an Issue

When an AI agent is instructed to implement an issue:

1. **Read the Assigned Issue**: Look up the issue in `backlog/###-<name>.md` or on GitHub.
2. **Consult the Spec**: Read [`docs/ai-os-project-spec.md`](docs/ai-os-project-spec.md) for full context and rationale.
3. **Verify Dependencies**: Ensure that any issues listed in `depends_on` are already merged into `main`.
4. **Write Tests First / Alongside**:
   - Use **Vitest** for unit and integration testing.
   - Every API endpoint and core utility must have test coverage.
5. **Run Verification Commands Before Opening a PR**:
   ```bash
   pnpm lint
   pnpm test
   pnpm build
   ```
6. **PR Title & Body Convention**:
   - Title: `feat(#X): <short description>` or `fix(#X): <short description>`
   - Body must include: `Closes #X` and check off every box in the Acceptance Criteria list from the issue.

---

## 4. Key Libraries & Conventions

- **Language**: TypeScript (ES2022+ / Node LTS)
- **Monorepo Manager**: `pnpm` (`pnpm-workspace.yaml`)
- **Web Frontend**: Next.js App Router, React 19, Tailwind CSS / Vanilla CSS (modular)
- **Backend API**: Fastify with `@fastify/websocket` / SSE
- **Telegram Bot**: `grammY` (using long polling `bot.start()`, never webhooks)
- **Database**: `better-sqlite3` + `drizzle-orm` + `drizzle-kit`
- **Validation**: `zod`
- **Agent Framework**: Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`)
- **Daemon / CLI**: `commander` + Windows `schtasks.exe` integration
- **Test Runner**: `vitest`

---

## 5. Non-Goals (Explicitly OUT of MVP Scope)

Do **NOT** implement or add dependencies for:

- Cloud relays or remote hosted databases.
- Multi-user authentication beyond local admin password.
- Group chat bot capabilities (paired direct message only).
- Screen / mouse / keyboard OS automation.
- Plugin marketplace or untrusted user scripts.
