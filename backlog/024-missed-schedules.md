---
num: 024
title: "P1 — Missed-schedule handling: pending + prompt at next login via Telegram buttons"
owner: PLATFORM
area: platform
labels: [P1, area:platform]
iteration: "Iteration 3"
depends_on: [020, 023]
---

## Context

If the PC/daemon was off when a job was due, the job is not silently dropped. It stays **pending** and the user approves/skips it at their next login — from Telegram by default, also recorded in Control Center (spec §3, #34/#37).

## Scope

- On startup, scan for due-but-never-run schedules → mark `pending`.
- Send a Telegram message with `Run now` / `Skip` inline buttons + a summary of the missed job(s) (or a consolidated digest if several).
- Recording: outcome (ran/skipped) → Event + UI entry; approving triggers the job via #023 runner.
- Configurable: if `telegramAllowed=false`, the pending item appears only in the Control Center inbox.

## Acceptance criteria

- [ ] Simulate out-of-time (manipulate due time) → pending item surfaces at next login with Run/Skip buttons.
- [ ] "Run now" executes; "Skip" records a skipped Event and clears the pending state.
- [ ] Decision resolves from Telegram and Control Center is updated live.
- [ ] No job runs without the user's decision.
