---
num: 022
title: "P1 — Managed browser: isolated per-workspace Chromium profile, manual sign-in, session reuse"
owner: AGENT
area: agent
labels: [P1, area:agent, area:security]
iteration: "Iteration 3"
depends_on: [010, 017]
---

## Context
Browser automation boundary per spec §3 (#15, #40): **one AI OS-managed Chromium profile per workspace**, user signs in manually, agent uses the established session but never handles passwords or 2FA codes. (Default-off capability until a user signs in at least once.)

## Scope
- Profile management: per-workspace user-data dir under `%USERPROFILE%\.openfrost\browser\<ws>\`, isolated by design.
- Launch: headless-capable instance controlled by the agent; "open the browser to sign in" flow from the dashboard for the user.
- Agent tools: open URL, read page, click, fill (no password fields), screenshot — all approval-gated like #017 classes.
- Storage boundary: cookies/sessions never shared across workspaces; login to a service in Coding does **not** leak to Learning.
- Network destination policy: new network destinations hit the high-risk baseline (local approval).

## Acceptance criteria
- [ ] Signing in in workspace A does not authenticate the managed browser in workspace B.
- [ ] Agent cannot access password/2FA fields; tool rejects attempts clearly.
- [ ] Every browser action appears in the activity timeline.
- [ ] Headless tests: navigate/click/fill happy path on a local fixture site.