---

# OpenFrost — GitHub Backlog (import-ready)

This folder is the single source for the MVP issue list. Each `###-*.md` file is one
GitHub issue: front-matter for metadata, body = the issue description.

- Fixed order by `num` (dependency order for **Iteration 0**).
- One **primary owner** per issue (single point of accountability); cross-cutting work is noted in the body + `depends_on`.

## Issue metadata

| Field | Meaning |
|---|---|
| `num` | Sequence number. |
| `title` | Issue title (P0/P1 priority + short summary). |
| `owner` | Role unit: `LEADER`, `PLATFORM`, `AGENT`, `UI`. |
| `area` | Function: `product`, `platform`, `agent`, `ui`, `security`. |
| `labels` | GitHub labels to apply. |
| `iteration` | Milestone: `Iteration 0..3`. |
| `depends_on` | `num`s that should be closed/merged first. |

## Labels to create (see issue 002)
`P0`, `P1`, `area:product`, `area:platform`, `area:agent`, `area:ui`, `area:security`,
`type:feature`, `type:bug`, `type:task`, `type:adr`.

## Roles → GitHub handles
Fill real logins in `scripts/team.json` before importing (used by `scripts/import-issues.ps1`).

| Role | GitHub handle |
|---|---|
| `LEADER` | *(replace)* |
| `PLATFORM` | *(replace)* |
| `AGENT` | *(replace)* |
| `UI` | *(replace)* |

## Import (after GitHub CLI is installed + the repo exists)
```powershell
# 1. fill scripts/team.json with real GitHub logins
# 2. from repo root
powershell -ExecutionPolicy Bypass -File scripts/import-issues.ps1 -Repo owner/openfrost -DryRun
powershell -ExecutionPolicy Bypass -File scripts/import-issues.ps1 -Repo owner/openfrost
```
Add `-All` to import every issue; by default it imports only those whose `depends_on`
are already satisfied (dependencies-first), so re-running is safe in iteration order.

## Iterations
- **I0** — Foundations: 001–006 (platform), 007–008.
- **I1** — Chats & workspaces: 009–016.
- **I2** — Actions & approvals: 017–022.
- **I3** — Browser, scheduler, delivery: 023–028.

See [`docs/ai-os-project-spec.md`](../docs/ai-os-project-spec.md) for the full spec.