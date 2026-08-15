---
num: 018
title: "P0 — Approval inbox API + approve/reject flow + high-risk gating"
owner: AGENT
area: agent
labels: [P0, area:agent, area:security]
iteration: "Iteration 2"
depends_on: [017]
---

## Context
The approval pipeline behind every side-effecting action (spec §6). API layer only — UI (#019) and Telegram buttons (#020) consume it.

## Scope
- `Approval` entity lifecycle: pending → approved | rejected | expired | auto-approved.
- Endpoints: `GET /api/approvals` (inbox, filters), `POST /api/approvals/:id/decision` (approve/reject with optional note).
- Risk enforcement: `local`-class approvals **require** the web dashboard session (never resolvable from Telegram — #020 must enforce).
- Auto-approve: `auto`-class calls recorded without prompting. Expiry: pending approvals older than X min expire with a visible event.
- Webhook-ish event emission to #012 hub (`approval.pending`, `approval.resolved`) so the UI badge updates.

## Acceptance criteria
- [ ] Full lifecycle flows: class auto/telegram/local each reach the right decision path.
- [ ] Sending a `decision` for `local` class from a non-dashboard client is rejected.
- [ ] Approval expiry produces an Event and unfreezes the queued run with a clear message.
- [ ] Race test: approve + reject in parallel → exactly one outcome persisted.