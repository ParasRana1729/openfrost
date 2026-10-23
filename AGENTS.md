# AGENTS.md — OpenFrost agent guidance

Read and follow this file and [the specification](docs/ai-os-project-spec.md)
before changing the repository.

## 1. Current direction and authority

**Current state: specification only. No implementation exists yet.** There are
no app/package sources, package manifests, tests, or CI workflows. Do not invent
existing APIs, scripts, migrations, tools, or passing checks.

OpenFrost is a Windows-first personal **AI OS** being rebuilt by one owner,
ParasRana1729. One assistant completes research briefs, project updates, and
weekly planning through a local web app. Projects scope context; they are not
separate assistant personalities.

- Product authority: [`docs/ai-os-project-spec.md`](docs/ai-os-project-spec.md).
- Current work: [`backlog/solo-rebuild.md`](backlog/solo-rebuild.md), S00–S07.
- Planned behavior and checked documentation tasks are not proof that a product
  feature is implemented. Inspect actual files and verify dependencies before
  claiming anything works.
- Start assigned work from the current clean `origin/main`. Fetching current
  progress is expected; restoring removed code or earlier history is not, unless
  the owner explicitly asks. The current spec is the source of truth.
- Implement only assigned work. Further deletion, database resets, or history
  changes require explicit authorization.

## 2. Target architecture

These paths are planned; create only what the assigned slice needs:

```text
apps/web          Next.js App Router / React local assistant UI
apps/api          Fastify API, owner auth, SSE, task worker, routine tick
packages/domain   Shared Zod schemas and inferred TypeScript contracts
packages/db       SQLite + Drizzle, migrations, DPAPI-backed secret storage
packages/agent    Vercel AI SDK, OpenAI adapter, bounded tools, execution policy
packages/ui       Shared components where reuse is justified
```

The API owns a SQLite-backed task queue; one agent run is active globally,
including while waiting for approval. More tasks queue visibly. No separate
broker or scheduler service is needed. These are implementation requirements,
not a description of an existing runtime.

## 3. Hard engineering and security rules

1. **Strict TypeScript:** no `any`; strict null checks. Use Vitest for tests.
2. **Shared contracts:** define entities, events, state transitions, and tool inputs
   with Zod in `packages/domain`; infer types instead of duplicating them across apps.
3. **Local storage:** use `better-sqlite3` + Drizzle at
   `%USERPROFILE%\.openfrost\db\openfrost.db`. Follow the spec's storage ownership:
   SQLite for structured state/artifacts; Markdown for approved memory content.
   Preserve existing data with explicit migrations. No Docker or cloud database.
4. **Secrets:** use Windows DPAPI-backed protection for API keys and any future bot
   token. Never put plaintext credentials in committed files, logs, model context,
   reports, or memory. Generic encryption/keychain libraries alone are not proof
   of DPAPI integration.
5. **Three risk tiers:** classify every tool execution and record its outcome.
   - `auto`: bounded authorized reads/planning and app-internal result persistence.
   - `telegram`: standard writes; this risk identifier does not require a Telegram
     integration. In v0.1 approval is in the local web app. Initially only
     new-report export is supported.
   - `local`: high-risk changes require local Control Center authorization and
     cannot be approved remotely. Such tools are disabled in v0.1.
6. **Deny before approval:** an approval never grants an unsupported capability or
   bypasses folder/network boundaries. Bind approval to exact immutable arguments;
   revalidate authorization at execution.
7. **Scoped tools:** canonicalize paths, handle Windows junctions/symlinks, deny
   escapes and credential stores, and bound reads. Public HTTP(S) tools must block
   private/loopback/link-local/metadata destinations through redirects and DNS
   changes. Source content cannot change permissions or approve actions.
8. **Local access is not sufficient trust:** require owner sessions, loopback
   binding, authenticated streams, origin checks, and CSRF protection.
9. **Bounded, recoverable work:** finite limits, cancellation, durable run history,
   interrupted-run recovery, and deduplicated routines. Never blindly retry writes.
10. **Context and privacy:** use only the active project's context plus approved
    global preferences unless the owner explicitly attaches other material.
    Disclose that selected context is sent to the model/search provider.

## 4. Working on an assigned item

1. Read its S00–S07 entry in the active backlog and relevant spec sections.
2. Confirm dependencies actually work in the current code; documentation or a
   completed planning task is not implementation evidence. S01 starts from an
   empty implementation and must first define the workspace and toolchain.
3. Keep one slice focused. Add tests alongside shared utilities, endpoints, state
   transitions, and trust boundaries. Prefer fake providers and clocks so tests
   require no paid API calls or real credentials.
4. S01 must create working scripts for the exact project checks:

   ```bash
   pnpm lint && pnpm test && pnpm build
   ```

   Until that toolchain exists, these commands are unavailable. For this
   specification-only baseline, validate links, scope, and repository contents;
   never label missing commands as passing.

5. Exercise the workflow named in the acceptance criteria. State what passed,
   what was not run, and what is still assumed. Do not claim a feature works from
   passing tests alone.
6. Follow [CONTRIBUTING.md](CONTRIBUTING.md). Reference the local backlog ID;
   use `Closes #...` only for a real, explicitly mapped GitHub issue.
7. Implement only assigned work and follow the commit, landing, and handoff
   workflow below. Do not leave completed work only in an agent conversation.

## 5. Commits, landing, and agent handoffs

The owner wants a useful, accumulating Git history so later agents can continue
from verified work instead of reconstructing earlier conversations.

- Use a topic branch for each assigned slice. Make a meaningful checkpoint commit
  after each coherent milestone and before a handoff; do not wait until the end
  of a long task. Describe the change and relevant local S-ID in the commit.
- Push checkpoint branches to the verified GitHub source remote so other agents
  can access them. Incomplete work must be labeled as such and stay off `main`.
  Never use the `local` backlink as a substitute for the shared GitHub remote.
- Keep the assigned backlog entry current. At checkpoints and handoff, record
  what works, exact checks/results, remaining work or blockers, and the next step.
  Check acceptance boxes only when supported by evidence.
- Open a focused PR with that summary and verification evidence. Prefer a merge
  commit so meaningful checkpoint history survives; do not force-push shared
  branches or rewrite history as part of normal development.
- Merging requires explicit authorization for the specific assigned change, such
  as “Implement S01 and merge it when checks and CI pass.” Once given, carry that
  task through verification, PR, and merge without asking again at every step.
  A general preference for frequent merges is not permission to land other work.
- Before merging, review the diff, satisfy the assigned acceptance criteria, run
  available required checks and the relevant workflow, and confirm configured CI
  has passed. If `main` advances, integrate it safely and repeat affected checks.
  Missing or failing checks are blockers, not passes. For documentation-only
  changes before S01, use documentation checks and disclose the absent toolchain.
- After merging, verify the actual commit on remote `main` and report the PR,
  commit, checks, limitations, and next assigned slice. A local commit, branch
  push, or completed PR review alone is not a landed result.
- Never merge unfinished work just to share context. A checkpoint branch and
  durable handoff provide context while `main` stays a verified integration point.

## 6. Scope guardrails

Do not add Telegram, native/mobile clients, remote access, agent teams, cloud
workers, plugin/MCP infrastructure, multiple model providers, arbitrary shell,
browser/OS computer use, self-directed work, or an autostart/backup subsystem to
v0.1. If a requested change needs one of these, discuss a spec change first.
