---
num: 002
title: "P0 — GitHub repo, issue templates, labels & project board"
owner: LEADER
area: product
labels: [P0, area:product]
iteration: "Iteration 0"
depends_on: []
---

## Context

Set up the collaboration layer that the whole team works on top of: repository, issue templates (Feature / Bug / Technical task / ADR), label scheme, and the GitHub Project board with Status / Owner / Area / Priority / Size / Iteration fields.

## Deliverable

- Private repo created, team invited.
- `.github/ISSUE_TEMPLATE/*.yml` forms committed (already scaffolded in this repo).
- Labels: `P0`, `P1`, `area:product`, `area:platform`, `area:agent`, `area:ui`, `area:security`, `type:feature`, `type:bug`, `type:task`, `type:adr`.
- GitHub Project `AI OS — MVP` with board + roadmap views; milestones `Iteration 0..3`.
- Branch protection: no direct pushes to `main`, 1 review + green CI required (after #003/#004 exist).

## Acceptance criteria

- [ ] All 4 members have access and can create issues.
- [ ] Issue forms work for all 4 types.
- [ ] Labels and milestones exist; importing this backlog (#001..#028) happens via `scripts/import-issues.ps1` with real GitHub handles in `scripts/team.json`.
- [ ] Branch protection on `main` enforced once CI lands.
