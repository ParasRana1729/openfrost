---
num: 019
title: "P0 — Approval UI: inbox, approve/reject, high-risk local-only enforcement"
owner: UI
area: ui
labels: [P0, area:ui, area:security]
iteration: "Iteration 2"
depends_on: [008, 018]
---

## Context
The Control Center is the trust surface: the user reviews exactly what the assistant wants to do, with full context, and clicks approve or reject. High-risk items must be visibly gated to this dashboard (spec §6).

## Scope
- Inbox route with live updates (badge in header via #012 events): pending approvals with action preview, workspace, risk class badge (auto/telegram/local), diff of proposed change.
- Approve / reject / cancel-with-note actions; optimistic UI + rollback on failure.
- High-risk (`local`) cards: prominent styling, blocked-with-reason if the session is not a dashboard session.
- History view: resolved approvals (approved/rejected/expired) as Events.

## Acceptance criteria
- [ ] New `approval.pending` → badge updates within 1s; card expands with full context.
- [ ] Reject passes the note to the agent, which replies acknowledging the reject.
- [ ] Expired approvals move to history with reason "expired".
- [ ] Any request to approve a `local` item from a non-dashboard context is blocked and shown red.