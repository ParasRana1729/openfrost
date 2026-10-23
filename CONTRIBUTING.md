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
- The current baseline contains no implementation. S01 starts with the minimal
  workspace and toolchain; do not infer an existing runtime from the spec.
- Keep unrelated cleanup and destructive operations out of an assigned slice
  unless explicitly authorized.

## 2. Commits and pull requests

Use conventional commits, for example:

- `docs(product): define solo rebuild scope (S00)`
- `feat(agent): save cited research briefs (S02)`
- `fix(security): reject project-root escapes (S03)`

Keep a PR focused on one backlog item. Link its local entry and copy its acceptance
criteria. Use `Closes #<number>` only when a real GitHub issue has been explicitly
mapped; do not invent a GitHub issue number from an S-ID.

## 3. Verification and owner review

- Add Vitest coverage for changed utilities, endpoints, state transitions, and
  trust boundaries. Fake providers/clocks should keep automated tests independent
  of real keys, network availability, and paid model calls.
- S01 must define the scripts for:

  ```bash
  pnpm lint && pnpm test && pnpm build
  ```

- These checks are not runnable in the specification-only baseline. Once the
  toolchain exists, run them for implementation changes and before landing code.
- Exercise the relevant real workflow as well. For documentation-only changes,
  check local links and consistency; report any project checks not run.
- Have the owner review the diff, criteria, security implications, and evidence.
  A second human reviewer is not a solo-build requirement. Optional AI review is
  supplementary, not authorization to land.
- Use a PR and passing CI to land code; do not push directly to `main`. Agents
  must have explicit owner authorization before publishing or merging changes.
