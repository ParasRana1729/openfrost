---
num: 007
title: "P0 — Domain schema & shared Zod contracts (User, Workspace, Conversation, Message, Event, Approval, Schedule, AgentRun, MemoryRecord)"
owner: AGENT
area: agent
labels: [P0, area:agent]
iteration: "Iteration 0"
depends_on: [006]
---

## Context
Single source of truth for the data shapes every app shares (spec §5). Define entities + enums + Zod schemas in `packages/domain`; this is the API contract for the whole MVP. Zero behaviour here — just types & validation.

## Entities
- Workspace (template, instructions, persona, model override, capability toggles, allowed folder roots, telegramAllowed)
- Conversation (named, per-workspace)
- Message (channel: web|telegram, status, isDelayed)
- Event (type, payload, timestamp — immutable audit row)
- Approval (riskClass: auto|telegram|local, state, outcome)
- Schedule (cron, workspaceId, pending state)
- AgentRun (workspaceId, status: running|queued|done|failed|interrupted)
- MemoryRecord (workspaceId, scope: workspace|general, promoted flag)

## Acceptance criteria
- [ ] All entities exported from `packages/domain` with Zod schemas + TS types.
- [ ] Enums match the permission classes and high-risk baseline in spec §6.
- [ ] Unit tests: each schema rejects obviously invalid payloads.
- [ ] Drizzle table definitions in `packages/db` are generated from these types (not duplicated by hand).