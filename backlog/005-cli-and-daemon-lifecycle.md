---
num: 005
title: "P0 — Windows CLI + daemon lifecycle: onboard / start / stop / status / --install-daemon"
owner: PLATFORM
area: platform
labels: [P0, area:platform]
iteration: "Iteration 0"
depends_on: [003]
---

## Context
`openfrost` must feel like a native terminal app (OpenClaw-style). Per spec §3 (#27): `openfrost onboard --install-daemon` registers a Windows Scheduled Task that starts at sign-in; `start` / `stop` / `status` control the same daemon.

## Scope
- `packages/cli` (commander): `onboard`, `start`, `stop`, `status`, `backup`.
- Onboarding: check Node LTS, write `%USERPROFILE%\.openfrost\config.json`, create `%USERPROFILE%\OpenFrost\workspaces\` with General/Learning/Coding templates (seeded by #006's seed data), collect OpenAI/Anthropic keys into DPAPI secrets (#026 storage issues land in Iteration 3 — store keys encrypted here using the same DPAPI helper from #006).
- Scheduled Task: `schtasks.exe` registration with sign-in trigger, runs `openfrost start` in background.

## Acceptance criteria
- [ ] `openfrost onboard` completes end-to-end on a clean Windows machine.
- [ ] `openfrost start` launches api + telegram + daemon as one background process; `status` shows health; `stop` shuts down gracefully (in-flight agent runs marked interrupted).
- [ ] Reboot the machine → daemon is running at sign-in (no manual action).
- [ ] Secrets never appear in plaintext files, logs, or the task action.