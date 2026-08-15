---
num: 021
title: "P1 — Activity timeline / audit events API + UI"
owner: PLATFORM
area: platform
labels: [P1, area:platform]
iteration: "Iteration 2"
depends_on: [012, 018]
---

## Context
Every decision, action, result, and failure must be visible in one activity stream (spec §1, #31 #32). This is also the audit trail that makes the agent trustworthy. Event capture (Platform) + rendering (co-owned UI).

## Scope
- Immutable `Event` capture layer: a single `recordEvent` used by agent loop, tool executor (#017), approvals (#018), scheduler (#023), telegram adapter (#009). No component writes its own ad-hoc log.
- Event taxonomy/types aligned with `packages/domain` (#007).
- API: `GET /api/workspaces/:id/events` + `GET /api/events` (global) with filters (type, actor, time range) and pagination.
- UI (co-owned with UI member): timeline view grouping events per run, expandable action details (cwd, command, exit code, duration), color-coded by success/failure.

## Acceptance criteria
- [ ] Tool exec, approval decision, schedule run, agent run each produce at least one Event recorded through `recordEvent`.
- [ ] Timeline UI renders runs grouped; failures highlighted.
- [ ] Events are append-only; no UPDATE path exists.
- [ ] Filter + pagination contract tests.