---
num: 008
title: "P0 — Dashboard shell, local auth (admin password/session), workspace switcher"
owner: UI
area: ui
labels: [P0, area:ui]
iteration: "Iteration 0"
depends_on: [003]
---

## Context
The Control Center at `http://localhost:<port>` is the primary management surface (spec §3, #22): workspace settings, model keys, action history, approvals. It must be protected by a local admin password/session by default, with an explicit dev-only no-auth flag.

## Scope
- Next.js shell: sidebar (workspaces list + switcher), header (daemon status, pending approvals badge), content outlet.
- Auth flow: first-run setup screen sets the admin password; login screen; session persisted server-side in SQLite (server session, not localStorage JWT); `OPENFROST_DEV_NO_AUTH=1` dev escape hatch.
- Route scaffolding for: Chat, Workspace Settings, Approvals, Activity, Schedules, Settings.

## Acceptance criteria
- [ ] Fresh install shows admin setup → login → dashboard.
- [ ] Logged-out users cannot reach any dashboard route (server-side guard).
- [ ] Workspace switcher lists seeded workspaces (General, Learning, Coding) from #006.
- [ ] Dev no-auth flag works and is documented; default is auth ON.