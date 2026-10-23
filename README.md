# OpenFrost — Personal AI Operating System

> One personal AI agent that turns requests and recurring responsibilities into
> completed work, with useful memory, visible progress, and owner control.

**Status: S01 local foundation implemented. No model-backed workflows exist yet.**

OpenFrost is a solo project owned by ParasRana1729. What ships today is the
S01 foundation: a pnpm workspace, shared Zod contracts, SQLite persistence,
DPAPI-protected secrets, an authenticated loopback API, a local web UI, and a
bounded single-run task executor verified by automated tests. The OpenAI
provider and the three product workflows (research briefs, project updates,
weekly planning) are **not implemented yet** — they land with S02+. Tasks
submitted today fail honestly with "no model provider is configured".

## The direction

Keep the “AI OS” vision: a foundation for context, tasks, tools, memory,
permissions, and background execution. Start with **one assistant**,
**projects for context**, and **one local web interface**, rather than
separate AI personalities.

The first release targets three useful jobs:

| Workflow | Result | Status |
| --- | --- | --- |
| Research brief | A saved comparison and recommendation, with sources and uncertainties. | Planned (S02) |
| Project update | An evidence-backed summary of granted project notes, blockers, and next steps. | Planned (S03) |
| Weekly planning | An owner-scheduled draft of priorities from project notes and recent updates. | Planned (S06) |

The runtime is Windows-first and local, using SQLite + Drizzle, editable
Markdown memory, and the owner's OpenAI API key protected with Windows DPAPI.
Local-first does not mean offline: selected context is sent to the model/search
provider. The PC must be awake and the runtime running; work can continue after
the browser closes, but not while the PC is off.

Tools will start with public web research, granted-folder reads, and approved
export of new reports. No arbitrary shell, browser/OS computer use, Telegram,
agent teams, cloud workers, or plugin marketplace in v0.1.

See the [product one-pager](docs/product-one-pager.md) and
[full specification](docs/ai-os-project-spec.md) for the accepted scope and
release gates. They describe planned behavior; the table above tracks what is
real today.

## What is implemented (S01)

- **Workspace and toolchain:** pnpm workspace with Node 24 LTS
  (`.nvmrc`; engines allow 24–26) and pnpm pinned in `packageManager`.
  `pnpm lint && pnpm test && pnpm build` are the required checks and run on
  `windows-latest` in GitHub Actions.
- **`packages/domain`:** Zod contracts for tasks, agent runs, conversations,
  messages, artifacts, append-only events, risk tiers, execution limits, and
  settings, with enforced task/run state-transition maps.
- **`packages/db`:** SQLite + Drizzle migrations under
  `%USERPROFILE%\.openfrost\db\openfrost.db` (owner override:
  `OPENFROST_HOME`). Data survives restarts; migrations never reset it.
  Provider keys are sealed with real Windows DPAPI
  (CryptProtectData/CryptUnprotectData, CurrentUser scope) and fail closed
  off Windows.
- **`packages/agent`:** one global executor; one run at a time, finite
  step/wall-clock/input/output limits, cancellation, explicit retries with
  visible attempt history, and restart recovery that marks unfinished runs
  `interrupted` and pauses dispatch for owner review. A deterministic fake
  provider covers all of this in tests — no paid API calls anywhere in CI.
- **`apps/api`:** Fastify bound to `127.0.0.1` with first-run owner setup,
  scrypt passwords, HttpOnly SameSite=Strict sessions, session-bound CSRF
  tokens, origin allowlisting, an authenticated SSE activity stream, and
  logging that drops headers/cookies/bodies so secrets never reach logs.
- **`apps/web`:** minimal Next.js UI on `127.0.0.1:3000` — onboarding with
  the required data-transmission and availability disclosures, login, the
  task queue with cancel/retry/run history, dispatch-resume review, and
  settings for the DPAPI-protected OpenAI key and execution limits.

`packages/ui` is intentionally absent: nothing is shared enough to justify it
yet. It will be created when a slice actually reuses components.

## Setup and running

Requires Windows (DPAPI), Node.js 24+ (`24` line; 26 works), and pnpm 10
(`npm install -g pnpm@10.34.7` or your usual install).

```bash
pnpm install          # installs all workspace dependencies
pnpm build            # builds all packages and the web app (do this first)
pnpm lint             # eslint across the workspace
pnpm test             # vitest in every package (93 tests; includes real
                      #   DPAPI round-trips on Windows)
pnpm dev              # API on 127.0.0.1:8787 and web on 127.0.0.1:3000
```

Day-to-day use after `pnpm dev`: open `http://127.0.0.1:3000`, complete
onboarding (owner password), and optionally store your OpenAI key in Settings.
API ports and origins are configurable through `OPENFROST_API_PORT` and
`OPENFROST_WEB_ORIGIN`. All local data lives under `%USERPROFILE%\.openfrost`.

CI runs the same `pnpm lint && pnpm test && pnpm build` on `windows-latest`.

## Repository layout

```text
apps/web                 Local assistant/task UI (Next.js App Router)
apps/api                 Fastify API on loopback: auth, SSE, task worker
packages/domain          Shared Zod contracts (source of truth)
packages/db              better-sqlite3 + Drizzle, migrations, DPAPI secrets
packages/agent           Bounded single-run executor + provider seam
docs/ai-os-project-spec.md   Accepted product specification
docs/product-one-pager.md    Product summary
docs/AI_DEVELOPER_GUIDE.md   Working one assigned slice at a time
backlog/solo-rebuild.md      S00–S07 acceptance criteria and handoffs
AGENTS.md / CONTRIBUTING.md  Engineering, security, and landing workflow
```

## Build plan and contributor guidance

- [Solo backlog](backlog/solo-rebuild.md): S00–S07, ordered by dependencies.
- [Delivery order](backlog/README.md): the current plan.
- [Agent instructions](AGENTS.md): architecture, security, and scope constraints.
- [Developer guide](docs/AI_DEVELOPER_GUIDE.md): working one slice at a time.
- [Contributing](CONTRIBUTING.md): branch, verification, and review conventions.

The next assigned slice is **S02: the research-brief vertical slice** — one
configured OpenAI model, provider-backed web search, and bounded public page
retrieval. Implement only the assigned slice, never real credentials in
`.env`, prompts, or repository files; the credential flow uses DPAPI.
