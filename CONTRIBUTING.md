# Contributing to OpenFrost

OpenFrost is currently a solo project owned by ParasRana1729. Human and AI
contributors follow the same scope, security, and verification rules.

Read [AGENTS.md](AGENTS.md), the [specification](docs/ai-os-project-spec.md), and the
assigned entry in the [solo backlog](backlog/solo-rebuild.md) before starting.

## 1. Scope and branches

- Work on one explicitly assigned active backlog item. S00–S07 are local IDs,
  not GitHub issue numbers.
- Confirm dependencies in the code, not just in planning documents.
- Use a topic branch, for example `feat/s02-research-brief`,
  `fix/s03-folder-boundary`, or `docs/s00-product-reset`.
- The S01 foundation is on `main`. Build only what the assigned slice needs and
  verify dependencies in the actual code; do not infer capabilities from the spec.
- Keep unrelated cleanup and destructive operations out of an assigned slice
  unless explicitly authorized.

## 2. Commits and pull requests

The owner prefers frequent, meaningful checkpoint commits and completed slices
merged into shared `main`, so later agents inherit working code and its history.
Do not keep useful progress only in a conversation or an uncommitted worktree.

Use conventional commits, for example:

- `docs(product): define solo rebuild scope (S00)`
- `feat(agent): save cited research briefs (S02)`
- `fix(security): reject project-root escapes (S03)`

Commit after a coherent milestone and before switching agents or ending a work
session. Verify the GitHub source remote and push the topic branch so checkpoint
work is available to others. Never include secrets, unrelated edits, or generated
output merely to make a checkpoint. Label incomplete work and keep it off `main`.

Keep a PR focused on one backlog item. Link its local entry and copy its acceptance
criteria. Use `Closes #<number>` only when a real GitHub issue has been explicitly
mapped; do not invent a GitHub issue number from an S-ID.

Prefer a merge commit so the useful checkpoint commits remain in history. Do not
force-push shared branches or change repository merge settings without permission.

## 3. Verification and landing authorization

- Add Vitest coverage for changed utilities, endpoints, state transitions, and
  trust boundaries. Fake providers/clocks should keep automated tests independent
  of real keys, network availability, and paid model calls.
- S01 must define the scripts for:

  ```bash
  pnpm lint && pnpm test && pnpm build
  ```

- These checks exist since S01 and CI runs them on `windows-latest`; run them
  for implementation changes and before landing code.
- Exercise the relevant real workflow as well. For documentation-only changes,
  check local links and consistency; report any project checks not run.
- Review the diff, criteria, security implications, and evidence before landing.
  A second human reviewer is not a solo-build requirement. Owner or optional AI
  review can supplement this, but review alone is not landing authorization.
- Get task-specific authorization, for example: “Implement S01 and merge it when
  checks and CI pass.” This covers that task's checkpoint pushes, PR, and merge;
  no repeated approval is needed while staying within the approved scope.
- Use a PR and passing configured CI to land code; do not push directly to `main`.
  Verify the PR head being merged is the reviewed/tested head. If `main` advances,
  integrate it without overwriting other work and rerun the affected checks.
- If criteria or checks fail, keep the work on its branch and record the blocker.
  Do not start another backlog item, skip protections, deploy, or rewrite shared
  history under the authority of an unrelated task's merge permission.
- After merging, verify the result on remote `main` and report the PR URL, actual
  commit, checks, limitations, and next step. A push by itself is not a merge.

## 4. Durable handoff for the next agent

Update the assigned entry in `backlog/solo-rebuild.md` with its actual status and
a short handoff before a checkpoint or final commit:

- Implemented behavior and important decisions.
- Exact commands/workflows checked, their results, and what was not verified.
- Remaining acceptance criteria, known limitations, and blockers.
- The next concrete step; link the PR when available.

Later agents should read the spec, this entry, recent commits, and the relevant
code before continuing. Completed work comes from current `origin/main`;
unfinished work comes from its explicitly identified checkpoint branch. Keep the
backlog as the progress record rather than adding competing status documents.
