# OpenFrost — AI Operating System

## Solo rebuild specification — v0.1

- **Status:** Accepted product direction; implementation pending
- **Owner and first user:** ParasRana1729
- **Platform:** Windows-first, local runtime
- **Primary interface:** Local web app

**Repository state: S02 research brief implemented.** The workspace, shared
Zod contracts, SQLite persistence, DPAPI secret storage, authenticated loopback
API/UI, bounded single-run executor, and the research-brief workflow (OpenAI
via the Responses API, hosted web search, an SSRF-hardened fetch tool, saved
Markdown reports) exist and are covered by CI. Project updates and weekly
planning are not implemented yet: capabilities below that depend on them are
requirements to implement, not existing functionality. The
[solo backlog](../backlog/solo-rebuild.md) is the delivery plan and per-slice
progress record.

## 1. Product promise

> OpenFrost is a personal AI agent that turns requests and recurring
> responsibilities into completed work, using the files and tools its owner
> explicitly grants. It remembers useful context, reports its progress, and brings
> consequential decisions back to the owner.

“AI OS” describes the foundation: context, tasks, tools, memory, permissions, and
background execution. It does not mean replacing Windows or building a platform
of separate chatbot personalities.

The first release is for the builder's own daily use. Success is three useful,
repeatable workflows, not parity with a general-purpose agent product.

### Inspiration, not a feature checklist

