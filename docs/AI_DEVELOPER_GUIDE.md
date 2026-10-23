# OpenFrost — Building solo with AI tools

The owner is ParasRana1729. The goal is useful personal workflows, not
building a team platform. AI tools can help implement and verify a slice;
the owner remains responsible for scope and release decisions.

## 1. Start with the active sources

Read these in order:

1. [AGENTS.md](../AGENTS.md): engineering and security constraints.
2. [Product one-pager](./product-one-pager.md): the promise and first three jobs.
3. [Full specification](./ai-os-project-spec.md): behavior and release gates.
4. [Solo backlog](../backlog/solo-rebuild.md): the assigned S00–S07 slice.

Then inspect current `origin/main`, relevant recent commits/PRs, and the assigned
entry's handoff. Those are shared context; do not assume another agent's private
conversation or unpushed edits are available.

**Current state: S01 local foundation implemented; no model provider yet.** The
workspace, contracts, persistence, DPAPI secrets, loopback API/UI, tests, and
CI are present. The three product workflows are still a plan (S02+); check the
solo backlog for what actually exists before building.

## 2. Set up and choose one slice

Start with S01 in the solo backlog. Create the minimal workspace, pin a supported
Node.js LTS version and pnpm version, define working scripts, and document setup
as part of that assignment. There are no install/start/test commands to run yet.

Never put a real API key in `.env`, a prompt, or an issue. DPAPI-backed credential
setup is an S01 deliverable, not a capability this baseline already provides.

Use a focused topic branch, for example `feat/s02-research-brief`. Check that the
slice's dependencies actually work before building on them.

## 3. Give the coding assistant a bounded assignment

```text
I am working on OpenFrost, a solo-built personal AI OS.
Read AGENTS.md and docs/ai-os-project-spec.md.

Implement only <S-ID and title> from backlog/solo-rebuild.md.
Check the actual repository state and follow the item's acceptance criteria.
Do not invent existing components beyond the S01 foundation; check the backlog handoff.
Create only what the assigned slice needs and preserve unrelated work.

Use strict TypeScript, shared Zod contracts in packages/domain, and Vitest tests.
Use fake providers/clocks for automated tests; never request keys in chat.
Exercise the actual workflow and report exactly what was verified or blocked.

Make meaningful checkpoint commits and push the task branch as work progresses.
Keep the assigned backlog entry current with evidence, blockers, and handoff notes.

I authorize you to publish this task's branch, open its PR, and merge this
specific task into main once its acceptance criteria, required checks, and
configured CI pass. Prefer a merge commit to preserve useful checkpoint history.
Do not ask again to land this same scope after those conditions are met.
Do not merge incomplete work, implement another slice, force-push shared history,
change repository settings, or deploy under this authorization.
```

Use `S01 — Establish the minimal local task foundation` as the next implementation
assignment. Research briefs are the first end-to-end product slice after that.
Replace the placeholder with the specific task before sending the assignment;
the merge authorization applies to that scope, not the whole backlog.

## 4. Verify the implementation

S01 must define the scripts for the exact project checks:

```bash
pnpm lint && pnpm test && pnpm build
```

They are not runnable before that toolchain exists. Never claim missing checks
passed. For specification-only work, check local links, consistency, and contents.

Then exercise the slice's workflow: submit a task, inspect its result and evidence,
and test applicable failure, permission, cancellation, and restart behavior.
For documentation-only work, also check local links and conflicting scope claims.
If a check cannot run, record why instead of marking it passed.

Do not paste credentials or unredacted private source content into bug reports.
An AI-generated summary is not proof that a test or real workflow was run.

## 5. Review and continue deliberately

Review the diff against the acceptance criteria and
[contribution rules](../CONTRIBUTING.md). Reference local S-IDs, not invented
GitHub issue numbers. When the assignment explicitly authorizes landing, complete
the PR and merge after the acceptance/verification gates pass; no additional human
approval is needed for that same scope. Configured CI must pass. If a gate is
blocked, leave a pushed checkpoint branch and record the reason instead of merging.

Before handing off, update the assigned backlog entry with working behavior,
important decisions, exact verification results, remaining work, and the next
step. Prefer merge commits so that useful checkpoint history is retained. Verify
the landed commit on remote `main` and report its PR and commit.

Assign the next slice only after the current one works. Capture adjacent ideas as
future work instead of silently expanding the MVP.
