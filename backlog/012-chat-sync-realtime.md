---
num: 012
title: "P0 — Canonical chat sync API + realtime updates (SSE/WebSocket)"
owner: AGENT
area: agent
labels: [P0, area:agent]
iteration: "Iteration 1"
depends_on: [007, 009]
---

## Context
"Sync" means a Telegram message appears in the web dashboard live, and continue-in-web works without losing context (spec §3, Q2). One canonical `Message` table; both channels read/write the same rows.

## Scope
- `GET /api/workspaces/:id/conversations`, `GET /api/conversations/:id/messages` (pagination, oldest/newest).
- `POST /api/conversations/:id/messages` — web-side send; same ingestion pipeline as Telegram (#009).
- Realtime: SSE or WebSocket hub pushing `message.created`, `message.streaming`, `run.updated`, `approval.pending` events to the Control Center.
- Message dedup guard: Telegram update_id/offset handling so no double-ingest after reconnect.

## Acceptance criteria
- [ ] Telegram message → appears in web chat in <1s without refresh.
- [ ] Web message → appears in the same conversation row the Telegram side reads on next `/chats`.
- [ ] Reconnect after offline burst (#025) does not duplicate messages.
- [ ] Contract tests for pagination and event payloads (payloads match `packages/domain`).