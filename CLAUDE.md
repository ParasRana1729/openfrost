# Claude Code Instructions for OpenFrost

Please review `AGENTS.md` and `docs/ai-os-project-spec.md` before making any changes.

## Commands
- Build: `pnpm build`
- Test: `pnpm test`
- Lint: `pnpm lint`
- Dev server: `pnpm dev`

## Guidelines
- Strict TypeScript everywhere.
- Single source of truth for types is `packages/domain` using Zod.
- Storage is SQLite (`better-sqlite3` + Drizzle) + Markdown workspace files.
- Telegram uses `grammY` long polling. Web uses Next.js App Router + Fastify.
- Always check and fulfill the exact acceptance criteria in the target issue in `backlog/`.
