---
num: 009
title: "P0 — Telegram bot skeleton: long polling, one-time-code pairing, allowlist, inbound ingestion"
owner: PLATFORM
area: platform
labels: [P0, area:platform]
iteration: "Iteration 1"
depends_on: [005, 006]
---

## Context
The Telegram bot is the full remote interface. Direction from spec §3: paired DM only, long polling (no webhook), pairing via a one-time code shown in the Control Center, strict Telegram-account allowlist.

## Scope
- `apps/telegram` (grammY): long polling against the bot token from DPAPI secrets.
- Pairing: Control Center generates a pairing code (expiring, single-use) → user sends it to the bot in DM → pairing record stored → thereafter **only that Telegram account ID** is accepted.
- Inbound ingestion: telegram messages → canonical `Message` rows (channel=telegram) → publish to the event/queue layer so the web dashboard updates live (co-sets the contract with #012).
- Reject unknown/unpaired senders with a single "pair me" hint.

## Acceptance criteria
- [ ] Bot responds in DM only to the paired account.
- [ ] Pairing code flow works end-to-end: generate → send → verify → paired.
- [ ] Pairing and bot token survive daemon restart (persisted, encrypted).
- [ ] Inbound message lands in SQLite with channel=telegram and no reply loop (bot never replies to itself).
- [ ] Unit test: unpaired sender is rejected.