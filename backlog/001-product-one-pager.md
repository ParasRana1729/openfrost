---
num: 001
title: "P0 — Product one-pager, MVP scope & security model"
owner: LEADER
area: product
labels: [P0, area:product]
iteration: "Iteration 0"
depends_on: []
---

## Context

Lock the MVP definition from `docs/ai-os-project-spec.md` into a one-page product one-pager: target user (power users), the workspace-as-app narrative, the 3 default workspace templates, and the security boundary (auto / Telegram-approval / local-approval). The team and any new member must be able to read this and know what we are building — and what we are **not**.

## Deliverable

- `docs/product-one-pager.md` — audience, problem, MVP promise, scope, non-goals.
- Confirm the MVP success metric (see §8 acceptance list in the spec).
- Sign-off of the spec by all four members (thread on the issue).

## Acceptance criteria

- [ ] One-page product doc merged and linked from the repo README.
- [ ] Non-goals section explicitly excludes: plugin marketplace, OS automation, groups, cloud relay, Docker/VPS target.
- [ ] All 4 members +1 the spec in this issue.
- [ ] The 6-item MVP demo acceptance list (spec §1) is copied verbatim into the doc so the April/May release can be measured against it.
