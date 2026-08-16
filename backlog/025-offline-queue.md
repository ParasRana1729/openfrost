---
num: 025
title: "P1 — Offline/delayed Telegram message queue: process on reconnect with 'delayed' notice"
owner: PLATFORM
area: platform
labels: [P1, area:platform]
iteration: "Iteration 3"
depends_on: [009, 012]
---

## Context

No cloud relay (spec §3, #30): messages sent while the daemon/PC was offline must be processed on reconnect, with a visible "delayed" notice, not silently lost.

## Scope

- Telegram long-polling reconnect logic: track `last_processed_update_id` in SQLite; on reconnect, ingest anything newer.
- Outbound queue: if a response can't be sent (offline), queue it; send on reconnect marked `is_delayed=true`.
- Inbound messages ingested from the offline window get `isDelayed` flag → surfaced in web chat UI (#013 badge "delayed").
- Backpressure guard: cap the burst to a sane batch size per run to respect #014 concurrency.

## Acceptance criteria

- [ ] Simulate offline: send 3 messages → all appear after reconnect, labeled delayed, replies delivered.
- [ ] No duplicates after reconnect (update_id bookkeeping test).
- [ ] Queue survives daemon restart (persisted offsets + undelivered outbound).
- [ ] Burst > N messages does not starve the run queue.
