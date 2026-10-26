# OpenFrost — Personal AI Operating System

> One personal AI agent that turns requests and recurring responsibilities into
> completed work, with useful memory, visible progress, and owner control.

**Status: S00–S06 are implemented on `main`; S07 release validation is in
progress.**

OpenFrost is a solo project owned by ParasRana1729. What ships today is the S01
foundation plus the S02 research-brief workflow, the S03 project-update
workflow, S04 approval-bound export (granted destinations, exact-proposal
review, create-only writes), S05 owner-approved memory, and S06 weekly planning.
With a provider key stored in Settings (OpenAI, Gemini, or OpenRouter), a
submitted question (with optional
constraints and starting URLs) runs as a bounded agent task — provider-backed
web search plus a hardened public-page fetch — and saves a Markdown report with
sources, retrieval times, uncertainties, and a runtime-recorded retrieval
appendix. Projects organize context: create one, grant it folder roots
explicitly, and scope tasks to it — a project update reads only that project's
granted text/Markdown notes (canonical-path checks, credential-store
exclusions, bounded counts/sizes, skipped sources visible) and saves a dated,
evidence-backed update citing file paths and excerpts. Saved reports can be
exported as **new** Markdown files into an owner-granted destination — but only
after the owner approves the exact proposal (destination, filename, content
hash) in the web app; the write is revalidated at execution and never
overwrites. The assistant can propose durable memory during a task, but nothing
enters future context until the owner approves it on the Memory page: global
preferences for every task plus only the active project's facts. Canonical
memory is Markdown, edits and deletions take effect for future retrieval, and
deleting an entry keeps the source task and report history. Weekly planning
routines draft next week's priorities from a project's granted notes and its
two most recent saved updates on the owner's confirmed schedule; the runtime
runs them without an open browser, deduplicates occurrences across restarts,
clock changes, and DST, and surfaces one missed occurrence for review (run
once now / skip) instead of replaying a backlog.

S07 pre-week validation was performed on 2026-10-26; the owner's
one-working-week evaluation remains open. The S07 follow-up in
[PR #28](https://github.com/ParasRana1729/openfrost/pull/28) adds provider-key
redaction and NAT64 hardening; this follow-up does not close S07.

## The direction

Keep the “AI OS” vision: a foundation for context, tasks, tools, memory,
permissions, and background execution. Start with **one assistant**,
**projects for context**, and **one local web interface**, rather than
separate AI personalities.

The first release targets three useful jobs:

| Workflow | Result | Status |
| --- | --- | --- |
| Research brief | A saved comparison and recommendation, with sources and uncertainties. | **Works** (S02) — real-model quality pending the owner's evaluation |
| Project update | An evidence-backed summary of granted project notes, blockers, and next steps. | **Works** (S03) — real-model quality pending the owner's evaluation |
| Report export | An approved copy of a saved report written into a granted folder. | **Works** (S04) — approve/reject exercised live 2026-10-26 |
| Weekly planning | An owner-scheduled draft of priorities from project notes and recent updates. | **Works** (S06) — real-model run 2026-10-26 (free model) |

The runtime is Windows-first and local, using SQLite + Drizzle, editable
Markdown memory, and the owner's provider API keys (OpenAI, Gemini, or
OpenRouter) protected with Windows DPAPI.
Local-first does not mean offline: selected context is sent to the model/search
provider. The PC must be awake and the runtime running; work can continue after
the browser closes, but not while the PC is off.

Tools will start with public web research, granted-folder reads, approved
export of new reports, and memory proposals. No arbitrary shell, browser/OS
computer use, Telegram, agent teams, cloud workers, or plugin marketplace in
v0.1.

See the [product one-pager](docs/product-one-pager.md) and
[full specification](docs/ai-os-project-spec.md) for the accepted scope and
release gates. They describe planned behavior; the table above tracks what is
real today.

## What is implemented (S01–S06)

- **Workspace and toolchain:** pnpm workspace with Node 24 LTS
  (`.nvmrc`; engines allow 24–26) and pnpm pinned in `packageManager`.
  `pnpm lint && pnpm test && pnpm build` are the required checks and run on
  `windows-latest` in GitHub Actions.
- **`packages/domain`:** Zod contracts for tasks, agent runs, conversations,
  messages, artifacts, append-only events, risk tiers, execution limits,
  settings, and owner-approved memory (entries, proposals, snapshots, Markdown
  block format), with enforced task/run state-transition maps.
