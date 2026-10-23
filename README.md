# OpenFrost — Personal AI Operating System

> One personal AI agent that turns requests and recurring responsibilities into
> completed work, with useful memory, visible progress, and owner control.

**Status: specification only. No implementation exists yet.**

OpenFrost is a solo project owned by ParasRana1729. There are no application
sources, package manifests, dependencies, tests, or CI workflows in this baseline.
Everything described as a product capability below is planned, not implemented.

## The new direction

Keep the “AI OS” vision: a foundation for context, tasks, tools, memory, permissions,
and background execution. Start with **one assistant**, **projects for context**,
and **one local web interface**, rather than separate AI personalities.

The first release targets three useful jobs:

| Workflow | Result |
| --- | --- |
| Research brief | A saved comparison and recommendation, with sources and uncertainties. |
| Project update | An evidence-backed summary of granted project notes, blockers, and next steps. |
| Weekly planning | An owner-scheduled draft of priorities from project notes and recent updates. |

The target runtime is Windows-first and local, using SQLite + Drizzle, editable
Markdown memory, and the owner's OpenAI API key protected with Windows DPAPI.
Local-first does not mean offline: selected context is sent to the model/search
provider. The PC must be awake and the runtime running; work can continue after
the browser closes, but not while the PC is off.

Tools will start with public web research, granted-folder reads, and approved
export of new reports. No arbitrary shell, browser/OS computer use, Telegram,
agent teams, cloud workers, or plugin marketplace in v0.1.

See the [product one-pager](docs/product-one-pager.md) and
[full specification](docs/ai-os-project-spec.md) for the accepted scope and release
gates. These describe planned behavior, not current capabilities.

## Repository layout

The current repository contains only the approved plan and development guidance:

```text
README.md                       Current state and starting point
AGENTS.md                        Primary engineering and agent instructions
CLAUDE.md                        Pointer to the authoritative instructions
CONTRIBUTING.md                  Solo contribution and verification workflow
docs/ai-os-project-spec.md       Accepted product specification
docs/product-one-pager.md        Product summary
docs/AI_DEVELOPER_GUIDE.md        Working one assigned slice at a time
backlog/README.md                Delivery order
backlog/solo-rebuild.md          S00–S07 acceptance criteria
```

Small Git hygiene files and editor-specific pointers accompany these documents.
The application/package layout in the spec is a target to create, not a map of
code that already exists.

## Begin implementation

Assign **S01: the minimal local task foundation** from the solo backlog. Its first
step is to create the minimal pnpm workspace, pin the development toolchain, and
define the lint/test/build scripts. There are no working install, start, or test
commands yet; do not claim otherwise.

After that foundation, **S02** delivers the first real research brief. Implement
only the assigned slice, not the entire plan at once. Never place real credentials
in `.env`, prompts, or repository files; the planned credential flow uses DPAPI.

## Build plan and contributor guidance

- [Solo backlog](backlog/solo-rebuild.md): S00–S07, ordered by dependencies.
- [Delivery order](backlog/README.md): the current plan.
- [Agent instructions](AGENTS.md): architecture, security, and scope constraints.
- [Developer guide](docs/AI_DEVELOPER_GUIDE.md): working one slice at a time.
- [Contributing](CONTRIBUTING.md): branch, verification, and review conventions.

Agents should use these files as their context, verify the actual repository
state, and report evidence rather than treating a plan as completed work.
