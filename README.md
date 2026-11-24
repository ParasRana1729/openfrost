# OpenFrost

**A Windows-first local AI assistant for research, project updates, and weekly
planning.**

OpenFrost turns requests and confirmed schedules into saved, reviewable work.
One assistant handles the workflows; projects scope source folders and approved
context. The local terminal UI (TUI) shows tasks, progress, results, memory,
and approval requests.

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

- The API binds strictly to `127.0.0.1` loopback for single-user local access.
  Local auth (passwords, sessions, CSRF, and login screens) is removed: non-browser
  clients like the TUI connect directly over loopback, while browser clients are
  strictly guarded by an Origin check (foreign origins are rejected with 403).
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
- Rust (stable) for the TUI Control Center

Install pnpm if needed:

```sh
npm install --global pnpm@10.34.7
```

### Install and run (recommended)

From the repository root, install dependencies once and install the `openfrost` CLI:

```powershell
pnpm install
pnpm run install:cli
```

(`.\scripts\install.ps1` builds the local API, records its path in
`%USERPROFILE%\.openfrost\runtime.json`, and installs `openfrost.exe` to your
Cargo `bin` directory.)

To update an existing install later, run `openfrost update` (see
[Updating](#updating) below) instead of repeating these steps.

Then launch the Control Center from any terminal:

```sh
openfrost
```

`openfrost` checks whether the local API is running on `127.0.0.1:8787`, starts
it in the background if needed, and opens the TUI. Closing the TUI leaves the
local API running so queued tasks and routines can finish. Useful lifecycle
commands:

```sh
openfrost status        # check local API health, PID, and log path
openfrost stop          # stop the background API started by openfrost
openfrost logs -n 100   # print recent background API logs
openfrost --no-spawn    # attach to an already-running API (e.g. `pnpm dev`)
```

### Updating

```sh
openfrost update --check   # report whether a newer version is available
openfrost update           # pull, rebuild, and reinstall
```

`openfrost update` fast-forwards the source checkout the CLI was installed from
(recorded as `repoRoot` in `%USERPROFILE%\.openfrost\runtime.json`) on whatever
branch it has checked out (use `main` for releases), then runs
`pnpm install --frozen-lockfile` and `scripts/install.ps1`. If the background API
was running, it is stopped for the rebuild and restarted afterwards. Notes:

- It refuses to run if the checkout has uncommitted changes to tracked files, or
  if the branch has no upstream.
- If already up to date it does nothing; run `pnpm run install:cli` to force a
  rebuild.
- The apply step is Windows-only for now (`--check` works anywhere). On Windows
  the running `openfrost.exe` is renamed to `openfrost.exe.old` so Cargo can
  replace it; the leftover is deleted on the next update.
- If the CLI can't find the checkout (stale or missing `runtime.json`), run
  `.\scripts\install.ps1` once from your repo, then retry.

### Run from source (development)

If you want hot-reload while developing the API or landing page:

```sh
pnpm install
pnpm build
pnpm dev
```

Then attach the TUI in another terminal without auto-spawning a second API:

```sh
cargo run --manifest-path apps/tui/Cargo.toml -- --no-spawn
```

Launch the TUI, then choose a provider and add its key in **Settings** (no
local account creation or login is required). The API listens on
`127.0.0.1:8787`; the TUI talks to that API directly. The static landing page
(`apps/landing`) runs on port 3001 during development.

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
- `runtime.json`, `api.pid`, and `logs\api.log` — local CLI runtime path,
  managed background API PID, and background API logs

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
On Windows, database tests also exercise real DPAPI round-trips. The TUI has
its own Rust test suite (`cargo test` in `apps/tui` or workspace-wide), also
free of paid calls. GitHub Actions runs the TypeScript and Rust checks on
`windows-latest`.

## Current limitations

- The one-working-week real-use evaluation remains open.
- Other locally configured NAT64 prefixes are not discovered automatically.
- Project deletion is not implemented.
- Memory retrieval uses file order within a fixed 6,000-character budget; it
  does not rank entries by relevance.
- There are no automated browser-based UI tests yet.

## Product site

The static marketing and source page lives in `apps/landing`. It runs on port
3001 during development (`pnpm --filter @openfrost/landing dev`) and exports
static files into `apps/landing/out` on build. The product has no packaged
Windows installer yet; the site links to the repository until one is published.
Set the canonical site URL before deployment so Open Graph links point at the
published domain.

## Repository map

```text
apps/tui                 Rust / Ratatui + Crossterm terminal Control Center
apps/landing             Static product and source landing page
apps/api                 Fastify loopback API and task worker
packages/domain          Shared Zod contracts
packages/db              SQLite, Drizzle migrations, DPAPI secret storage
packages/agent           Provider adapters, execution loop, bounded tools
docs/                    Product specification and developer guide
backlog/                  S00–S09 plan, acceptance criteria, and handoffs
```

## Project docs

- [Product one-pager](docs/product-one-pager.md)
- [Product specification](docs/ai-os-project-spec.md)
- [S00–S09 backlog](backlog/solo-rebuild.md)
- [Developer guide](docs/AI_DEVELOPER_GUIDE.md)
- [Contributing](CONTRIBUTING.md)
- [Engineering and security guidance](AGENTS.md)
