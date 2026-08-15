# ❄️ OpenFrost — Personal AI Operating System

> **A self-hosted, goal-driven personal AI Operating System for Windows power users.** Workspaces as apps, real-time sync between Telegram and local Control Center, and granular approval-gated tool execution.

---

## 🌟 Key Capabilities

- 🗂️ **Workspaces as AI Apps**: Distinct environments (Coding, Learning, General, Custom) with isolated system instructions, memory, model overrides, and permitted tools.
- 📱 **Telegram Remote Control**: Paired Telegram direct-message bot (long polling) providing remote control over your AI OS.
- 💻 **Local Control Center**: Fast, modern Next.js browser dashboard (`http://localhost:3000`) for workspace configuration, approvals, and full activity audit timelines.
- 🛡️ **3-Tier Action Approval**:
  - `auto`: Safe reads and planning execute transparently.
  - `telegram`: Standard workspace modifications require approval via Telegram buttons or web inbox.
  - `local`: High-risk operations (file deletion, overwrites, outside-root commands) strictly require local Control Center authorization.
- 💾 **Hybrid Local Storage**: SQLite (`better-sqlite3` + Drizzle ORM) for indexed state, paired with human-readable, editable Markdown files for workspace memory and notes.
- ⚙️ **Always-on Daemon**: Windows Task Scheduler integration (`openfrost onboard --install-daemon`) with CLI controls (`start`, `stop`, `status`, `backup`).

---

## 🏗️ Architecture & Monorepo Layout

OpenFrost is built entirely in **TypeScript** as a `pnpm` monorepo:

```text
openfrost/
├── apps/
│   ├── web/          # Next.js App Router Control Center (React)
│   ├── api/          # Fastify API server with WebSocket/SSE event streaming
│   ├── telegram/     # grammY Telegram bot service (long polling)
│   └── daemon/       # Background job scheduler (node-cron) & run lock manager
├── packages/
│   ├── db/           # SQLite + Drizzle ORM database client, migrations, DPAPI secrets
│   ├── domain/       # Shared TypeScript types & Zod validation schemas (Single Source of Truth)
│   ├── agent/        # Vercel AI SDK agent loop, providers, tool executors, memory
│   ├── cli/          # openfrost CLI tool (commander)
│   └── ui/           # Shared React UI components
├── docs/             # Comprehensive technical specs (ai-os-project-spec.md)
├── backlog/          # 28 sequenced issue descriptions across 4 iterations
└── scripts/          # Team setup and issue import automation
```

---

## 🚀 Quick Start for Developers & AI Agents

### Prerequisites
- Windows 10/11
- Node.js LTS (v20+)
- `pnpm` (`npm install -g pnpm`)

### Installation & Development
```bash
# Clone the repository
git clone https://github.com/ParasRana1729/openfrost.git
cd openfrost

# Install dependencies across all packages
pnpm install

# Run typecheck and tests
pnpm test
pnpm lint

# Start local development servers
pnpm dev
```

---

## 🤖 Instructions for AI Coding Agents

If you are an AI coding assistant (Cursor, Claude Code, GitHub Copilot, Cline, Aider, OpenCode):
1. **Read [`AGENTS.md`](AGENTS.md)** for detailed architecture constraints, security rules, and coding conventions.
2. **Review [`docs/ai-os-project-spec.md`](docs/ai-os-project-spec.md)** for the complete technical specification.
3. **Follow [`CONTRIBUTING.md`](CONTRIBUTING.md)** for PR rules and commit standards.

---

## 📄 License & Roadmap
- See [`backlog/`](backlog/) for the complete 4-sprint roadmap (Iteration 0 through Iteration 3).