[Grok Bot](https://docs.x.ai/grok-bot) and
[OpenAI dots](https://openai.com/index/introducing-dots/) demonstrate persistent
assistants, multi-step work, background execution, and human checkpoints. Borrow
that interaction model, not their cloud computers, connector catalogs, or agent
teams.

OpenFrost runs only while the PC is awake and its runtime is running. Closing the
browser does not stop the runtime; sleeping or shutting down the PC does. There
is no cloud failover or promise of uninterrupted 24/7 execution.

## 2. Decisions

| Topic | v0.1 decision |
| --- | --- |
| Builder and audience | One owner; build for personal usefulness before other users. |
| Assistant | One persistent assistant; projects organize context, not personalities. |
| Interface | Local web app for conversation, tasks, results, memory, and approvals. |
| Hosting | Native Windows runtime; no Docker, cloud database, or hosted worker. |
| Models | OpenAI API with the owner's API key; one provider and one configured model initially. |
| First workflows | Research briefs, project updates, weekly planning. |
| Execution | One active agent run globally; additional tasks queue visibly. |
| Tools | Public web search/fetch, granted-folder reads, and narrowly scoped report export. |
| Proactivity | Only explicit tasks and owner-created routines; no self-assigned work. |
| Memory | Owner-approved preferences and project facts, visible and editable. |
| Remote access | Deferred; no Telegram requirement for v0.1. |
| Delivery | Sequential vertical slices with acceptance gates; no fixed delivery dates. |

Local-first does **not** mean offline or that data never leaves the PC. Selected
prompts, source excerpts, and context go to the configured model/search provider.
Onboarding must explain this before the first request. No cloud database or
OpenFrost-hosted account is needed.

## 3. The three workflows

These are starter defaults for the owner's use, not three separate agents.

### A. Research brief — the first end-to-end slice

**Request:** “Compare these three options against my requirements and save a
recommendation with sources.”

- Accept a question, constraints, and optional starting URLs.
- Search the public web and fetch relevant public pages through fixed tools.
- Produce a saved Markdown report with a comparison, recommendation, source URLs,
  retrieval times, uncertainties, and unanswered questions.
- Distinguish source-backed statements from inference. Inaccessible pages and
  insufficient evidence must be visible; do not invent citations.
- Retain the task and report after a restart. Exporting to a user folder is a
  separate, approved action, not a requirement for the first internal report.

**Done when:** the owner can make a real decision from the saved report and open
its cited sources without reconstructing the research themselves.

### B. Project update

**Request:** “Read this project's notes and prepare a progress update with open
questions and suggested next steps.”

- The owner creates a project and explicitly grants a folder root.
- Read a bounded set of supported text/Markdown files; no shell or repository
  mutation is necessary. Show which files were used and which were skipped.
- Produce a dated update separating documented progress, stated blockers,
  unknowns, and proposed next steps. Cite file paths and relevant excerpts.
- Treat notes as evidence, not proof that a feature shipped or a test passed.
- Save the update internally; offer an approved export without altering sources.

**Done when:** the update is useful for reviewing the project and contains no
unsupported completion claims or material from another project's context.

### C. Weekly planning

**Request:** “Every Friday, review this project's notes and recent updates, then
draft next week's priorities.”

- The owner chooses the project, local time zone, cadence, and source scope, then
  confirms the routine before it is enabled.
- Run the same bounded task machinery used for manual work.
- Draft priorities, unresolved questions, and suggested next steps with links to
  the notes/updates used. The owner decides what to commit to.
- Put results and failures in the web app; no email/calendar integration or
  external notification is required.
- If the PC/runtime was unavailable, show one missed occurrence per routine for
  review. Offer “run once now” or “skip”; never replay a backlog automatically.

**Done when:** a routine runs without an open browser, survives a runtime restart,
and handles a missed run without duplicate work.

## 4. Product experience and context

The app has four primary areas, not an OS-style app launcher:

1. **Assistant:** conversation and clear handoff of a request into a task.
2. **Tasks:** queue, progress, approvals, failures, and saved results.
3. **Projects:** notes, granted source folders, related conversations and tasks.
4. **Settings:** model credentials, preferences, memory, and routine controls.

An initial research task needs no project. A project-scoped task uses that
project's instructions, attached sources, relevant conversation, and approved
memory, plus owner-approved global preferences. It must not automatically include
other projects' chats, files, or facts. Cross-project use requires explicit
attachment by the owner.

There is one assistant identity. Do not add Coding/Learning/General personas,
per-project model selectors, or a coordinating agent in v0.1.

### Memory

- Separate conversation history from long-term memory.
- Start with explicit preferences and project facts; no vector database required.
- The assistant may propose a memory, but the owner confirms it before it becomes
  durable context. Each memory has scope, source, and last-updated information.
- The owner can inspect, edit, and delete memories. Deleting a memory removes it
  from future memory retrieval; it does not silently delete source conversations
  or reports. Explain that distinction in the UI.

## 5. Task execution and reliability

Shared contracts live in `packages/domain` as Zod schemas with inferred
TypeScript types:

| Entity | Responsibility |
| --- | --- |
| User | Single local owner and authenticated session. |
| Assistant settings | One assistant identity, configured model, and execution limits. |
| Project | Context scope, instructions, and explicitly granted folder roots. |
| Conversation / Message | Persistent dialogue, optionally scoped to a project. |
| Task | Requested outcome, source scope, state, and result references. |
| AgentRun | One execution attempt, usage, timestamps, limits, and failure details. |
| Artifact | Saved report, its source references, and optional export metadata. |
| Event | Append-only application activity for task and approval history. |
| Approval | Exact proposed action, risk tier, expiry, and owner decision. |
| MemoryRecord | Owner-approved context with scope and provenance. |
| Routine | Owner-confirmed task template, schedule, time zone, and last occurrence. |

Task states: `queued`, `running`, `awaiting_approval`, `completed`, `failed`,
`canceled`, and `interrupted`. A task may have multiple explicitly initiated run
attempts; retry history must remain visible.

- One run owns the executor at a time, including while awaiting approval. Other
  tasks remain queued; the owner can reject/cancel a blocked task.
- Persist the task before execution and record tool calls, results, approvals,
  and failures. Events summarize observable work, not private model reasoning.
- Set finite tool-step, input-size, token, and wall-clock limits. Stop with a clear
  result when a limit is reached. Show token usage and estimated cost when pricing
  is known; label unavailable estimates rather than inventing them.
- Cancellation prevents further calls and attempts to abort in-flight requests.
  It does not undo an action already completed; show that outcome honestly.
- On restart, mark unfinished active runs `interrupted`, retain queued work, and
  pause dispatch until the owner reviews recovery. Never blindly replay writes.
  A restart that finds no unfinished runs may resume dispatch immediately;
  retaining queued work is not, by itself, a pause condition.
- Deduplicate routine occurrences and retried action requests. An unknown write
  outcome requires reconciliation, not an automatic repeat.

## 6. Security and approval boundary

The first tools are deliberately narrow. Arbitrary shell commands, browser
computer use, deletion, overwrites, account actions, and credential changes are
not assistant capabilities in v0.1.

Use three risk identifiers; do not collapse them into a single
“allow tools” switch:

| Identifier | Meaning | v0.1 behavior |
| --- | --- | --- |
| `auto` | Bounded authorized reads and planning. | Run and log; includes app-managed task/result storage, not arbitrary user-file writes. |
| `telegram` | Standard, reviewable writes; the identifier does not imply a remote interface. | Approve/reject in the local web app; initially only exporting a new report inside a granted destination. No Telegram service is required. |
| `local` | High-risk changes such as overwrite/delete, system or credential changes. | Requires local Control Center authorization if supported in future; these tools remain disabled in v0.1. |

Approval cannot turn an out-of-scope action into a permitted action.

- **Local app:** bind UI and API to loopback. Require owner authentication,
  authenticated event streams, origin validation, and CSRF protection for
  state-changing operations. A local website is not a trusted client merely
  because it runs in the browser.
- **Secrets:** use Windows DPAPI-backed encryption for API keys. Decrypt only for
  the signed-in owner when needed. Never expose plaintext in configuration files,
  committed `.env` files, logs, reports, prompts, or memory. Passwords are hashed,
  not reversibly stored. Do not treat generic crypto or a keychain wrapper as
  proof that DPAPI protection is implemented.
- **Files:** the owner grants source and export roots explicitly. Canonicalize
  paths and account for symlinks/junctions; reject traversal and escapes.
  Exclude credential/configuration stores and unsupported/binary files. Bound
  reads and revalidate permissions at execution. Checks are an application
  boundary, not an OS sandbox.
- **Web:** allow public HTTP(S) retrieval through dedicated tools only. Block
  loopback, private/link-local networks, local-file URLs, credential-bearing URLs,
  and cloud metadata endpoints; revalidate DNS targets and redirects. Bound
  request duration, redirects, and response size.
- **Untrusted content:** web pages and project files are data, not instructions
  that can grant tools, change scope, access secrets, or approve actions.
- **Action review:** display destination, exact proposed content, and risk. Bind
  approval to immutable action arguments and a run; changed content, expired
  approvals, cancellation, revoked access, and duplicate decisions cannot execute
  the action. Recheck authorization immediately before writing.

## 7. Minimal local architecture

Build with strict TypeScript and pnpm. The paths below are the layout as of S01,
except `packages/ui`, which is created only when a slice justifies shared
components:

```text
apps/web           Next.js / React: local assistant and task UI
apps/api           Fastify: auth, API, SSE, one task worker, routine tick
packages/domain    Shared Zod contracts (source of truth)
packages/db        better-sqlite3 + Drizzle, migrations, DPAPI integration
packages/agent     AI SDK loop, OpenAI adapter, bounded tools, policy enforcement
packages/ui        Shared components only where actually reused
```

Use a SQLite-backed queue within the local API runtime. No separate message
broker, scheduler service, or vector database. The API continues work when the
browser closes. Do not add standalone Telegram, daemon, or CLI services to v0.1.

### Storage ownership

```text
%USERPROFILE%\.openfrost\
  config.json               non-secret settings
  secrets\                  DPAPI-encrypted provider credentials
  db\openfrost.db            canonical chats, tasks, runs, events, approvals,
                            artifact bodies/metadata, routines, memory metadata
  memory\owner.md            canonical approved global memory content
  projects\<project-id>\
    instructions.md         canonical project instructions
    memory.md               canonical approved project memory content
```

Granted source/export folders stay where the owner put them. Never move or scan
the user's whole home directory automatically. SQLite holds memory metadata and
may hold rebuildable search indexes; Markdown is the source of truth for memory
content, not a second competing copy. Detect external Markdown changes before
overwriting them. Generated reports are canonical SQLite artifacts until the
owner exports a copy.

Once storage is implemented, use migrations for schema changes. Never delete or
reset user data implicitly during setup, upgrades, or recovery.

## 8. Explicit non-goals for v0.1

- Multiple assistants, agent teams, separate workspace personas, or multi-user accounts.
- Telegram/mobile/native desktop clients and remote access.
- Cloud computers, hosted workers, Docker/VPS deployment, or cloud databases.
- Arbitrary terminal execution, coding-agent workflows, or OS/browser computer use.
- Managed browser profiles, authenticated-site automation, or demonstration recording.
- Email, calendars, payments, external publishing, or broad connector catalogs.
- A plugin marketplace, untrusted scripts, MCP integrations, or a workflow builder.
- Voice, avatars, local model hosting, vector search, or multiple model providers.
- Self-directed proactive work, automatic sign-in installation, or a backup subsystem.

## 9. Delivery and release gates

The active [backlog](../backlog/solo-rebuild.md) assigns all work to the owner.
Build one slice at a time; no delivery dates are implied.

1. **S00 — Clean baseline:** this spec, one-pager, repository guidance, and delivery plan.
2. **S01 — Local foundation:** workspace/toolchain, contracts, persistence, auth, DPAPI, bounded execution.
3. **S02 — Research brief:** first useful request-to-saved-report workflow.
4. **S03 — Projects:** granted-folder context and evidence-backed project updates.
5. **S04 — Reviewable export:** approvals and safe report export.
6. **S05 — Memory:** editable, owner-approved preferences and project facts.
7. **S06 — Weekly planning:** confirmed routines, missed handling, and deduplication.
8. **S07 — Release hardening:** Windows setup, recovery tests, and real-use evaluation.

Release v0.1 only when:

- All three workflows produce useful saved artifacts on representative real tasks.
- Source links/excerpts are inspectable, and missing evidence is reported honestly.
- Two projects cannot accidentally contribute context to each other's tasks.
- Export approval, rejection, expiry, cancellation, and boundary checks are tested.
- Conversations, reports, settings, and approved memory survive restarts; interrupted
  tasks and missed routines are recoverable without duplicate writes.
- Closing the browser does not stop a running task or a scheduled routine.
- The owner has used the workflows across one working week and recorded what was
  useful, what needed correction, and the resulting scope decisions.
- `pnpm lint && pnpm test && pnpm build` passes, alongside the Windows workflow
  and security checks in S07. S01 must first create these scripts; passing tests
  alone is not release proof.