- **`packages/db`:** SQLite + Drizzle migrations under
  `%USERPROFILE%\.openfrost\db\openfrost.db` (owner override:
  `OPENFROST_HOME`). Data survives restarts; migrations never reset it.
  Provider keys are sealed with real Windows DPAPI
  (CryptProtectData/CryptUnprotectData, CurrentUser scope) and fail closed
  off Windows. Approved memory content lives in canonical Markdown under
  `memory\owner.md` and `projects\<id>\memory.md`; SQLite keeps pending
  proposals and rebuildable metadata indexes, not a second content copy.
- **`packages/agent`** — one global executor; one run at a time, finite
  step/wall-clock/input/output limits, cancellation, explicit retries with
  visible attempt history, and restart recovery that marks unfinished runs
  `interrupted` and pauses dispatch for owner review. S02 adds the research
  loop: provider adapters — OpenAI (Responses API with hosted web search
  and `url` citations), Gemini (generateContent with Google Search
  grounding surfaced as citations), and OpenRouter (chat completions with
  the hosted `web` plugin surfaced as `url_citation` citations) — an SSRF-hardened `fetch_page` tool (scheme/credential/host
  deny lists, per-address DNS validation re-checked at every connection, full
  redirect re-validation, size/time bounds), a policy system prompt that
  treats retrieved content as untrusted data, and a runtime-recorded
  retrieval appendix. S03 adds the project-update loop: a `read_project_file`
  tool bound to the task's project that re-reads the owner's grants at every
  execution (revocation — including of queued tasks — and junction/symlink
  escapes fail closed), canonical-path checks, credential-store exclusions,
  bounded file counts/sizes/types with skipped sources visible, a policy that
  separates documented progress / stated blockers / unknowns / proposed next
  steps and treats notes as claims rather than proof of shipping, and a
  runtime-recorded file appendix. S04 adds the one narrow write: an export
  task that proposes the exact file write (artifact hash, canonical
  destination, safe filename), parks in `awaiting_approval` while the owner
  reviews it in the web app, and on approval revalidates everything before a
  single create-only write — refusals, rejections, expiries, and restarts are
  always visible and never replayed. S05 adds owner-approved memory: a
  `propose_memory` tool is available to every model-backed run (bounded,
  duplicate- and credential-refusing), and task prompts receive only approved
  global preferences plus the active project's facts from Markdown, never
  pending proposals or another project's entries. A deterministic fake provider covers all
  of this in tests — no paid API calls anywhere in CI. S06 adds the weekly-plan
  loop: routine occurrences dispatch `weekly_plan` tasks from the owner's
  reviewed template (project scope, IANA time zone, weekly/daily schedule),
  grounded in granted notes plus the project's two most recent saved updates
  with runtime-recorded file and update appendices.
- **`apps/api`**: Fastify bound to `127.0.0.1` with first-run owner setup,
  scrypt passwords, HttpOnly SameSite=Strict sessions, session-bound CSRF
  tokens, origin allowlisting, an authenticated SSE activity stream, and
  logging that drops headers/cookies/bodies so secrets never reach logs.
  Provider configuration: `OPENFROST_OPENAI_MODEL` (default `gpt-4.1-mini`),
  `OPENFROST_GEMINI_MODEL` (default `gemini-3.8-flash`),
  `OPENFROST_OPENROUTER_MODEL` (default `openrouter/auto`); the active provider
  is chosen in Settings; `OPENFROST_PROVIDER=fake` is a documented dev/test hook that scripts a
  research run without any API key. Authenticated memory routes expose
  proposals, file state, hashes, and owner decisions; every mutation requires
  the page's current file hash and CSRF token. S06 adds the routine scheduler
  (`OPENFROST_ROUTINE_TICK_MS`, default 30 s): per active routine it examines
  only the latest occurrence at or before now — materialized local-date
  occurrence keys deduplicate across ticks, restarts, clock changes, and DST;
  occurrences within the 30-minute late grace dispatch through the global
  executor, later ones surface exactly one missed row with run-once-now/skip.
  Routines CRUD, enable/pause, and occurrence decisions ride the same
  owner-session/CSRF surface.
