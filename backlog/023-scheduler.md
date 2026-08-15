---
num: 023
title: "P1 — Scheduler: user-created recurring jobs, results to Telegram + activity log"
owner: PLATFORM
area: platform
labels: [P1, area:platform]
iteration: "Iteration 3"
depends_on: [020, 021]
---

## Context
The always-on daemon makes proactive work meaningful (spec §3, #25). Users create recurring jobs ("summarize my Coding progress at 8 PM") whose results go to Telegram and the activity log.

## Scope
- `apps/daemon` scheduler: `node-cron` over workspaces; schedules stored in SQLite (Schedule entity).
- Job runner: many jobs may be due → enqueue under the **one-active-run-per-workspace** rule (#014); each job is an AgentRun.
- Result delivery: Event to activity log + Telegram message to the paired DM (respecting `telegramAllowed`; if disabled, log + dashboard only).
- Schedules UI (co-owned): list/create/edit/delete with cron helper + "send result to" toggle.

## Acceptance criteria
- [ ] A recurring job runs at its schedule and posts result to Telegram + activity timeline.
- [ ] Overlapping due jobs in the same workspace queue, not lock up the process.
- [ ] Editing/deleting a schedule stops future runs and records the change.
- [ ] Job without Telegram access still logs the result in the activity timeline.