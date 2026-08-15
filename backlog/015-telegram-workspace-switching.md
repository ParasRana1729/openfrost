---
num: 015
title: "P1 — Telegram workspace switching: /workspace, /new, /chats, active conversation state"
owner: AGENT
area: agent
labels: [P1, area:agent]
iteration: "Iteration 1"
depends_on: [009, 010, 014]
---

## Context
From Telegram the user must switch "apps" the way they switch apps on a desktop: `/workspace` → inline buttons (workspaces that allow Telegram per `telegramAllowed`), `/new` for a fresh conversation, `/chats` to pick an existing one. The bot remembers the active conversation per chat id.

## Scope
- Command handlers: `/workspace`, `/new`, `/chats`, `/help`; inline button keyboards.
- Active conversation state persisted (per Telegram chat id → workspace + conversation id).
- Workspaces with `telegramAllowed=false` never appear in Telegram.
- "Delayed" notice surface (#025) and approval buttons (#020) hook into the same reply machinery.

## Acceptance criteria
- [ ] `/workspace` lists only Telegram-allowed workspaces; switching persists across messages.
- [ ] `/new` creates and activates a new conversation; `/chats` lists and switches.
- [ ] Message without a workspace → assistant replies with a one-tap picker.
- [ ] Telegram replies carry a small "via Telegram · <workspace>" footer in web UI (uses #013 badges).