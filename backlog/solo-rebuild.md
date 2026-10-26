# OpenFrost — Solo rebuild backlog

- **Specification:** [v0.1 solo rebuild](../docs/ai-os-project-spec.md)
- **Owner for every item:** ParasRana1729
- **Current assignment:** S09 TUI Control Center overhaul; S07's one-working-week owner-use gate remains open

These are local backlog identifiers, not GitHub issue numbers. S00–S06 are
complete (see each handoff); S07 remains in progress, the unfinished S08
Phase 2 web work is preserved on the `feat/ui-phase2-task-lifecycle`
checkpoint branch and superseded by S09, which is being implemented on a
topic branch. Ownership is not permission
for an agent to start all remaining items or publish anything. Implement the next
explicitly assigned item in dependency order.

The repository contains a runnable toolchain and implemented workflows. Verify
actual code and checks before claiming progress; a plan or checklist is not proof
that a capability exists.

## S00 — Establish the clean specification-only baseline

- **Status:** Complete (specification-only reset); no runtime implementation
- **Depends on:** None

Start with one personal assistant, a local web interface, and three concrete
workflows for a solo builder. Keep only the approved specification, delivery plan,
Git hygiene, and minimal human/agent guidance.

### Acceptance criteria

- [x] The spec identifies one owner, Windows-first local execution, one assistant,
      project-scoped context, and OpenAI as the initial provider.
- [x] Research briefs, project updates, and weekly planning have observable outcomes.
- [x] The one-pager, README, contributor guidance, and agent instructions point to
      the approved scope and explicitly state that no implementation exists.
- [x] The backlog defines ordered work, dependencies, and acceptance gates.
- [x] No application sources, package manifests, automation scripts, build
      configuration, or CI workflows remain in the baseline.
- [x] The baseline starts from one parentless commit with no recovery branch;
      application data outside this repository is untouched.

### Handoff

- Implemented: the specification-only baseline and agent delivery guidance for
  checkpoint commits, pushed task branches, verified PR merges, and durable
  task handoffs. The assignment template includes task-specific merge permission.
- Verification: `git diff --check` passed. Node assertions passed for relative
  links, Markdown whitespace/fences, consistent checkpoint/merge/handoff guidance,
  and absence of application/toolchain files.
- Not run: `pnpm lint`, `pnpm test`, and `pnpm build`; no package manifest or
  scripts exist yet. No runtime functionality has been implemented or verified.
- Next: explicitly assign S01, including its landing conditions. Start from the
  current clean `origin/main`; S01–S07 remain unimplemented.

## S01 — Establish the minimal local task foundation

- **Status:** Complete (local foundation; no model provider yet)
- **Depends on:** S00

Implement only the foundation needed to persist and safely execute a first task.
Create the minimal workspace from scratch; do not introduce a separate queue service.
Add domain entities incrementally, only when the assigned slice needs them.

### Acceptance criteria

- [x] Create the minimal pnpm workspace and required packages/apps from the spec;
      pin a supported Node.js LTS version and pnpm version, add a lockfile, define
      working lint/test/build/dev scripts, and document actual setup commands.
- [x] Add CI for `pnpm lint && pnpm test && pnpm build`; no unused service shells
      or placeholder implementations are presented as working features.
- [x] Shared task/run/message/artifact/event contracts and state transitions use
      Zod in `packages/domain`, with validation tests.
- [x] SQLite + Drizzle migrations persist conversations, queued tasks, run
      attempts, results, and activity; restarting does not reset data.
- [x] The local UI/API enforce owner sessions, loopback binding, origin checks,
      authenticated streams, and CSRF protection.
- [x] The owner can supply an OpenAI key through local settings; it is protected
      by DPAPI, and neither raw keys nor sensitive request bodies enter logs.
- [x] Onboarding explains provider data transmission and PC/runtime availability.
- [x] One global executor enforces finite limits and cancellation; restart marks
      unfinished runs interrupted and pauses dispatch for owner review.
- [x] A fake provider/tool verifies queue ordering, completion, failure,
      cancellation, limit exhaustion, and interruption without paid API calls.

### Handoff

- Implemented: pnpm workspace (Node 24 LTS in `.nvmrc`, engines 24–26, pnpm
  10.34.7 via `packageManager`); `packages/domain` Zod contracts with enforced
  task/run transition maps; `packages/db` SQLite + Drizzle migrations,
  repository store, scrypt owner passwords, and Windows DPAPI secret sealing
  (PowerShell `ProtectedData`, CurrentUser scope, purpose-bound entropy,
  fail-closed off Windows); `packages/agent` single-run executor with finite
  step/wall-clock/input/output limits, cancellation, explicit retries, and
  restart recovery that interrupts unfinished runs and pauses dispatch;
  `apps/api` Fastify on `127.0.0.1` with owner sessions (HttpOnly
  SameSite=Strict), session-bound CSRF tokens, origin allowlisting before CORS,
  authenticated SSE activity stream, dispatch review endpoints, and
  secret-safe logging; `apps/web` Next.js UI on `127.0.0.1:3000` with the
  required onboarding disclosures, task queue/controls, and DPAPI key settings.
  `packages/ui` deliberately not created (no justified reuse yet). No OpenAI
  adapter: tasks fail honestly as `provider_missing` until S02.
- Verification: `pnpm lint`, `pnpm test`, and `pnpm build` all pass locally on
  Windows (93 tests: 29 domain, 24 db, 16 agent, 24 api) and in GitHub Actions
  CI on `windows-latest`. DPAPI round-trips are exercised for real on Windows
  (blob format, wrong-purpose rejection, key file, log-redaction). The built
  API entrypoint was smoke-tested end to end on a temp home: health, owner
  setup/login, unauthenticated 401s, task enqueue, honest provider-missing
  failure, and no secret material in logs.
- Not run/verified: a real OpenAI call (no provider exists by design this
  slice); long-running wall-clock behavior beyond the tested bounds; the web
  UI was verified by `next build` and manual review, not by automated browser
  tests.
- Known limitations: executor wall-clock checks happen between provider steps,
  so a single long provider call can overshoot its limit before being stopped;
  sessions are single-device-friendly but not rate-limited.
- Follow-up (2026-10-24, audit fixes): an independent audit reproduced two
  browser-facing defects — the hijacked SSE response dropped CORS headers (the
  UI silently ran on its 4s polling fallback) and the allowlisted
  `http://localhost:3000` origin could never hold the SameSite=Strict session
  cookie. Fixed by restoring CORS on the stream and proxying API calls under
  the web origin (both loopback hosts verified working end to end in a real
  browser, SSE delivering live events in ~46 ms). Executor error paths were
  hardened (orphaned-run reconciliation, artifact-before-finalize ordering
  with an honest `internal` failure code, no unhandled rejections); expired
  sessions are purged at startup; the DPAPI subprocess has a timeout; the
  logout CSRF check is timing-safe; failed logins that cannot keep the
  session cookie now show a diagnostic; activity timestamps render in local
  time. The SSE polling fallback remains only as a resilience net.
