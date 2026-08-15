---
num: 027
title: "P0 — End-to-end demo scenario + acceptance test"
owner: LEADER
area: product
labels: [P0, area:product]
iteration: "Iteration 3"
depends_on: [001, 005, 008, 012, 014, 017, 018, 019, 023, 024, 026]
---

## Context
The MVP demo (spec §1) is the shared definition of done. This issue turns the 7 acceptance points into a scripted, repeatable runbook the leader drives with the team — not an unplanned "let's see what works".

## Scope
- Scripted demo scenario (from spec §1):
  1. Create Coding + Learning workspaces with different personalities.
  2. Pair Telegram via one-time code; send a message to the active workspace.
  3. Chat appears in the web dashboard instantly (sync).
  4. Each assistant remembers only its own workspace context.
  5. Tool action requests approval (dashboard + Telegram buttons) and gets approved/rejected.
  6. Daemon restart preserves chats, workspaces, memory.
  7. Scheduled job runs → Telegram + activity log; a missed job prompts at next login.
- A `docs/demo-runbook.md` with exact steps and expected results per line item.
- Postmortem checklist: each failed demo point becomes a follow-up issue.

## Acceptance criteria
- [ ] All 7 demo points pass in a single 30-minute run on a clean machine.
- [ ] Runbook committed and reproducible by any member.
- [ ] Any failure produced a tracked issue with one owner before this issue closes.