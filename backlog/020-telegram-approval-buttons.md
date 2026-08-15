---
num: 020
title: "P0 — Telegram approval inline buttons (approve / reject)"
owner: AGENT
area: agent
labels: [P0, area:agent, area:security]
iteration: "Iteration 2"
depends_on: [009, 018]
---

## Context
Telegram must provide real remote approvals with inline buttons (spec §3, #11), while **high-risk (`local`) actions still require the dashboard** — a single accidental Telegram tap must never blow away files.

## Scope
- When a run pauses on `approval.pending`, send an inline keyboard: `Approve` / `Reject` with the item summary text.
- Button callback maps to the decision API; `local`-class buttons disabled with "approve in Control Center" note.
- Callback security: only the paired Telegram account may act; stale buttons expire.
- Acknowledgment message after decision (approved → "OK, continuing"; rejected → agent notes the reject).
- Wiring into the #012 hub so the dashboard inbox stays in sync when resolved from Telegram.

## Acceptance criteria
- [ ] `telegram`-class action → Telegram message with working Approve/Reject buttons.
- [ ] A `local`-class action sent to Telegram shows buttons disabled + guidance to the dashboard.
- [ ] Callbacks from unpaired/stale sessions are ignored with a debug-logged reject.
- [ ] Resolving from Telegram updates the dashboard inbox live.