- **`apps/web`:** local Next.js UI on `127.0.0.1:3000` with a frost visual
  identity — a dispatch status strip, a dark runtime-console activity log, and
  mono system data — onboarding with the required data-transmission and
  availability disclosures, login, the task queue with workflow and project
  selectors, constraints/starting URLs, cancel/retry/run history, token usage
  with list-price cost estimates (labeled as estimates; unknown when no price
  is on file), markdown report/update rendering, dispatch-resume review, the
  Projects page (create/edit projects, grant/revoke folder roots with
  canonicalization, per-project transmission disclosure), the Memory page
  (pending proposals with scope/source/date and editable approval, global and
  project entries with edit/delete, external-edit warnings, reload, decision
  history), the Routines page (create-as-draft with next-occurrence preview,
  enable/pause, edit, remove, missed-occurrence review with run-once-now/skip,
  occurrence history with task outcomes), and provider
  settings — active provider (OpenAI, Gemini, or OpenRouter), per-provider
  DPAPI-protected keys and models — and execution limits.

`packages/ui` is intentionally absent: nothing is shared enough to justify it
yet. It will be created when a slice actually reuses components.

## Setup and running

Requires Windows (DPAPI), Node.js 24+ (`24` line; 26 works), and pnpm 10
(`npm install -g pnpm@10.34.7` or your usual install).

```bash
pnpm install          # installs all workspace dependencies
pnpm build            # builds all packages and the web app (do this first)
pnpm lint             # eslint across the workspace
pnpm test             # vitest in every workspace package; includes real
                      #   DPAPI round-trips on Windows
pnpm dev              # API on 127.0.0.1:8787 and web on 127.0.0.1:3000
```

**Fresh setup (first run):** start with `pnpm dev`, open
`http://127.0.0.1:3000`, create the owner account in onboarding (one owner,
password hashed with scrypt; wrong passwords are refused and unauthenticated
API access is 401 even on loopback), then store a provider key in Settings —
it is sealed with Windows DPAPI for the current user and never displayed or
logged again. Everything the app stores lives under
`%USERPROFILE%\.openfrost`: `db\openfrost.db` (tasks, runs, events,
approvals, artifacts, routines, memory metadata), `secrets\` (DPAPI-sealed
provider key blobs), `memory\owner.md` and `projects\<id>\memory.md`
(canonical approved memory, plain editable Markdown), and
`projects\<id>\instructions.md`. Nothing is reset by upgrades: schema changes
are additive Drizzle migrations applied at startup (an S05-era database
upgrades in place with all data preserved, verified with the real S05 build).
The runtime starts and stops cleanly; a hard kill marks unfinished runs
`interrupted` and pauses dispatch until you review and resume under Tasks.

**Costs and providers:** with OpenRouter as the active provider, note that
hosted web search on research briefs bills per executed search even when the
model itself is a free `:free` tier, and an account without purchased credits
will fail any brief whose run triggers search (HTTP 402, surfaced honestly).
File-grounded workflows (project updates, weekly plans) never request hosted
search. Free models are also rate-limited per day by the provider.

**Known limitations:** research briefs depend on the provider's hosted search
quality; project deletion is not implemented; markdown table cells do not
support escaped pipes; memory retrieval is file-order up to a 6,000-character
budget (no relevance ranking); no automated browser tests (manual pass each
slice); the assistant never deletes or overwrites files (exports are
create-only and approval-bound). PR #28 adds denial for private IPv4 addresses
embedded in `64:ff9b::/96`; other locally configured NAT64 prefixes are not
auto-discovered.

Day-to-day use after `pnpm dev`: open `http://127.0.0.1:3000` (or
`http://localhost:3000`) — the web app proxies API calls to the local service,
so the browser only needs port 3000 and the session cookie stays first-party on
either host. The API also listens directly on `127.0.0.1:8787` for local tools
and tests. API/proxy ports and origins are configurable through
`OPENFROST_API_PORT`, `OPENFROST_API_ORIGIN` (loopback only), and
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

The current slice is **S07: harden and validate the personal-use release**.
Pre-week validation was performed on 2026-10-26; the one-working-week log lives
in the backlog and remains open. PR #28 tracks the provider-key and NAT64
hardening follow-up. Implement only the assigned slice; never put
real credentials in `.env`, prompts, or repository files. The credential flow
uses DPAPI.
