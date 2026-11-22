# Claude Code Instructions for OpenFrost

Read [AGENTS.md](AGENTS.md), the [specification](docs/ai-os-project-spec.md),
and the [solo backlog](backlog/solo-rebuild.md) before making changes.

## Current repository state

- **Implemented on `main`:** S00–S06 (pnpm workspace, shared Zod contracts in
  `packages/domain`, SQLite + Drizzle persistence and Windows DPAPI secret
  storage in `packages/db`, loopback Fastify API and routine scheduler in
  `apps/api`, single-run bounded executor and OpenAI/Gemini/OpenRouter adapters
  in `packages/agent`, research briefs, project updates, approval-bound report
  exports, owner-approved Markdown memory, and weekly planning routines), S08
  Phase 1, and **S09** (the Rust Ratatui + Crossterm TUI Control Center in
  `apps/tui`, replacing the removed `apps/web`; PR #33, #34, #35, #37).
- **Static marketing site:** `apps/landing` (Next.js static export, port 3001,
  no API dependency).
- **Open release gate:** S07's one-working-week real-use evaluation remains
  open. Do not mark S07 complete until that owner-use gate is met.

## Verification commands

- TypeScript workspace: `pnpm lint && pnpm test && pnpm build`
- Rust TUI (`apps/tui`): `cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo build`

Follow [AGENTS.md](AGENTS.md) as the authoritative engineering and security
guide instead of assuming planned architecture already exists. Implement only
the explicitly assigned slice.
