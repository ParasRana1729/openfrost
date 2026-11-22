# GitHub Copilot Instructions for OpenFrost

Read [AGENTS.md](../AGENTS.md) and the
[specification](../docs/ai-os-project-spec.md) for the authoritative instructions.

The repository currently implements S00–S06 (workspace, shared Zod contracts,
SQLite persistence, Windows DPAPI secrets, authenticated loopback API, bounded
executor, OpenAI/Gemini/OpenRouter adapters, research briefs, project updates,
approval-bound report export, owner-approved Markdown memory, and weekly
planning routines), S08 Phase 1, and S09 (the Rust Ratatui + Crossterm TUI
Control Center in `apps/tui`, replacing `apps/web`). `apps/landing` is the
static marketing site. S07's one-working-week owner-use release gate remains
open.

Implement only the explicitly assigned item in the
[solo backlog](../backlog/solo-rebuild.md); do not treat planned architecture as
existing implementation. Verify TypeScript changes with
`pnpm lint && pnpm test && pnpm build` and Rust TUI changes in `apps/tui` with
`cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test && cargo build`.
