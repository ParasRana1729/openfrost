# OpenFrost

**A Windows-first local AI assistant for research, project updates, and weekly
planning.**

OpenFrost turns requests and confirmed schedules into saved, reviewable work.
One assistant handles the workflows; projects scope source folders and approved
context. The local web app shows tasks, progress, results, memory, and approval
requests.

## What it does

- **Research briefs:** search the public web and save a Markdown brief with
  sources, a recommendation, retrieval details, and open questions.
- **Project updates:** read bounded text and Markdown files inside folders you
  grant, then save an evidence-backed update with blockers and proposed next
  steps.
- **Weekly planning:** run a confirmed routine using a project's granted notes
  and recent saved updates. Review missed occurrences instead of replaying a
  backlog.
- **Approved memory:** review suggested facts before they enter future context.
  Global preferences and the active project's facts remain separate.
- **Report export:** approve the exact content and destination before OpenFrost
  creates a new Markdown file in a granted folder.
- **Recoverable tasks:** tasks queue durably; one agent run executes at a time,
  with cancellation, bounded limits, and review after interrupted work.

## Project status

The core workflows are implemented. Release hardening and validation are in
progress, and the one-working-week real-use evaluation remains open. The current
implementation redacts provider keys from errors and checks IPv4 addresses
embedded in the well-known NAT64 prefix `64:ff9b::/96` against private-address
rules.

OpenFrost is an actively developed v0.1 project. Research quality depends on
the configured model and search provider. Remaining release gates are tracked
in the [backlog](backlog/solo-rebuild.md).

## Security and privacy

- The API and web app bind to loopback. Sign-in, origin checks, and CSRF
  protection guard local state changes.
- Provider keys are protected with Windows DPAPI for the current user. Store
  keys through **Settings**; they are not kept in plaintext configuration files.
- Folder access requires explicit grants. Reads are bounded and paths are
  checked against the granted root.
- Public web fetches validate addresses through DNS resolution and redirects.
  Source content is treated as untrusted data.
- Export creates a new file only after approval. OpenFrost does not overwrite or
  delete user files.
- Selected prompts, context, and source excerpts are sent to the configured
  model or search provider. Local storage does not mean offline processing.

The v0.1 scope excludes arbitrary shell access, browser or operating-system
control, remote access, and a plugin marketplace.

## Quick start

### Requirements

- Windows with Node.js 24 (the workspace accepts Node.js 24–26)
- pnpm 10.34.7

Install pnpm if needed:

```sh
npm install --global pnpm@10.34.7
```

### Run locally

From the repository root:

```sh
pnpm install
pnpm build
pnpm dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000), create the local account,
then choose a provider and add its key in **Settings**. The API listens on
`127.0.0.1:8787`; the web app listens on `127.0.0.1:3000`.

OpenRouter's hosted web search can incur charges separately from model tokens,
including when a free model is selected. Check provider pricing and account
limits before running research briefs.

## Data and configuration

By default, application data is stored in `%USERPROFILE%\.openfrost`:

- `db\openfrost.db` — tasks, runs, events, artifacts, approvals, routines, and
  indexes
- `secrets\` — DPAPI-protected provider keys
- `memory\` and `projects\` — approved Markdown memory and project
  instructions

Set `OPENFROST_HOME` to use another data directory. Database upgrades use
additive migrations and preserve existing data.

## Development checks

Run the same checks used by CI:

```sh
pnpm lint
pnpm test
pnpm build
```

Tests use Vitest and fake providers, so they do not require paid model calls.
On Windows, database tests also exercise real DPAPI round-trips. GitHub Actions
runs the checks on `windows-latest`.

## Current limitations

- The one-working-week real-use evaluation remains open.
- Other locally configured NAT64 prefixes are not discovered automatically.
- Project deletion is not implemented.
- Memory retrieval uses file order within a fixed 6,000-character budget; it
  does not rank entries by relevance.
- There are no automated browser-based UI tests yet.

## Repository map

```text
apps/web                 Next.js local web app
apps/api                 Fastify loopback API and task worker
packages/domain          Shared Zod contracts
packages/db              SQLite, Drizzle migrations, DPAPI secret storage
packages/agent           Provider adapters, execution loop, bounded tools
docs/                    Product specification and developer guide
backlog/                  S00–S07 plan, acceptance criteria, and handoffs
```

## Project docs

- [Product one-pager](docs/product-one-pager.md)
- [Product specification](docs/ai-os-project-spec.md)
- [S00–S07 backlog](backlog/solo-rebuild.md)
- [Developer guide](docs/AI_DEVELOPER_GUIDE.md)
- [Contributing](CONTRIBUTING.md)
- [Engineering and security guidance](AGENTS.md)
