---
num: 028
title: "P0 — Deployment guide + first MVP release"
owner: LEADER
area: product
labels: [P0, area:product]
iteration: "Iteration 3"
depends_on: [001, 005, 027, 026]
---

## Context
Ship the first release with OpenClaw-style terminal onboarding (spec §3, #21): a PowerShell installer + documented setup. Someone must be able to install AI OS on a clean Windows machine and hit the demo acceptance points, without reading source code.

## Scope
- `infra/installer.ps1`: check Node LTS → `npx openfrost onboard` → `--install-daemon` → open Control Center.
- `docs/install.md` + release notes: prerequisites, quickstart, security summary (pairing, approvals, DPAPI), troubleshooting (ports, Schedule Task, logs location).
- Semantic versioning: first public version `v0.1.0`; Git tag + GitHub Release with built artifacts (CLI bundle).
- Freeze: no new features after this point without a P0-level issue.

## Acceptance criteria
- [ ] Clean Windows VM: installer → onboard → daemon running → dashboard reachable at localhost.
- [ ] Quickstart passes demo #1–#7 from #027 without consulting source.
- [ ] v0.1.0 tagged and released with install + security docs.
- [ ] Feedback items one-liner triaged into next-iteration backlog.