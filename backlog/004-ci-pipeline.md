---
num: 004
title: "P0 — CI pipeline: lint, test, build on every PR"
owner: PLATFORM
area: platform
labels: [P0, area:platform]
iteration: "Iteration 0"
depends_on: [003]
---

## Context
Team rule: no merge into `main` without one review and green CI. The pipeline must run `lint`, `test`, and `build` for every package, on Windows and Linux runners.

## Scope
- GitHub Actions workflow on `pull_request` + `push` to `main`.
- Matrix: ubuntu-latest (fast) + windows-latest (we ship Windows-first).
- Cache pnpm store; fail fast on lint errors.

## Acceptance criteria
- [ ] PR with a lint error fails CI.
- [ ] PR with a failing test fails CI.
- [ ] Green build on Windows runner for all 4 apps.
- [ ] CI badge in README.