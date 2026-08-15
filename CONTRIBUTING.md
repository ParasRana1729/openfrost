# Contributing to OpenFrost

Thank you for contributing! Whether you are a human engineer or an AI coding assistant, please follow this standardized contribution workflow.

---

## 1. Branching Strategy

- Work on an assigned GitHub Issue.
- Create a new branch off `main`:
  - Feature: `feat/issue-<number>-<short-description>` (e.g. `feat/issue-3-monorepo-scaffold`)
  - Fix: `fix/issue-<number>-<short-description>`
  - Chore / Docs: `chore/issue-<number>-<short-description>`

---

## 2. Commit Message Guidelines

Use conventional commits:
- `feat(platform): add monorepo pnpm workspaces setup (#3)`
- `feat(domain): add user and workspace zod schema contracts (#7)`
- `fix(telegram): handle long polling reconnect backoff (#9)`

---

## 3. Pull Request Guidelines

1. **One PR per Issue**: Keep PRs focused strictly on the scope of the assigned issue.
2. **Fill the PR Template**: Ensure the PR body includes `Closes #<issue_number>` and checks off the acceptance criteria from the issue.
3. **No Direct Pushes to `main`**: All code must be merged via Pull Request with passing CI and at least 1 review.
4. **Code Quality**:
   - Run `pnpm lint`
   - Run `pnpm test`
   - Run `pnpm build`
