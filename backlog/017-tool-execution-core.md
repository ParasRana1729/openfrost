---
num: 017
title: "P0 — Tool execution core: allowed-folder file ops + host terminal, permission classes auto/telegram/local"
owner: AGENT
area: agent
labels: [P0, area:agent, area:security]
iteration: "Iteration 2"
depends_on: [010, 014]
---

## Context

The power boundary of the product (spec §3 #7, #10, #32, Q39). Tools run **as the signed-in Windows user** (OpenClaw exec-style) but only inside workspace-approved roots, every execution recorded, gated by permission class:

- `auto` — safe reads + planning (no prompt)
- `telegram` — writes/commands → approval (Telegram buttons or dashboard)
- `local` — high-risk baseline → **Control Center approval only** (delete/overwrite files, commands outside granted folders, new network destinations, credential changes, system-level commands)

## Scope

- File tools: read/write/list/search/delete-scoped (chrooted to `.allowed-folders`).
- Terminal tool: `exec` in approved working dir with timeout, output truncation, and full audit Event.
- Risk classifier: each tool call → riskClass; auto-classified calls execute; others emit `approval.pending` (#018) and **pause** the run.
- No tool access if the workspace lacks the capability toggle.

## Acceptance criteria

- [ ] `ls`-style read auto-executes; `rm`/overwrite → local approval; `npm run dev` in approved dir → telegram approval.
- [ ] Path escape attempts (e.g., `../`, absolute outside roots) are rejected at tool layer, not just UI.
- [ ] Every executed command appears in the activity timeline (#021) with cwd, exit code, and duration.
- [ ] Tool call without approval times out the run instead of hanging.