- Follow-up 2 (2026-10-24): remaining audit items closed. The web UI received
  its frost design pass (dispatch status strip, dark runtime-console activity
  panel, mono system data, drawn snowflake wordmark, invitation empty states),
  the wall-clock limit is enforced with a real abort timer (a hung provider
  call stops at the limit instead of overshooting), task FIFO ties break by
  insertion order instead of random uuid, concurrent owner setup returns 409
  instead of 500, startup recovers before listen with correct shutdown exit
  codes and a force-exit on a second signal, and the never-emitted
  `task.started` event type was removed from the contract. 100 tests green.
- Next: S02 — wire one OpenAI model via the `LlmProvider` seam
  (`packages/agent/src/provider.ts`), add bounded public search/fetch tools
  with private-network blocking, and deliver the research-brief vertical
  slice from the web app.

## S02 — Complete the research-brief vertical slice

- **Status:** Complete (real-model quality pending the owner's evaluation)
- **Depends on:** S01

Deliver a real request-to-report experience before adding more configuration.
Use one configured OpenAI model, provider-backed web search, and bounded public
page retrieval. No shell, managed browser, or connector catalog.

### Acceptance criteria

- [x] From the web app, submit a question and constraints, see task progress, and
      open a saved report after a restart.
- [x] A brief includes a comparison, recommendation, sources, retrieval times,
      uncertainties, and unanswered questions.
- [x] Fetching blocks private/loopback/link-local/metadata destinations and
      unsafe URLs, including redirects and DNS changes; requests are bounded.
- [x] Source content cannot change tool policy, access credentials, or approve
      actions. Failed retrievals and unsupported claims are surfaced.
- [x] The UI exposes failure, cancel/retry controls, usage, and cost estimates
      when available without claiming certainty about unknown costs.
- [x] Fake-provider tests cover the workflow; the owner separately evaluates one
      real research task. Automated tests need no real API keys.

### Handoff

- Implemented: the provider seam is now a tool-calling conversation loop
  (`packages/agent/src/provider.ts` — `LlmProvider.step()` over `AgentMessage`
  items returning final text with url citations, or tool calls plus
  hosted-search counts and token usage). `OpenAIProvider` calls the OpenAI
  **Responses API** (`POST /v1/responses`) with hosted `web_search` plus the
  function tools; `url_citation` annotations become the brief's citations and
  token usage lands on run rows. The executor runs the bounded loop: a policy
  system message states that retrieved page content is untrusted data and
  never instructions; owner constraints and starting URLs enter the user
  message; starting URLs are deterministically prefetched through `fetch_page`
  (recorded as `step: 0` tool events); tool results are bounded (20k chars),
  capped (4 calls/step), and unknown tools/invalid arguments surface as
  failures to the model; the artifact gains a runtime-recorded
  `## Retrieved sources` appendix (per-URL HTTP status, ms, chars, including
  failed retrievals) that the model cannot fabricate. `fetch_page`
  (`packages/agent/src/tools/fetchPage.ts` + `ipGuard.ts`) is the retrieval
  trust boundary: http(s) only, no embedded credentials, host deny list
  (localhost/.localhost/.local/.home.arpa/metadata hosts), IP-literal and
  per-address DNS validation (IPv4 u32 / IPv6 BigInt guard incl.
  `::ffff:`-mapped v4), an undici dispatcher whose connect-time lookup
  re-resolves and re-validates every connection (DNS rebinding fails closed),
  manual redirects with full re-validation (max 4), content-type gate, 2 MB
  streamed size cap, 15s deadline. apps/api configures the provider via
  `OPENFROST_PROVIDER=openai|fake` and `OPENFROST_OPENAI_MODEL` (default
  `gpt-4.1-mini`); the OpenAI adapter reads the DPAPI-protected key once per
  process (memory only); `OPENFROST_PROVIDER=fake` scripts a deterministic
  research run through the real `fetch_page` so the pipeline is exercisable
  without any key. The web app renders reports with an injection-safe
  markdown renderer (no `dangerouslySetInnerHTML`, http(s)-only links),
  collects constraints/starting URLs, shows token usage and list-price cost
  estimates (labeled as estimates; "no list price on file" when unknown), and
  polls task detail live while a run is active.
- Verification: `pnpm lint`, `pnpm test`, `pnpm build` pass locally (126
  tests: 31 domain, 26 db, 41 agent, 28 api — all fake-provider, zero paid
  calls) and in CI on `windows-latest`. Browser-verified end to end on a temp
  home with `OPENFROST_PROVIDER=fake`: onboarding → submit task with
  constraints + starting URL → live progress → saved report rendered as
  markdown with real retrieval timings (HTTP 200, ~1s/0.7s, recorded by the
  runtime) → full runtime restart → report, retrieval records, and usage
  still present. SSRF matrix covered by injected-resolver/fetch tests
  (redirect-to-private, literal IPs, DNS-private, metadata hosts, ftp,
  credentials, oversized body, bad content type).
- Not run/verified: a real OpenAI call. The provider path is implemented and
  unit-tested with injected transports, but per this criterion the owner
  separately evaluates one real research task (store a key in Settings, submit
  a real question, judge report quality). No key was present during
  development and none was requested.
- Known limitations: markdown tables in reports render as plain text (the
  renderer supports a deliberately small surface); hosted web-search timing is
  not exposed by the provider API (fetch timings are real; search counts are
  logged as events); cost estimates use a static list-price table and are
  always labeled as estimates; web_search results enter model context through
  the provider rather than discrete tool results, so the runtime logs search
  events but not their raw contents; conversations/messages remain unwired
  (tasks only); NAT64 `64:ff9b::/96` is not in the denied IP ranges.
- Next: S03 — projects: granted-folder context and evidence-backed updates.

## S02b — Provider choice: OpenAI or Gemini

- **Status:** Complete (real Gemini call pending the owner's evaluation)
- **Depends on:** S02

Owner-approved spec change (2026-10-25): the one-provider decision became
provider choice. OpenAI or Gemini, one active at a time, each with its own
DPAPI-protected key and configured model. No per-task provider selection and
no plugin system — two built-in adapters only.

### Acceptance criteria

- [x] The owner can choose the active provider (OpenAI or Gemini) in Settings;
      the choice and per-provider models persist and take effect on the next
      run without a restart.
- [x] Each provider's key is stored DPAPI-protected under its own purpose, so
      one provider's blob cannot be decrypted as another's; keys are never
      echoed or logged.
- [x] Gemini runs use the native generateContent API with Google Search
      grounding surfaced as search counts and web citations, function calling
      mapped to the shared tool seam, and honest failures (blocks, truncation,
      empty responses, invalid keys) that never leak the key.
- [x] Fake-provider tests cover both adapters and the switching flow with no
      real API keys; settings switching works while the fake dev hook is
      documented as disabled (409).
- [ ] The owner separately evaluates one real research task on their chosen
      provider (shared with S02's real-model evaluation; no key has been
      provided to the runtime yet).

### Handoff

- Implemented: `GeminiProvider` (`packages/agent/src/geminiProvider.ts`) over
  `POST /v1beta/models/{model}:generateContent` — `google_search` grounding
  maps to searches/citations (groundingChunks → web uri/title), function
  calls map to the shared tool seam, consecutive tool results merge into one
  user turn as the API expects, usage maps to token rows. Per-provider DPAPI
  secrets (`provider-<id>-key.bin`, purpose `provider-key:<id>`).
  `ActiveProvider` (`apps/api/src/activeProvider.ts`) routes each run to the
  owner's active provider from Settings, caching adapters and memoized keys
  per provider with invalidation on key save/remove (no restart needed).
  Settings API: `PUT /settings/provider` (switch + per-provider model
  override; 409 while the fake hook is active), per-provider key
  save/remove. Config: `OPENFROST_GEMINI_MODEL` (default `gemini-3.8-flash`)
  alongside `OPENFROST_OPENAI_MODEL`. Web settings UI: provider choice,
  per-provider model/key management, pricing map extended.
- Verification: `pnpm lint`/`pnpm build`/`pnpm test` pass (139 tests: 31
  domain, 27 db, 49 agent, 32 api) locally; CI on `windows-latest` runs the
  same. Gemini adapter covered by injected-transport tests (request shape,
  function-call mapping, grounding citations/searches, usage, no-key-leak,
  block/finish reasons, aborts); per-provider secrets covered including
  cross-purpose rejection; settings switching covered over the API.
- Not run/verified: a real Gemini call (same status as S02's OpenAI call —
  the owner evaluates with their key; none has been provided to the runtime).
- Known limitations: combining `google_search` with function calling
  requires a Gemini 2.5-class model (the default); grounding citations are
  chunk-level (not sentence-level attributions); token usage excludes
  thinking tokens on thinking models.
- Next: S03 — projects, unchanged.

## S02c — Provider choice: add OpenRouter

- **Status:** Complete (real OpenRouter call pending the owner's evaluation)
- **Depends on:** S02b

Owner-approved spec change (2026-10-25): the built-in provider set extends
from two to three. OpenAI, Gemini, or OpenRouter, one active at a time, each
with its own DPAPI-protected key and configured model. Still no per-task
provider selection and no plugin system — three built-in adapters only.

### Acceptance criteria

- [x] The owner can choose OpenRouter as the active provider in Settings;
      the choice and its model persist and take effect on the next run
      without a restart.
- [x] OpenRouter's key is stored DPAPI-protected under its own purpose, so
      one provider's blob cannot be decrypted as another's; the key is never
      echoed or logged.
- [x] OpenRouter runs use the OpenAI-compatible chat completions API with
      the hosted `web` search plugin surfaced as search counts and
      `url_citation` citations, function calling mapped to the shared tool
      seam, and honest failures (truncation, content filters, empty
      responses, invalid keys) that never leak the key.
- [x] Injected-transport tests cover the adapter and the settings flow with
      no real API keys or paid calls.
- [x] Real-model evaluation (owner-provided time-limited key, 2026-10-25,
      throwaway data home, key deleted after the test): a submitted research
      brief ran end-to-end on OpenRouter — completed in ~37 s over 4 steps
      with 10 bounded `fetch_page` calls, a 2,743-char report artifact saved
      with source URLs, uncertainties, and the runtime-recorded retrieval
      appendix, and real token usage recorded (40,070 in / 1,576 out). The
      hosted `web` plugin was verified separately through the adapter with
      the same DPAPI-sealed key: 5 live `url_citation` annotations mapped to
      citations with titles. The key was never echoed by the API and never
      appeared in logs.

### Handoff

- Implemented: `OpenRouterProvider` (`packages/agent/src/openRouterProvider.ts`)
  over `POST https://openrouter.ai/api/v1/chat/completions` — the `web`
  plugin's message annotations map to citations and search counts, tool
  calls map to the shared seam, usage maps `prompt_tokens`/
  `completion_tokens`. Default model `openrouter/auto` via
  `OPENFROST_OPENROUTER_MODEL`. `ActiveProvider` routes to it and now keys
  its adapter cache by provider+model, fixing a latent S02b defect where a
  saved model override kept using the first-run model until restart. The
  DELETE key route now validates the provider (unknown → 400 instead of
  silently removing the OpenAI key). Web settings/onboarding/home copy
  includes OpenRouter; spec, README, one-pager, and AGENTS.md record the
  three-adapter baseline.
- Verification: `pnpm lint`/`pnpm build`/`pnpm test` pass (151 tests: 31
  domain, 27 db, 60 agent, 33 api) locally; CI runs the same. OpenRouter
  adapter covered by injected-transport tests (request shape incl. web
  plugin/tools/message mapping, tool-call and citation mapping, usage,
  no-key-leak, length/content_filter/empty handling, aborts); settings
  switching and per-provider DPAPI keys covered over the API.
- Not run/verified: a real OpenRouter call — **resolved 2026-10-25** in the
  owner's real-model evaluation above (one brief through the full app plus
  one direct adapter probe of the web plugin; both succeeded; the test home
  with the DPAPI-sealed key was deleted afterward).
- Known limitations: `openrouter/auto` routes across upstream models, so the
  UI's list-price cost estimate stays unknown for it (already labeled
  honestly); the web plugin bills per search on top of token costs; requests
  transit OpenRouter to the chosen model's upstream provider; in the
  evaluated brief the model answered entirely through `fetch_page` (no
  hosted-search annotations in-run), so in-task citation behavior depends on
  the routed model.
- Next: S03 — projects, unchanged.

## S03 — Add project context and evidence-backed updates

- **Status:** Complete (real-model project update pending the owner's evaluation)
- **Depends on:** S02

Projects organize one assistant's context. Read granted text/Markdown notes and
produce dated updates without mutating a repository or invoking Git/shell tools.

### Acceptance criteria

- [x] Create/edit a project, explicitly grant/revoke folder roots, and scope a
      conversation/task to it.
- [x] Canonical path checks reject traversal, junction/symlink escapes, and
      credential stores; file count/size/type limits and skipped sources are visible.
- [x] A saved update cites files/excerpts and separates documented progress,
      blockers, unknowns, and proposed work; notes do not become proof of shipping.
- [x] Two-project tests demonstrate that chats, files, and project facts do not
      leak across scopes. Cross-project attachment requires owner action.
- [x] Revoked grants are rechecked at tool execution, including queued tasks.

### Handoff

- Implemented: `packages/domain` project contracts (`Project`,
  `ProjectFolderGrant`, project CRUD/grant request schemas), a task `kind`
  (`research_brief` | `project_update`) with optional `projectId` scoping on
  tasks and conversations, a `project_update` artifact kind, a
  `source_unavailable` run-failure code, and `project.*` event types.
  `packages/db` migration `0002_projects` (projects + project_folder_grants
  tables, `tasks.kind`/`tasks.project_id`/`conversations.project_id` columns,
  existing rows default to `research_brief`) and the store `projects`
  namespace (create/update/list, add/remove/list grants) plus scoping-aware
  task/conversation creation. `packages/agent` gains `read_project_file`
  (`tools/projectFiles.ts`), the file trust boundary: grant paths are
  canonicalized with realpath at grant time and re-canonicalized at every
  execution (a moved or junction-swapped root stops granting immediately);
  reads require strict containment after resolution, refuse traversal,
  junction/symlink escapes (lexical gate before any filesystem access so
  outside paths cannot be probed), and credential/configuration stores by
  name (.git/.ssh/.aws/.kube/.env/id_rsa/*.pem/node_modules/...); bounded at
  50 files × 512 KB per run with .md/.markdown/.txt only. The executor runs
  `project_update` tasks with a dedicated policy (Documented progress /
  Stated blockers / Unknowns / Proposed next steps; notes are claims, not
  proof of shipping), a run-start inventory whose skipped sources are visible
  to both the model and the owner, a runtime-recorded `## Project files
  consulted` appendix the model cannot alter, and honest `source_unavailable`
  failure when nothing is readable (including grants revoked while the task
  was queued). Grant re-reads happen at every tool call, so mid-run
  revocation stops access at once. `apps/api` adds `/api/projects` CRUD +
  grant/revoke (canonicalization, duplicate 409, home/data-dir and drive-root
  refusals), task project validation, and kind-aware `OPENFROST_PROVIDER=fake`
  scripts (the fake update reads the first inventory file). `apps/web` adds
  the Projects page (create/edit, grant/revoke, transmission disclosure) and
  the workflow/project selectors on the task form with kind/scope chips.
- Verification: `pnpm lint`, `pnpm test`, `pnpm build` pass locally (199
  tests: 41 domain, 32 db, 87 agent, 39 api — all fake-provider, zero paid
  calls) — including two-project isolation (instructions, file listings, and
  file content never cross scopes; a cross-project read is refused and shown
  as FAILED in the appendix), queued-task and mid-run grant revocation, and a
  full project update over HTTP. Browser-verified end to end on a temp home
  with `OPENFROST_PROVIDER=fake`: onboarding → project created → notes folder
  granted (canonical path echoed) → project-update task scoped on the tasks
  page → completed → saved update rendered with the runtime appendix showing
  `parser.md — read, 149 chars` and `run.log — skipped: unsupported file type`.
- Real-model evaluation (owner-provided time-limited OpenRouter key,
  2026-10-25, throwaway data home, key stored through the DPAPI settings
  flow, home deleted after the test): a `project_update` task on a realistic
  four-file notes folder completed end-to-end on `openrouter/auto` in ~26 s
  (2 steps, 7,567 in / 4,118 out tokens). The saved update is dated, cites
  every substantive claim with a file path plus an exact excerpt, frames all
  progress as "the notes state …", caught a planted overclaim (a note that
  walked back a prior "all tests pass" claim), surfaced a genuine cross-file
  inconsistency (a 1.9x throughput figure measured on an unknown corpus while
  the 50 MB export was still awaited), listed the denied `.env` and skipped
  `run.log` exactly as the runtime appendix recorded them, and labeled three
  hosted web-search results as external reference material rather than
  project evidence. The key never appeared in API or web logs (grep-verified).
  One setup stumble: selecting a provider in Settings is only a draft until
  "Save provider" is clicked — the first run failed `provider_missing`
  against OpenAI; the status line conflated draft and active provider (UI
  fix noted for the next interface pass).
- Not run/verified: a real model call for a project update (the owner
  evaluates with their configured provider, as with S02's real-model
  evaluation); the web UI has no automated browser tests (manual/automated
  split as in S02).
- Known limitations: research briefs scoped to a project receive the
  project's instructions but not file tools (files are the project-update
  workflow's sources); project deletion is not implemented (delete is not in
  the acceptance criteria, so tasks never dangle); conversations are scoped
  in the schema/store only — chat UI arrives later; directory-symlink escape
  coverage uses junctions on Windows (file symlinks need privileges) with
  POSIX symlinks covered on POSIX paths of the same logic.
- Next: S04 (approval-bound report export) or S05 (owner-approved memory);
  both depend on S03 only.

## S04 — Add approval-bound report export

- **Status:** Complete (real-use evaluation happens alongside S07's working week)
- **Depends on:** S03

Add one narrow write: exporting a saved report as a new Markdown file beneath an
explicitly granted destination. Internal artifact storage already works without
this feature.

### Acceptance criteria

- [x] Risk contracts retain `auto`, `telegram`, and `local`; standard writes use
      the `telegram` identifier but approvals occur in the local web app only.
- [x] Review shows exact content and destination and binds the decision to an
      immutable action/run with expiry and audit events.
- [x] Rejecting, changing content, expiring, canceling, or revoking access prevents
      execution. Duplicate decisions cannot write twice.
- [x] Export creates a new file without overwrite; canonical-root checks and
      execution-time validation prevent escapes, including changed junctions.
- [x] Unknown write outcomes are reconciled rather than replayed automatically.
- [x] Delete/overwrite/shell/system/credential tools remain unavailable; approval
      cannot override a denied capability or folder boundary.

### Handoff

- Implemented: the export is an `export_report` task through the one global
  executor. `POST /api/exports` (artifact + destination grant + safe filename)
  binds immutable arguments; the run performs no model work — it builds the
  proposal (artifact sha256, canonical destination realpath, filename), persists
  an `approvals` row with a 24 h TTL, moves the task to `awaiting_approval`, and
  holds the executor while the owner decides in the web app (other tasks queue
  visibly). The task detail review panel shows the exact destination, filename,
  content hash, `telegram` risk tier, and the artifact's full content; the Home
  page shows a pending-approval banner. `decideApproval` validates decisions
  against the approval transition map — decided, expired, or canceled approvals
  refuse further decisions, so duplicates cannot write twice. On grant, the run
  resumes (`awaiting_approval → running`) and revalidates everything at
  execution: approval still granted and unexpired, artifact hash unchanged,
  destination still canonical (moved or junction-swapped folders refuse), target
  still absent — then writes once with a create-only flag (`wx`). Any refusal
  fails the run `export_refused` and marks the approval canceled with the
  reason; nothing is retried. Rejection/expiry/cancellation finish the task
  honestly without writing. Restart recovery cancels approvals left pending or
  granted-but-unconfirmed with an explicit reconcile note ("the file may or may
  not exist") — the runtime never replays a write. Destinations are granted in
  Settings through the same canonical-path guard as source folders (realpath,
  drive-root and data-directory refusals); removing a destination stops future
  exports without touching written files. The risk contract is unchanged:
  `auto`/`telegram`/`local`, the export uses `telegram`, approval is local-only,
  and no delete/overwrite/shell/system/credential tool exists.
- Verification: `pnpm lint`, `pnpm test`, `pnpm build` pass locally (226 tests:
  51 domain, 32 db, 99 agent, 44 api) — the executor test matrix covers every
  prevents-execution criterion (reject, duplicate decision, expiry, content
  tamper, target appeared, destination moved, cancel-while-parked, restart
  recovery, retry-overwrite) and the API suite covers the HTTP surface.
  Browser-verified end to end on a throwaway home with
  `OPENFROST_PROVIDER=fake`: grant destination → submit brief → propose export
  from the task detail → run parks with the review panel → Approve → the exact
  1,007-byte file appears in the destination and the approval shows `executed`
  with the outcome; a duplicate proposal for the same filename failed with
  "Exports never overwrite" while the executor stayed held for the pending
  review and the second task queued visibly behind it.
- Not run/verified: a real-model artifact export (the flow is model-independent;
  the owner exercises it during S07's working week); no automated browser tests
  (unchanged limitation).
- Known limitations: one approval per export task and one pending export at a
  time in practice (the executor is held while any review is open); exports are
  UTF-8 text only; the destination list has no per-folder size/quota bound (the
  single-file write is bounded by the artifact's own size).
- Next: S05 — owner-approved memory.

## S05 — Add inspectable, owner-approved memory

- **Status:** Complete (real-use quality pending S07's working week)
- **Depends on:** S03

Keep conversation history separate from durable global preferences and project
facts. Start with Markdown and straightforward retrieval, not embeddings.

### Acceptance criteria

- [x] The owner can confirm a proposed memory, inspect its scope/source/date,
      edit it, and delete it from future memory retrieval.
- [x] Only approved global preferences and the active project's approved facts
      enter a task's context; source history is not silently deleted with memory.
- [x] Markdown is canonical memory content; SQLite metadata/indexes do not become
      a competing copy. External edits are detected before overwrite.
- [x] Tests cover approval, deletion, project isolation, restart, external edits,
      and exclusion of secrets from memory proposals.

### Handoff

- Implemented: approved memory is Markdown-canonical. Global entries live in
  `<home>\memory\owner.md` and project facts in
  `<home>\projects\<project-id>\memory.md`. Each entry is a plain-Markdown body
  inside HTML-comment fences whose base64url JSON metadata carries the entry id,
  scope, project, source (task id/label), and created/updated timestamps; owner
  prose outside the fences is preserved on approval, edit, and delete. SQLite
  stores pending proposals (review text is cleared after a decision, while source
  metadata and content hashes remain) plus rebuildable metadata indexes with no
  content column. The Memory page lists pending proposals with scope, project,
  source task/run, and proposal date; the owner can edit the proposed text,
  approve it, or reject it. Approved entries show scope, source, approved and
  updated dates, and are editable or deletable. Deletion removes the Markdown
  entry from future retrieval; proposal/source history and the originating
  task/report are not deleted. Decision history stays visible with hashes, and
  proposal text is not retained after a decision.
- Implemented: every approval, edit, and delete carries the exact Markdown
  sha256 the owner loaded (null when the file does not exist). The store re-reads
  the file and returns 409 with `currentSha256` without writing when it changed.
  External edits surface as `externalChange`, parse/format problems are shown,
  and "Reload from disk" reindexes without deleting owner prose. Limits are
  4,000 characters per entry, 50 entries per file, 256 KiB per file, and a
  6,000-character approved-memory budget for one task context. File reads stop
  at 256 KiB plus one byte, including if a file grows after its initial size
  check; oversized files are rejected without parsing.
- Implemented: the assistant gets `propose_memory` on every model-backed run:
  at most three proposals per run, project scope only for project-scoped tasks,
  duplicates refused, and pattern-based credential scanning
  (OpenAI/Google/GitHub/AWS keys, private-key blocks, bearer tokens, credential
  assignments) before storage. Approved global preferences plus only the active
  project's facts are loaded from Markdown at run start into research-brief and
  project-update prompts; pending proposals, other projects, and deleted entries
  never enter context. `memory.*` events record metadata, hashes, counts, entry
  IDs, truncation, and problems but never memory text. The API and UI reuse the
  existing owner-session, origin, and CSRF protections; errors map to
  404/400/409 as appropriate.
- Verification: `pnpm lint && pnpm test && pnpm build` passes locally (266 tests:
  65 domain, 44 db, 106 agent, 51 API). Coverage includes approval/edit/delete,
  pending-vs-approved retrieval, project isolation, restart, external edits and
  stale-hash conflicts, malformed files, duplicate/limit/secret refusal, source
  retention, proposal-to-prompt flow, `memory.used` metadata, and the HTTP
  401/403/404/400/409 surface. The production web build includes `/memory` and
  type-checks the page.
- Not run/verified: no real-model run proposed or used memory (deterministic fake
  and injected providers cover the paths); real-model usefulness is part of S07's
  working week. No automated browser test; a manual browser pass on a throwaway
  home with seeded pending proposals covered approve-with-edit, project approval,
  entry edit and delete, the external-edit warning, and reload preserving owner
  prose. The fake provider was running, but the proposals were seeded directly so
  the review UI could be exercised; proposal generation itself is covered by the
  agent tests.
- Known limitations: retrieval is not embedded or relevance-ranked; all approved
  global entries and all active-project entries are placed in file order until
  the 6,000-character cap. Truncation is disclosed in the `memory.used` event but
  the UI does not preview the exact prompt. Scope, source, and original approval
  date are immutable after approval; editing changes content and `updatedAt`, and
  there is no move/copy action between scopes. Credential scanning is best-effort
  pattern matching over text (the store supports exact-value matches, but the
  current routes and tool do not pass stored provider keys), so it can reject
  false positives and cannot guarantee detection of unusual secret
  formats. Memory files are plaintext Markdown under the user profile with no
  separate encryption; external changes are detected on read/mutation, not by a
  filesystem watcher. Limits are fixed rather than configurable.
- Next: S06 — owner-confirmed weekly planning routines.

## S06 — Add owner-confirmed weekly planning routines

- **Status:** Complete (real-model plan quality pending S07's working week)
- **Depends on:** S03, S05

Reuse the task executor to draft priorities from scoped notes and recent updates.
Do not add external notifications, calendar integration, or self-assigned work.

### Acceptance criteria

- [x] The owner reviews a task template, project/source scope, time zone, and
      cadence before enabling; routines can be paused, edited, or removed.
- [x] The runtime runs due work without an open browser, honoring the global queue
      and execution limits, and saves a source-backed weekly-plan artifact.
- [x] Persisted occurrence identifiers prevent duplicates across ticks/restarts,
      clock changes, and daylight-saving transitions.
- [x] Unavailable-runtime intervals produce one missed occurrence for review per
      routine, with “run once now”/“skip”, not an automatic replay burst.
- [x] Fake-clock integration tests cover due, missed, paused, edited, failed,
      overlapping, and restart cases.

### Handoff

- Implemented: routines are owner-confirmed weekly-planning templates scoped to
  one project. Creation (`POST /api/routines`, validated by
  `createRoutineRequestSchema`: name, project, IANA time zone verified through
  Intl, weekly weekday+time or daily time schedule, task template) always
  yields a **paused draft**; `POST /api/routines/:id/enable` is the separate
  confirmation step, and the Routines page previews the computed next
  occurrence (local-date key + UTC instant) before enabling. Routines can be
  paused, edited (`PUT`; a schedule/time-zone edit moves the no-back-fill
  anchor `windowStartAt` to now, so enabling or editing never produces an
  instant miss or back-fill), or removed (`DELETE`; occurrence rows go with
  the routine, dispatched tasks remain as history).
- Implemented: `RoutineScheduler` (`apps/api/src/routineScheduler.ts`, tick
  cadence `OPENFROST_ROUTINE_TICK_MS`, default 30 s) is constructed in
  `buildApp` sharing the executor's clock and started by `main()` after
  listen — no browser is involved. Each tick examines, per active routine,
  only the **latest occurrence at or before now** (pure domain math in
  `packages/domain/src/routine.ts`: local-date keys, offset-probing wall→UTC
  conversion that resolves fall-back ambiguity to the first pass and
  spring-forward gaps to the transition minute). A materialized
  `routine_occurrences` row (UNIQUE `(routine_id, occurrence_key)`) ends the
  examination, which is what deduplicates ticks, restarts, backward/forward
  clock jumps, and DST shifts — the key is the scheduled local calendar
  date, which does not move when the UTC instant does. Occurrences within
  the 30-minute late grace dispatch one `weekly_plan` task through
  `executor.enqueueRoutineOccurrence` (row first, then task, then task-id
  back-link), honoring the global one-run queue and the same execution
  limits as manual work; anything later surfaces exactly one `missed` row
  (reason recorded) that only an owner decision resolves:
  `POST …/occurrences/:key/run` (run once now → exactly one task;
  duplicate decisions 409 via the `missed → scheduled|skipped` transition
  map) or `…/skip`. Intermediate weeks the runtime also missed are never
  replayed. `routine.*` events record the observable lifecycle.
- Implemented: the `weekly_plan` task kind runs the project-update tool set
  (`read_project_file`, grants re-read at every call) with a dedicated
  policy (Draft priorities for next week / Unresolved questions / Suggested
  next steps; notes and updates are evidence, never proof; the draft
  commits the owner to nothing). The first user message carries the
  granted-file inventory plus the project's two most recent saved
  `project_update` artifacts (4,000 chars each, truncation disclosed),
  joined through tasks so another project's updates cannot leak in; zero
  updates is disclosed as such. A run with no readable files AND no saved
  updates fails honestly `source_unavailable`. The saved `weekly_plan`
  artifact appends two runtime-recorded sections the model cannot alter:
  `## Project files consulted` and `## Updates consulted` (artifact/task
  ids, dates, sizes, truncation). `OPENFROST_PROVIDER=fake` scripts a
  weekly plan through the real file read (routing anchor: the
  always-present `Recent saved updates` heading).
- Fixed en route: a latent `TaskExecutor` race the scheduler's dispatch
  loop exposed — `kick()` during a drain's resolution microtask returned an
  already-resolved promise and left the newly queued task unprocessed.
  Drain passes now serialize onto a chain that `whenIdle()`/`stop()` await.
- Verification: `pnpm lint && pnpm test && pnpm build` passes locally (318
  tests: 83 domain, 54 db, 111 agent, 70 API — all fake-provider, zero paid
  calls); the production web build includes `/routines`. Fake-clock
  scheduler integration tests cover due (once across ticks; next week is a
  new key), missed (exactly one row; repeated ticks add nothing; run-once
  now dispatches once and duplicates 409; skip never runs a task), the
  30-minute grace boundary (one side runs, one side misses), paused (no
  dispatch while paused; resume past the grace yields one missed review),
  edited (new schedule honored, no back-fill, edits after the instant
  ignored), enabling (creation anchor prevents back-fill), failed runs
  (never re-dispatched or auto-retried), overlapping routines (one tick,
  two tasks, one global queue, both complete), restart (fresh
  executor/scheduler over the same store dispatches nothing), and clock
  changes (backward then forward across a fired occurrence adds nothing).
  HTTP tests cover the owner-session/CSRF surface: CRUD, draft-then-enable,
  duplicate enable/pause 409, window anchor movement, due dispatch with a
  completed artifact, missed run/skip with duplicate 409 and unknown-key
  404, and removal.
- Verification (fake-provider workflow exercise, throwaway home,
  `OPENFROST_PROVIDER=fake`, tick 3 s, real clock): owner setup → project
  with a granted notes folder (`notes.md` + a `run.log` that must be
  skipped) → routine created as a paused draft with the next-occurrence
  preview shown → enabled → **with no browser open**, the tick dispatched
  the due occurrence through the global queue and the task completed,
  saving a 1,314-char weekly-plan artifact containing the Draft priorities
  section, `notes.md — read`, `run.log — skipped: unsupported file type`,
  and the Updates consulted appendix (no web-retrieval appendix). A full
  runtime restart on the same home left exactly one occurrence and one
  completed task after several ticks (no duplicate dispatch), with the
  routine and its last-occurrence record intact. A second routine paused
  across its scheduled instant dispatched nothing while paused and ran
  late-but-automatically ~45 s past the instant after resume (within the
  30-minute grace — the designed brief-outage behavior); the >grace missed
  path was not re-waited live (it needs 30+ minutes of real downtime) and
  is covered by the fake-clock and HTTP tests above.
- Not run/verified: a real-model routine run (the owner evaluates plan
  quality during S07's working week with their configured provider); no
  automated browser test of the Routines page (manual/automated split as in
  S02–S05; the page is exercised through its API contract and the
  production build type-checks it).
- Known limitations: weekly and daily cadences only (the schema is a
  discriminated union; other cadences need a contract change); the late
  grace (30 min), tick interval default, update count (2), and per-update
  cap (4,000 chars) are fixed constants, not owner-configurable; missed
  occurrences are indistinguishable by cause (unavailable runtime vs.
  paused) — both surface as one review row, which is deliberate; time-zone
  wall→UTC conversion has minute resolution (HH:mm schedules, so exact);
  a dispatched-then-failed occurrence keeps state `scheduled` with its
  failed task linked (retry is the existing task retry, not a routine
  concern); occurrence history is capped at the 20 most recent keys per
  routine in the detail endpoint; if the run is interrupted mid-dispatch
  after the occurrence row exists but before the task link lands, the row
  stays `scheduled` with no task (visible, never duplicated).
- Next: S07 — harden and validate the personal-use release.

## S07 — Harden and validate the personal-use release

- **Status:** In progress (validation performed 2026-10-26; the one-working-week criterion is open by definition and runs on the owner's real use)
- **Depends on:** S04, S06

This is a working-product gate, not just a passing build.

### Acceptance criteria

- [x] `pnpm lint && pnpm test && pnpm build` passes.
- [x] Document and perform fresh Windows setup, DPAPI round-trip under the owner,
      local authentication, migration, and clean runtime start/stop.
- [x] Exercise all three real workflows and inspect citations, project isolation,
      approved export, rejection, cancellation, and missing-source behavior.
- [x] Verify browser closure, runtime interruption, queued-work recovery, missed
      routines, revoked grants, duplicate requests, and unavailable provider behavior.
- [ ] Record one working week's usefulness/corrections and resolve release blockers.
- [x] README/setup instructions describe what actually ships, where data lives,
      and the limitations; planned work is not advertised as a completed feature.

### Working-week log (owner)

The week of real use starts when the owner begins working with the runtime on
their own home. Record here: what was useful, what needed correction, and any
scope decisions that result. The 2026-10-26 validation below is the pre-week
gate; findings marked WEEK carry into this log.

### Handoff (validation record, 2026-10-26)

- **Real-model validation (owner-provided time-limited OpenRouter key, free
  models only, throwaway homes, key sealed through the DPAPI settings flow and
  never echoed; expires 2026-10-26T20:00Z):** 22 of the account's 50 daily
  free-model requests were used; the model was
  `nvidia/nemotron-3.5-lightning:free` (the listed `…super-120b:free` variant
  404s for this account; `gemma-4-31b:free` rate-limited; `inkling:free` is
  harness-gated). All three workflows ran end to end with real output: a
  7,661-char research brief (comparison table, recommendation with reasons,
  8 cited URLs from real hosted searches, uncertainties, runtime retrieval
  appendix; 3,686/3,274 tokens); a 1,319-char project update over a realistic
  two-file notes folder (every claim attributed, the planted unknown-corpus
  inconsistency surfaced, Beta project's content never leaked, files
  appendix); and a 4,758-char routine-drafted weekly plan (three required
  sections, both notes cited, the prior saved update consulted per the
  runtime appendix). The interrupted-then-retried brief also completed
  (3,768/2,628 tokens).
- **Reliability matrix, all live on this Windows machine:** hard `taskkill`
  mid-run → restart marked the run `interrupted`, paused dispatch for review,
  kept the queued task queued; resume + retry completed both tasks. A queued
  task whose grant was revoked while it sat behind an export's review hold
  failed `source_unavailable` (deterministic; an earlier attempt without the
  hold raced the executor and completed because the revoke landed after
  source collection). Approved export wrote the exact file once
  (`approved-brief.md`, sha256-bound proposal, `telegram` tier); a duplicate
  decision 409'd; a rejected export wrote nothing; a same-filename proposal
  created before the first write failed honestly at execution ("never
  overwrite"). In-flight cancellation aborted two running briefs; identical
  duplicate submissions both queued as distinct tasks and were both canceled.
  Key removal → `provider_missing`; an unavailable model id → `provider_error`
  with no key material in the failure. Browser closure is inherent: no web
  app was running during any of the above; only the loopback API.
- **Missed routines and routine recovery, live:** one probe restarted inside
  the 30-minute grace dispatched late-but-automatically and completed
  (correct per design); a second probe was dispatched on schedule and then
  hard-killed mid-run — restart marked the run `interrupted`, paused
  dispatch, and the occurrence (state `scheduled`, task linked) recovered
  through resume + retry into a completed, web-free weekly plan. The
  >grace `missed` row was not re-created live (it requires 30+ minutes of
  genuine downtime and both live attempts either restarted within grace or
  dispatched before the kill); that path is deterministic and covered by
  the 11 fake-clock scheduler tests and the routines HTTP suite, including
  run-once-now/skip and duplicate refusals.
- **Fresh Windows setup, performed:** on a brand-new home — first-run owner
  setup (201; repeat 409), wrong-password 401, logout/re-login, unauthenticated
  `/api/tasks` 401, DPAPI round trip through the settings flow (store →
  sealed blob on disk contains no key material → remove → absent → restore),
  restart persistence (owner, provider, sealed key, and task history all
  survived), and a completed real-model project update on the virgin home.
  Clean shutdown caveat, honestly scoped: on Windows, cross-process signal
  injection (`process.kill(pid, 'SIGINT')`) terminates Node without running
  the handlers (exit 1, no graceful log) — an OS limitation; the graceful
  path (interrupted marking, exit codes, second-signal force-exit) is
  verified by the S01 agent test-suite, and interactive Ctrl+C in the
  owner's console is the supported stop.
- **Migration, performed with real old code:** a git worktree at `main`
  2c1742f (S05) built the actual S05 packages and seeded a legacy home
  (owner, project + grant, completed task + artifact, pending then approved
  memory proposal with its Markdown entry). Opening that home with current
  code applied migration `0005_routines` and preserved everything: owner
  credentials verify, project/grant/task/artifact intact, the approved entry
  still indexed and present in `memory/owner.md`, and the routines namespace
  live (empty). No data was reset anywhere.
- **Release blockers found and fixed this slice:**
  1. Hosted web search was attached to every provider request. On the
     owner's creditless free-model account this failed **every** task with
     HTTP 402 (the plugin requires purchased credits; the free model alone
     returns 200), and ~35 executed searches billed **$0.14** to the key.
     It also let web results contaminate a weekly plan whose policy grounds
     it in notes and saved updates only. Fix: `ProviderStepRequest.webSearch`
     is true only for research briefs; OpenAI/Gemini/OpenRouter omit their
     hosted search otherwise (adapter tests cover all three). After the fix,
     the same weekly plan ran clean — no web content, zero plugin cost — and
     file-grounded workflows work on free credits.
  2. Real briefs are table-heavy; the markdown renderer showed tables as
     plain text. `MarkdownView` now renders GFM pipe tables with React-
     escaped cells and a scroll wrapper; detection verified against the live
     brief's two tables (11 body rows).
  3. The free model narrated a "suggested memory" in report text instead of
     calling `propose_memory` (zero pending proposals after a full brief).
     The policy now states proposals are made ONLY through the tool and that
     in-report suggestions are discarded. WEEK: observe whether models
     comply.
- **Verification:** `pnpm lint && pnpm test && pnpm build` passes (321
  tests: 83 domain, 54 db, 114 agent, 70 api — all fake-provider in CI;
  the three new adapter tests cover search omission per provider). Real-model
  runs above are the workflow evidence; every other check is the automated
  suites plus the live matrix on this machine.
- **Not run/verified:** the one-working-week criterion (open by definition —
  the owner records it in the log above); no automated browser test for the
  new table rendering (verified by parser extraction on the real brief plus
  the production build; visual pass due during the week); OpenAI and Gemini
  adapters were not exercised against their real APIs this slice (their
  search-omission is unit-tested; the owner's active provider is
  OpenRouter).
- **Known limitations/notes for the week:** hosted web search on research
  briefs costs per executed search even on free models (it is the feature —
  disclosed in Settings copy; on creditless accounts briefs that trigger
  search will fail 402 honestly); the free tier allows 50 model
  requests/day; markdown table cells do not support escaped pipes (`\|`);
  miss rows do not distinguish downtime from pause (deliberate); routine
  occurrence history caps at 20 keys in the detail endpoint. Rotate the
  OpenRouter key used for validation — it transited chat.
- **Next:** the owner's working week; anything it surfaces lands in the log
  above and, if blocking, as follow-up fixes.

### Follow-up: provider-secret and NAT64 hardening (2026-10-26)

- Implemented on `fix/s07-security-boundaries`: OpenAI, Gemini, and OpenRouter
  provider errors redact the exact configured key before it can reach a task
  failure. Tests simulate an upstream echoing the key in its error response;
  OpenRouter also covers a non-JSON response body.
- `fetch_page` now decodes the IPv4 suffix under the well-known
  `64:ff9b::/96` NAT64 prefix and applies the existing IPv4 deny ranges. Tests
  cover literal URLs, DNS answers, and redirects. Other locally configured
  NAT64 prefixes are not auto-discovered.
- Verification: final `pnpm lint && pnpm test && pnpm build` passed (325 tests:
  83 domain, 54 db, 118 agent, 70 API). `git diff --check` passed.
- A direct OpenRouter adapter smoke call during the initial review (before
  these fixes) succeeded with the free model and hosted search disabled
  (27 input / 246 output tokens). It exercised provider authentication and
  response mapping only, not the app's Settings/DPAPI path or a full workflow.
- Not run: a real-provider workflow after these changes; the regression tests
  use fake keys and transports. The one-working-week owner-use gate remains
  open, and no owner observations were provided in this follow-up.
- PR: [#28 — S07 provider and NAT64 hardening](https://github.com/ParasRana1729/openfrost/pull/28).
  Checks pass for this focused follow-up; it does not close S07 or the open
  owner-use gate.
- Next: continue the owner's working-week log and resolve any issues it surfaces.

## S08 — Improve Control Center clarity and feedback (Phase 1)

- **Status:** Implementation and local verification complete on `feat/ui-phase1-quick-wins`; [PR #30](https://github.com/ParasRana1729/openfrost/pull/30) is open, with CI running
- **Depends on:** S01–S06 (existing local UI and workflows)

Implement the first, visible usability slice from the owner-provided UI/UX plan.
This slice is limited to Phase 1 quick wins; the task lifecycle redesign,
provider Save and test flow, and later polish remain future work. S08 does not
close S07's working-week release gate or add new runtime capabilities.

### Acceptance criteria

- [x] Assistant workflow modes read as one segmented choice; optional fields are
      grouped under an “Advanced options” disclosure.
- [x] “Queue task” is the clear primary action. Its disabled state stays legible
      and explains what the owner must provide before queuing.
- [x] Provider-key removal is visually secondary and requires confirmation.
- [x] Sidebar status reflects whether the local API is reachable and fits as a
      compact status chip.
- [x] The shared toast region reports successes and failures across setup,
      task, project, memory, routine, and settings actions.
- [x] Scrollable activity feeds are keyboard-focusable and labeled.
- [x] The Assistant heading and composer fit with recent activity in the desktop
      viewport; the composer remains usable at a narrow viewport.
- [x] Axe audits report zero violations on the Assistant (desktop and mobile)
      and Settings pages. Axe marks contrast checks incomplete because of
      gradients and pseudo-elements; the foreground/background token pairs were
      manually reviewed and exceed 4.5:1.
- [x] `pnpm lint`, `pnpm test` (325 tests), `pnpm build`, and `git diff --check`
      pass.
- [x] Manual browser workflow in an isolated temporary home: create the owner,
      queue and complete a fake-provider brief, observe the queue toast, store a
      disposable fake key, cancel key removal, then confirm removal.

### Handoff

- Implemented: accessible workflow toggles, queue readiness copy, advanced
  disclosure, reduced hero type size, API-backed runtime status, danger text
  treatment and confirmation for key removal, and global timed toasts for
  success/error feedback.
- Accessibility: axe-core 4.12.1 reported zero violations on the Assistant and
  Settings screens. One incomplete color-contrast rule requires manual review;
  the applicable token pairs were calculated above WCAG AA's 4.5:1 threshold.
- Not run: a standalone Lighthouse audit or automated browser test suite; this
  repository has no existing UI browser-test harness. The task feed/run-detail
  redesign, Settings Save and test flow, and remaining Phase 2–4 items were not
  implemented in this slice.
- Next: Phase 2 — readable task feed and run detail with failure explanations,
  progress, and queue visibility. (Superseded before implementation by S09;
  the partial Phase 2 web work is checkpointed on `feat/ui-phase2-task-lifecycle`.)

## S09 — TUI Control Center (Ratatui + Crossterm)

- **Status:** In progress on `feat/tui-overhaul`
- **Depends on:** S01–S06 (existing loopback API, workflows, persistence)

Replace the Next.js Control Center web app (`apps/web`) with a local terminal
UI built with Rust, Ratatui, and Crossterm, per the owner's 2026-10-26
decision. The TUI is a thin client of the existing Fastify loopback API: it
authenticates with owner credentials, sends the session-bound CSRF token on
mutations, consumes the SSE activity stream with a polling fallback, and adds
no new server-side capabilities. The static `apps/landing` page is kept. The
API, `packages/*`, SQLite persistence, DPAPI secrets, and executor are
unchanged. Closing the TUI does not stop tasks or routines.

### Scope

- Full functional parity with the removed web app: onboarding/login, assistant
  composer with workflow modes and advanced options, task feed with filters and
  detail (runs, events, artifact, cancel/retry), export approvals, global
  executor/queue status with dispatch resume, projects with folder grants,
  memory proposal review and entry management, routines with missed-occurrence
  run-once/skip, and provider-key/destination settings.
- Rust crate at `apps/tui`, excluded from the pnpm workspace; serde contracts
  mirroring `packages/domain` payloads, tested against fixtures; API client
  tested against a local mock HTTP server (no paid calls, no real credentials).
- Spec, backlog, AGENTS.md, and README updated to name the TUI the primary
  interface; CI gains cargo fmt/clippy/test/build steps on windows-latest.

### Acceptance criteria

- [ ] `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, and
      `cargo build` pass locally and in CI alongside
      `pnpm lint && pnpm test && pnpm build`.
- [ ] First-run owner creation and login work from the TUI against the real
      local API; every mutating TUI action sends the CSRF token header.
- [ ] The assistant loop is exercised manually end to end against the real API:
      queue a task with a fake provider, watch it run via SSE, open its detail,
      and cancel/retry; export approval grant and deny are exercised.
- [ ] Projects, routines, memory, and settings flows perform their CRUD
      operations through the same API endpoints the web app used.
- [ ] `apps/web` is removed; `apps/landing` still builds; the API, packages,
      and database are unchanged and existing tests pass.
- [ ] Spec and docs name the TUI the primary interface and the landing page's
      role; no committed secrets; TUI holds the session cookie and CSRF token
      in memory only.

### Handoff

- (in progress)
