---
num: 013
title: "P0 — Chat UI: conversation list, named chats, streaming messages"
owner: UI
area: ui
labels: [P0, area:ui]
iteration: "Iteration 1"
depends_on: [008, 012]
---

## Context
Each workspace has multiple named conversations (spec §3, #31) — like tabs in a desktop app. The UI must render streamed agent responses and clearly mark channel + delayed state.

## Scope
- Conversations sidebar: list, create (`+ New chat`), rename, delete, active-conversation indicator.
- Message rendering: user/assistant bubbles, streaming text (AI SDK stream via SSE), `via Telegram` / `delayed` badges, error state.
- Auto-scroll + "new message" jump pin.
- Empty states and loading skeletons.

## Acceptance criteria
- [ ] Create/switch/rename/delete conversations work and survive reload.
- [ ] Streamed assistant replies render progressively (no full-response wait).
- [ ] Telegram-originated messages visibly labeled; delayed(#025) messages labeled "delayed".
- [ ] Chat page for Coding/Learning/General each isolated by workspace.