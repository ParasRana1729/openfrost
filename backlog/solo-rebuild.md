# OpenFrost — Solo rebuild backlog

- **Specification:** [v0.1 solo rebuild](../docs/ai-os-project-spec.md)
- **Current assignment:** S09 complete and landed on main; S07's one-working-week owner-use gate remains open

These are local backlog identifiers, not GitHub issue numbers. S00–S06, S08
Phase 1, and S09 are complete on `main` (see each handoff); S07 remains in
progress, and the unfinished S08 Phase 2 web work is preserved on the
`feat/ui-phase2-task-lifecycle` checkpoint branch and superseded by S09.
Ownership is not permission
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

### Follow-up: typed export/approval 404s, transport secret redaction, and doc sync (2026-11-22)

- Implemented:
  - Added `ArtifactNotFoundError` in `packages/db/src/store.ts` and mapped it to
    HTTP `404` in `apps/api/src/app.ts` and `apps/api/src/routes/exports.ts`.
  - Updated `TaskExecutor.decideApproval` to throw `ApprovalNotFoundError`
    (fixing HTTP `500` on unknown approval IDs) and `TaskExecutor.enqueueExport`
    to throw `ArtifactNotFoundError` / `ExportDestinationNotFoundError`.
  - Wrapped `fetchImpl` in `OpenAIProvider` and `OpenRouterProvider` so
    non-abort transport errors wrap into `ProviderError` with
    `redactSecret(message, apiKey)` (matching `GeminiProvider`).
  - Updated stale browser/web-UI copy in `apps/landing/app/page.tsx` and synced
    agent instructions and docs (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`,
    `.github/copilot-instructions.md`, `CONTRIBUTING.md`, `docs/`, `backlog/`).
- Verification: `pnpm lint` passed; all 5 workspace builds (`@openfrost/domain`,
  `@openfrost/db`, `@openfrost/agent`, `@openfrost/api`, `@openfrost/landing`)
  passed; 328 TypeScript tests passed (83 domain, 54 db incl. real Windows
  DPAPI round-trips, 121 agent, 70 api); `cargo test` in `apps/tui` passed (32
  tests). Does not close S07's one-working-week owner-use gate.
- PR: [#38](https://github.com/ParasRana1729/openfrost/pull/38). Its initial
  Windows CI run passed TypeScript checks but Rust 1.100 Clippy rejected the
  existing indexed project-memory loop (`needless_range_loop`). Replaced that
  loop with `iter().enumerate()` without changing row ordering or indices.
  Local Rust formatting, Clippy, all 32 tests, and build passed again on Rust
  1.99.1; the updated head requires passing Windows CI before merge.

### Priority 3 checkpoint — secondary indexes

- On `perf/s07-db-indexes-and-async-auth`, generated additive
  `0006_indexes.sql`, its journal entry and snapshot from the eight matching
  schema declarations. Fresh-install and populated-0005 upgrade tests verify
  index columns/non-uniqueness, unchanged rows, restart idempotence, foreign
  keys, and database integrity.
- Verification: `pnpm --filter @openfrost/db test -- test/migrations.test.ts`
  passed (the script ran all 56 DB tests, including real Windows DPAPI);
  `pnpm exec eslint packages/db/src/schema.ts packages/db/test/migrations.test.ts`
  and `git diff --check` passed.
- Remaining: async password hashing/callers and deterministic login backoff;
  full workspace checks and final handoff. No push/merge; S07 remains open.

### Priority 3 checkpoint — async auth and deterministic backoff

- Replaced production synchronous scrypt with a typed promisified crypto
  adapter, preserving hash format/parameters and timing-safe comparison;
  owner creation/verification and all direct callers now await completion.
  The owner's approved scope exception changes only the affected async test
  in `packages/agent/test/failures.test.ts`.
- Owner insertion rechecks existence in an immediate transaction after
  hashing, preserving exactly one owner under overlapping different-name
  setups. Login verification is serialized per app so overlapping attempts
  cannot race through the five-failure threshold. The fifth failure returns
  401; subsequent attempts return 429 for 30 seconds, with ceil-rounded
  `Retry-After` from `ctx.now()`. Success and window expiry reset failures.
- Final verification: `pnpm lint` passed; `pnpm test` passed all 346 tests
  (83 domain, 64 DB including real Windows DPAPI, 121 agent, 78 API);
  `pnpm build` passed all five workspace packages/apps. Initial build caught
  Node's overloaded-scrypt promisify typing (TS2554/TS18046/TS2345); fixed
  with a typed callback adapter, then reran full lint/test/build successfully.
  Commands used bounded timeouts (120 seconds lint, 180 seconds test/build),
  with no timeouts reached. `git diff --check` passed.
- Targeted verification: DB password/persistence suites passed 15 tests;
  API auth suite passed 23 tests. Regenerating Drizzle reported no schema
  changes. Built-API real loopback HTTP smoke passed in a throwaway home:
  setup 201, CSRF logout 200, five wrong logins 401, valid login blocked
  with 429/Retry-After 30, injected-clock expiry login 200, tasks 200.
- Limitations: throttle state is process-local and resets at restart; no
  interactive TUI/owner-week or paid-provider evaluation, Rust checks, CI,
  push, or merge. Existing landing `metadataBase` build warning remains
  outside scope. Final handoff below will record the implementation SHA.

### Handoff — Priority 3 (perf/s07-db-indexes-and-async-auth)

- **Commits:**
  - `1594cb64fccc83c596da077fe25ea18d03a9f3c7` — additive indexed schema,
    generated 0006 migration/journal/snapshot, fresh and populated-upgrade tests.
  - `b8cdf9e0f702a52c006da89922b6a22089378e89` — final implementation:
    async-compatible owner hashing/auth, awaited callers, deterministic backoff.
- **What changed:**
  - `packages/db/src/schema.ts`, `packages/db/drizzle/0006_indexes.sql`,
    `packages/db/drizzle/meta/{_journal,0006_snapshot}.json`: eight non-unique
    indexes on events/task, runs/task, artifacts/task, tasks/state,
    approvals/task and state, grants/project, routines/state; no table rebuilds.
  - `packages/db/src/{passwords,store}.ts`: async scrypt with unchanged
    `scrypt$N$r$p$salt$hash` format and timing-safe verification; transactional
    post-hash single-owner check. Legacy credentials are not rehashed.
  - `apps/api/src/routes/auth.ts`: awaited setup/login; per-app serialized
    login checks; five failed authentications trigger a 30-second in-memory
    window, 429 plus ceil-rounded Retry-After, reset on success/expiry. All
    throttle timing uses injected `ctx.now()`; trust guards remain unchanged.
  - DB migration/password/persistence tests, API auth tests, and the approved
    direct caller in `packages/agent/test/failures.test.ts`: fresh/0005 upgrade
    preservation and restart, old-hash compatibility, setup races, threshold,
    Retry-After rounding, exact expiry, reset, simultaneous attempts, and guards.
- **Verification run:**
  - `pnpm install --offline --frozen-lockfile`: passed; worktree-local
    node_modules and build outputs, no lockfile/dependency changes.
  - `pnpm --filter @openfrost/db exec vitest run test/passwords.test.ts test/persistence.test.ts`:
    passed, 15 tests; `pnpm --filter @openfrost/api exec vitest run test/auth.test.ts`:
    passed, 23 tests.
  - `pnpm lint`: passed (120-second bound).
  - `pnpm test`: passed twice, 346 tests / 36 files, zero skips or failures
    (83 domain, 64 DB, 121 agent, 78 API; 180-second bound). Real Windows
    CryptProtectData/CryptUnprotectData, purpose rejection, provider-key
    storage and API key-redaction tests passed, not mocked or skipped.
  - `pnpm build`: final run passed all five workspace builds (180-second
    bound). Initial scrypt overload typing failure was corrected; full
    lint/test were rerun after the typed adapter fix. No command timed out.
  - `pnpm --filter @openfrost/db exec drizzle-kit generate --name indexes`:
    passed; no schema changes after generation, snapshot links to 0005.
  - `node` built-API loopback HTTP smoke (30-second bound): passed in a
    disposable home, setup/logout/401 threshold/429+Retry-After/expiry/login/
    authenticated tasks; server closed and home removed. Clock was injected.
  - `git diff --check`: passed; backlog relative links checked before handoff.
- **Not run / Limitations:**
  - Backoff is single-owner, app-instance memory, not persisted; restarting
    clears it. Verification is serialized, not other API traffic. No broad
    load/latency benchmark or interactive TUI run was performed.
  - Migration upgrade fixture uses real migrations 0000–0005 and populated
    SQLite data, not the owner's live database. No owner data was touched.
  - Existing unrelated landing `metadataBase` warning remains. No Rust checks
    (no Rust edits), CI, real-provider calls, push, or merge; owner review is
    next. S07's one-working-week owner-use evaluation remains open.

## S08 — Improve Control Center clarity and feedback (Phase 1)

- **Status:** Complete (merged on `main`; unfinished Phase 2 web work checkpointed on `feat/ui-phase2-task-lifecycle` and superseded by S09)
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

- **Status:** Complete (landed on `main` via PR #33, PR #34, PR #35, and PR #37)
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

- [x] `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` (27
      tests), and `cargo build` pass locally; the CI `tui` job runs the same
      steps on windows-latest. `pnpm lint && pnpm test && pnpm build` pass
      after `apps/web` removal.
- [x] First-run owner creation and login work from the TUI against the real
      local API; every mutating TUI action sends the CSRF token header.
- [x] The assistant loop is exercised manually end to end against the real API:
      queue a task, watch it stream live via authenticated SSE, open its detail,
      and view rich Markdown artifacts; export approval grant and deny work.
- [x] Projects, routines, memory, and settings flows perform their CRUD
      operations through the same API endpoints the web app used.
- [x] `apps/web` is removed; `apps/landing` still builds; the API, packages,
      and database are unchanged and existing tests pass.
- [x] Spec and docs name the TUI the primary interface and the landing page's
      role; no committed secrets; TUI holds the session cookie and CSRF token
      in memory only.
- [x] Stream-first Codex/OpenCode UX: bottom composer, Enter-to-submit, prompt
      history, slash commands, mouse wheel scrolling, rich Markdown renderer,
      live authenticated SSE streaming, fast 80ms spinner, and informative
      step timeline.

### Handoff

- Landed on `main` via PR #33, PR #34, PR #35, and PR #37 (commits `ce726c6`,
  `d0b3366`, `6f6da2b`, `2eb944c`): the Rust crate at `apps/tui` with full
  functional parity, Codex/OpenCode stream UX (authenticated SSE activity feed,
  rich Markdown rendering with code blocks and headers, mouse and keyboard
  scrolling, prompt history, slash commands, masked DPAPI secret key feedback,
  and animated braille spinner), and split task-detail layout with isolated
  report scrolling.
- Checks run on `main`: `cargo fmt --all -- --check`,
  `cargo clippy --all-targets -- -D warnings`, `cargo test` (32 passed as of PR
  #37), `cargo build`, `pnpm lint`, `pnpm test` (328 passed after the S07
  hardening follow-up), and `pnpm build`. Configured CI passed on
  `windows-latest` for PR #37.
- PR #31 was closed as superseded by PR #32 and #34.
- Next: continue S07 release hardening and one-working-week owner-use gate.

### Follow-up: TUI API lock contention and SSE/polling refresh storms (2026-11-22)

Branch `perf/tui-concurrency-and-sse` (S09/S07 hardening follow-up; not merged,
awaiting review). It changes only `apps/tui`: no API routes, Zod schemas, or
server behavior, and no keybinding, mouse, slash-command, or layout changes. It
does not close S07's one-working-week owner-use gate.

- Implemented (lock contention): `ApiClient` is now `Clone`; its CSRF token
  lives in `Arc<RwLock<Option<String>>>` (std lock, held only to read or swap
  the value, never across `.await`) shared by every clone. The global
  `Arc<Mutex<ApiClient>>` and every `api.lock().await` in `app.rs`/`main.rs`
  are gone, so a slow request (a 30 s timeout, a long task-detail fetch) no
  longer blocks every other request. `setup`/`login` swap the token
  atomically; each request reads it once when building headers; `logout`
  clears it only if it is still the token the logout started with, so a slow
  logout cannot wipe a newer login's token.
- Implemented (parallel reads): `App::refresh` for Assistant runs
  `events`/`pending_approvals`/`routines`/`projects`/`tasks` with
  `tokio::join!`, then fetches `task_detail` for the newest task only if the
  list returned one; Settings runs `settings`/`destinations` with
  `tokio::join!`. Loaders live in the new `apps/tui/src/refresh.rs`.
- Implemented (SSE and refresh storms): `subscribe_events` moved to
  `event.rs` and takes an `Arc<Notify>`; a successful login/onboarding or
  logout (`apply.rs`) notifies it so the stream reconnects at once on sign-in
  instead of waiting out up to 30 s of backoff, replaces a stream opened under
  a previous session, and closes immediately on logout (where the reconnect
  attempt gets 401 and drops back to disconnected). Connection state is
  reported as `AppEvent::SseConnection`
  and tracked in `App`. While connected there is no polling at all (the old
  400 ms busy / 4.8 s idle polling is gone); only while disconnected does a
  fallback poll run (about 1 s when a run is active, 4.8 s idle). `Activity`
  bursts coalesce into one refresh per 320 ms window, a tab never has two
  refreshes in flight, and a request that arrives mid-refresh is replayed once
  when the running one finishes. An SSE (re)connect or disconnect queues one
  catch-up refresh. The old code sent an `Activity` (so a refresh) on every
  failed reconnect.
- Found en route: the shared `reqwest` client has a 30 s total-request
  timeout, which also covers streaming the response body, so the SSE stream was
  being cut every ~30 s. The SSE stream now uses a second client (same cookie
  jar, 10 s connect timeout, no total timeout, and a 45 s per-read timeout —
  3× the API's 15 s heartbeat — so a silent half-open connection drops and
  reconnects) from `ApiClient::stream_http()`.
  Not observed against the real API in this slice (see not run below).
- Verification (inside `apps/tui`, Windows, 2026-11-22):
  `cargo fmt --all -- --check` passed; `cargo clippy --all-targets -- -D
  warnings` passed; `cargo test` passed (64 tests, up from 32, including
  `apply::tests::logout_wakes_sse_to_close_previous_session_stream`);
  `cargo build` passed. The
  new tests use `httpmock` and `tokio` paused time (dev-dependency feature
  `test-util`, no new crates in the lockfile): a slow request does not block
  another clone; independent reads overlap in time; the Assistant/Settings/Tasks
  loaders hit each endpoint once, skip `task_detail` when there are no tasks or
  the list fails, and keep the other results when one read fails; CSRF
  propagation across clones for login, setup, re-login, logout, and eight
  concurrent mutations; the slow-logout race; SSE open/activity/disconnect
  reporting, backoff doubling to the 30 s cap, a wake that cuts a backoff short
  (including a wake sent just before the wait), a login wake that connects
  well inside the 1 s backoff, and a logout wake that closes the prior session
  stream; the debounce and fallback-polling state machine, and in-flight/replay
  behavior through `App`. `pnpm` checks were not run because nothing outside
  `apps/tui` changed.
- Not run/verified: the TUI against the real API (no manual login/SSE/task run,
  so the 30 s stream-cut finding, 45 s per-read timeout against live 15 s
  heartbeats, and the end-to-end disappearance of the 400 ms polling are
  reasoned from the code and mock-server tests, not observed); no CI run yet
  (branch is not pushed or opened as a PR); the timing assertions (for example
  "five 300 ms reads finish in under 1 s") use generous margins but are
  wall-clock based.
- Known limitations: while SSE is connected the only refresh triggers are
  `activity` pings, tab switches, and mutations; a silent half-open connection
  now times out after 45 s via `read_timeout` (3× the 15 s heartbeat) and
  reverts to fallback polling until reconnected. In-flight tracking is per tab
  and cleared by an explicit done event, with a 40 s staleness escape in case a
  refresh task is lost. The debounce adds up to 320 ms before an activity
  refresh (previously immediate, but a burst could trigger a refresh per ping).
  The window and poll intervals are constants in `refresh.rs`.
- Next: owner review of the branch; then, with the owner's explicit merge
  authorization for this change, push, open a PR, confirm CI on `windows-latest`,
  and merge. A short manual pass (log in, queue a fake-provider task, watch the
  live stream, drop and restart the API) would close the not-run items above.

### Pre-merge review fixes (2026-11-22)

- Confirmed and fixed three concurrency/security regressions before landing:
  healthy SSE connections now rotate after a non-renewable five-minute
  lifetime, forcing authentication again independently of heartbeat traffic;
  task and routine detail reads carry request/navigation/session generations
  so stale responses cannot reopen or overwrite a newer selection; failed or
  partially failed tab refreshes retry with exponential backoff capped at
  about 30 seconds, without needing another activity event. Successful reads
  still do not poll while SSE is connected.
- Five-minute rotation is a client mitigation, not immediate server-side
  session revocation. Local logout still closes the old stream immediately.
  Silent stream headers/body still time out after 45 seconds.
- Added held-open loopback socket tests for healthy rotation, revocation at
  rotation, silent response/read timeouts, and logout TCP closure/cookie
  removal; deterministic regressions cover reverse-order task/routine reads,
  close/navigation/logout, action target IDs, obsolete refresh completion,
  partial failures, and retry recovery/backoff.
- Verification on Windows: Rust fmt, Clippy with warnings denied, all 88
  tests, and build passed. These supersede the initial 64-test result above.
  No paid-provider calls or interactive live API/TUI workflow were run.
- Integrated S07 PR #38 (remote main 220d778) with a merge commit; both
  backlog additions were retained and history was not rewritten. Final
  independent review found no remaining concrete blockers.
- Post-integration verification: pnpm lint, all 328 TypeScript tests (83
  domain, 54 db including real Windows DPAPI, 121 agent, 70 API), and pnpm
  build passed. Rust fmt, Clippy with warnings denied, all 88 tests, and
  build passed again. The worktree initially lacked node_modules; offline
  frozen-lockfile installation succeeded before rerunning the pnpm suite.
- Next: open the performance PR and merge only after Windows CI passes,
  verify remote main, then remove the clean performance worktree. S07
  owner-use evaluation and the interactive workflow check remain open.

### Handoff — Priority 5B (refactor/tui-split-app-and-ui)

- **Commits:**
  - `1ca92965ac6f100a1949df8fb37984db97e0395c` — split application state and
    input handlers into tab/dialog modules (S09 checkpoint).
  - `6492352fa327101b5271758de3486fab4580aa0a` — split tab/dialog rendering
    (S09 checkpoint; complete implementation SHA verified below).
- **What changed:**
  - Priority 5B only, based on `a52e85c` (main/origin/main at worktree start,
    with Priority 1 PR #38 and Priority 2 PR #39 merged). All work and
    commands stayed in `.worktrees/priority-5b`, on the existing assigned
    branch; no other worktree was edited.
  - `apps/tui/src/app.rs` became `app/mod.rs`, `assistant.rs`, `tasks.rs`,
    `projects.rs`, `memory.rs`, `routines.rs`, `settings.rs`, and `dialogs.rs`.
    `mod.rs` owns global App/Screen/Tab/Notice state, auth, shortcuts,
    navigation/mouse dispatch, refresh/mutation helpers, and the original
    25 application tests. Tab modules own their state/input handlers;
    dialogs owns modal types, confirmation handling, and form submission.
  - `apps/tui/src/ui.rs` became the same eight-module layout under `ui/`.
    `mod.rs` retains rendering dispatch, palette/helpers, auth/onboarding,
    tab chrome, status and notice rendering. Tab modules own their renderers;
    `dialogs.rs` owns the tab picker, confirmation/form overlays and geometry.
    Existing inline slash-help content stays within the Assistant stream.
  - Narrowed formerly public declarations to `pub(crate)` and exposed
    internal handler/renderer entry points only as `pub(super)` where needed;
    retained existing `crate::app` imports through re-exports. No dependencies,
    API calls, payloads, keybindings, layout, colors, or concurrency logic changed.
  - Baseline extraction comparison: all 87 app functions (including all 25
    tests), all 40 UI functions, and all 19 app struct/enum declarations match
    `a52e85c` after ignoring whitespace and visibility changes. All 88 Rust
    tests remain; no assertions were weakened or tests removed/ignored.
    `refresh.rs`, `event.rs`, `apply.rs`, and `contracts.rs` are unchanged.
- **Verification run:**
  - Final complete rerun on implementation
    `6492352fa327101b5271758de3486fab4580aa0a`, Windows, 2026-11-24,
    from `.worktrees/priority-5b/apps/tui`. Every Cargo command used
    `CARGO_TARGET_DIR=C:/Users/paras/Documents/openfrost/.worktrees/priority-5b/apps/tui/target`;
    this ignored target directory is private to this worktree, not shared
    with main or another worktree. Each subprocess had the finite timeout
    listed below (the final sequential wrapper also had a 900-second bound).
  - `cargo fmt --all -- --check`: PASS (60-second bound).
  - `cargo clippy --all-targets -- -D warnings`: PASS, no warnings
    (180-second bound).
  - `cargo test`: PASS, **88 passed, 0 failed, 0 ignored, 0 measured,
    0 filtered out**; test execution 0.82 s (600-second bound).
  - `cargo build`: PASS (300-second bound).
  - Preliminary `cargo check --manifest-path apps/tui/Cargo.toml --all-targets`
    from the worktree root: PASS after import cleanup. Its first cold-cache
    invocation hit the 240-second bound while building dependencies; a
    180-second retry completed. Initial `cargo test` likewise timed out after
    600 seconds compiling dependencies before any tests ran, then passed all
    88 tests on a same-bound retry. Initial `cargo build` timed out at its
    300-second bound while building the final binary, then passed on a
    same-bound retry. These were recovered build-time timeouts, not test
    assertion failures; the final full rerun above had no timeouts.
  - `git diff --check` and staged diff whitespace checks: PASS. Scope review
    found only the app/ui module conversion and this appended backlog handoff.
- **Not run / Limitations:**
  - No interactive TUI/live API or manual visual sweep; visual preservation
    is supported by unchanged rendering bodies and existing wide/narrow
    Ratatui TestBackend tests, not a new all-screen screenshot comparison.
    Auth/SSE/concurrency regressions use the retained mocks, paused clocks,
    and loopback socket tests, not real owner sessions or paid providers.
  - `pnpm lint`, `pnpm test`, and `pnpm build` were not run: no TypeScript,
    workspace configuration, dependencies, or shared contracts changed.
  - No CI, push, PR, or merge performed, as instructed. S07's one-working-week
    owner-use gate remains open. No known implementation blockers remain.
  - Next: owner review of these local commits; optional interactive smoke
    check, then separately authorize publishing/CI/landing. Priority 4's
    contracts work remains separate; do not overwrite its files on integration.


### Checkpoint — S09 Priority 4 contract parity (2026-11-24)

- Branch `test/s09-contract-parity`, isolated `.worktrees/priority-4`, based on
  `a52e85c` (includes prerequisites PR #38 and #39). Priority 4 only; no push or
  merge authorized. No production app/UI refactor or Priority 5B changes.
- Added canonical shared fixtures and Zod/Rust parity checks, lightweight
  domain transport envelopes, and explicit Windows CI test-step documentation.
  Corrected nested routine views, project updates without grants, title-less
  task serialization, and omitted-versus-null provider model representation.
  Existing mock fixtures needed only a required task title and nested routine
  object (the latter is a two-line test-only change in `app.rs`).
- Verification: root `pnpm lint && pnpm test && pnpm build` passed; all 503 TS
  tests passed (258 domain including 175 new contract tests, 54 db with real
  Windows DPAPI, 121 agent, 70 API). Rust fmt, Clippy with warnings denied,
  all 117 tests (38 contract tests), and build passed using
  `--manifest-path apps/tui/Cargo.toml` from this worktree root. A subsequent
  append-only root test run and Rust test run passed with those same counts.
- Initial install/compilation timeouts and one existing API DPAPI timeout were
  resolved by bounded reruns; no test timeout settings were weakened. Build
  still emits the existing landing `metadataBase` warning. Detailed final
  handoff follows in a separate commit referencing this implementation SHA.
- Not run: remote CI or interactive live API/TUI/provider workflow. S07's
  one-working-week owner-use gate remains open.


### Handoff — Priority 4 (`test/s09-contract-parity`)

- **Commits:** `e7b849e9bc53585e50901a51f0f7a4df7ee6f29a` — implementation checkpoint,
  `test(s09): Enforce shared wire contract parity`. This handoff is committed
  separately after that implementation. Base: `a52e85c` (PR #38/#39 present).
- **What changed:**
  - `packages/domain/src/transport.ts` / `src/index.ts`: exported strict Zod
    transport/auth envelopes composed from canonical domain entities, plus
    inferred types. Existing request/entity validators remain authoritative;
    setup/login definitions match the existing route-local validators without
    modifying the out-of-scope API route. Setup itself completes onboarding.
  - `packages/domain/test/fixtures/contracts/`: 36 checked-in JSON files:
    128 named payload examples (90 response/entity, 38 request) across 19
    response/entity and 16 request shapes; 42 variants across 11 enums,
    including every explicitly requested enum and all 51 event types. Includes
    null/populated fields, omitted optionals/default token counts, empty values,
    both schedule variants, all memory proposal states, and fake settings.
    The README documents maintenance, decisions, and limitations.
  - `packages/domain/test/contracts.test.ts`: 175 new Vitest tests against real
    exported Zod schemas, strict extra-key rejection, optional-versus-nullable
    checks, exhaustive enum/event coverage, and fixture inventory registration.
  - `apps/tui/src/contracts.rs`: 38 contract tests read the exact same JSON files;
    response round-trips assert every fixture field survives (serde cannot
    silently ignore a renamed field); independent concrete request constructors
    serialize to exactly the canonical objects, including absence versus null.
    Added a ProviderId enum mirror; no codegen or dependency/toolchain additions.
  - Genuine mismatches fixed, with domain/API shapes as authority: routine views
    now consume nested `routine` rather than flattened data; base project update
    responses default absent grants to an empty list; missing required task
    titles now fail serialization without changing app construction sites;
    provider config's generic model field can represent an explicit reset null
    while preserving existing callers' omission semantics.
  - `apps/tui/src/api_tests.rs`: corrected the existing title-less HTTP request
    fixture. `apps/tui/src/app.rs`: corrected only two lines in the existing
    test-only routine fixture to nest the entity. No production app/UI code,
    behavior, layout, modules, or Priority 5B refactor changed; `ui.rs` untouched.
  - `.github/workflows/ci.yml`: both existing `windows-latest` test steps name
    and document parity coverage; `checks` runs root `pnpm test`, `tui` runs
    `cargo test`. Cargo remains outside the pnpm workspace. No shared build
    outputs, dependencies, lockfiles, API implementation or other worktree edits.
- **Verification run (Windows, this worktree):**
  - `pnpm install --offline --frozen-lockfile`: passed on bounded retry; all
    281 packages reused with no downloads. pnpm reported ignored build scripts;
    subsequent native SQLite/DPAPI tests nevertheless passed in this worktree.
  - `pnpm lint && pnpm test && pnpm build`: passed in full. Lint: no errors;
    tests: **503 passed, 0 failed** in 35 files (258 domain, 54 db, 121 agent,
    70 API), including real Windows DPAPI round-trip/provider-key tests; build:
    all five workspace packages/apps passed, including static landing export.
  - `pnpm --reporter=append-only test`: additional root run passed with the same
    exact 503-test/35-file breakdown and real Windows DPAPI coverage.
  - `cargo fmt --manifest-path apps/tui/Cargo.toml --all -- --check`: passed.
  - `cargo clippy --manifest-path apps/tui/Cargo.toml --all-targets -- -D warnings`:
    passed, no warnings.
  - `cargo test --manifest-path apps/tui/Cargo.toml`: **117 passed, 0 failed,
    0 ignored**, including 38 contract tests (88 baseline tests minus 9 inline
    contract tests replaced by these 38). Repeated final run passed again.
  - `cargo build --manifest-path apps/tui/Cargo.toml`: passed. These manifest-path
    commands are the crate-local required Rust suite, invoked from the isolated
    worktree root; default target output stays in this worktree's `apps/tui/target`.
  - `git --no-pager diff --check`: passed before implementation commit.
- **Not run / Limitations:**
  - No push, PR, merge, or remote CI run, as instructed. CI execution is configured,
    not observed remotely. No paid-provider calls or interactive live API/TUI
    onboarding/session/task/routine workflow; this is deterministic contract and
    existing mock/state-machine test coverage. S07 owner-use gate remains open.
  - Initial bounded attempts timed out: offline install at 120 s, focused Vitest
    at 120 s, and initial Rust compiles at 300 s / 600 s. Bounded reruns completed;
    no shared target/node build output was borrowed from another worktree.
  - First full pnpm attempt passed lint but had one API provider-key DPAPI test
    exceed its existing 20 s timeout (69/70 API passed); build was short-circuited.
    The complete rerun and additional test rerun passed without changing timeouts.
    First full Rust run exposed six tests using the same obsolete routine fixture
    (111 passed, 6 failed); the test-fixture-only correction resolved all six.
  - Landing build retains its pre-existing `metadataBase` warning; not changed
    in this slice. No Rust warnings remain under warnings-denied Clippy.
  - Fixtures are finite examples, not full equivalence proofs for Rust strings,
    ranges, every omission, or Zod refinements. The API remains the validation
    and security boundary. New auth domain schemas match, but are not yet
    imported by, the existing out-of-scope route-local auth validators.
  - `SetProviderConfigRequest<Option<String>>` tests null-reset wire encoding;
    the existing API helper accepts only the default specialization and no new
    UI reset action was added. Source-compatible optional title storage is
    retained, but missing titles fail serialization rather than being sent.
- **Next:** owner review of this branch/implementation and handoff. Push or merge
  only with explicit authorization; confirm both Windows CI jobs then. No other
  priority was started.


### Review follow-up — Priority 4 auth source of truth (2026-11-24)

- **Implementation commit:** `7b7083b597fd38f8346d5211ad4f37ebcd3c3bfb` —
  `fix(s09): Share production auth validators`. This SHA/verification handoff
  is committed separately after the tested implementation.

- Addressed the review's P2 coverage gap on `test/s09-contract-parity` in
  `.worktrees/priority-4`, with the approved scope extension to
  `apps/api/src/routes/auth.ts`. Setup/login now import `setupRequestSchema`
  and `loginRequestSchema` from `@openfrost/domain`, so production API routes
  and parity fixtures exercise the same validators, not equivalent copies.
  Removed both route-local definitions and the now-unused Zod import.
- Verified both removed definitions were textually identical to their domain
  definitions before replacement: strict unknown-key rejection, default owner,
  username bounds, and distinct setup/login password bounds are unchanged.
  No session, CSRF, cookie, credential-storage, onboarding, or route behavior
  changes. Updated the domain comment and fixture README to reflect actual use.
  This supersedes the earlier handoff's route-local-auth limitation.
- Verification, all from this isolated worktree, passed on the first attempt:
  - `pnpm lint`: PASS (exit 0, no lint errors).
  - `pnpm test`: PASS, **503 passed, 0 failed**, 35 test files: domain
    **258** (including **175** contract tests), db **54**, agent **121**, API
    **70**. Real Windows DPAPI round-trip and provider-key tests passed.
  - `pnpm build`: PASS (exit 0), all five workspace packages/apps, including
    the static landing build; its pre-existing `metadataBase` warning remains.
    Commands ran sequentially with bounded subprocess
    timeouts: lint 180 s, test 300 s, build 300 s; no timeout occurred.
  - `git --no-pager diff --check`: PASS before committing.
  - Rust not rerun: no Rust production code, tests, fixtures, dependencies, or
    Cargo configuration changed in this follow-up; the prior 117-test Rust
    validation remains recorded above, not claimed as newly rerun.
- Integration with isolated Priority 5B: its moved test helper
  `sample_routine()` is at `apps/tui/src/app/mod.rs:790` (reviewed P5B head
  `e8f7e3f`). Carry Priority 4's two-line nesting correction into that helper:
  line 792 must open `"routine": {` before the entity fields, and line 797 must
  close that object after `updatedAt`, before `nextOccurrenceAt`. The original
  `apps/tui/src/app.rs` is deleted by P5B; do not resurrect it or lose the fix
  when resolving the move. Retain both branches' appended backlog entries;
  append conflicts are expected when integrating these isolated branches.
- Limitations: no remote CI, live API/TUI manual workflow, push, PR, merge, or
  edits to another worktree. The S07 owner-use gate remains open. Original
  finite-fixture/model-reset limitations still apply. Next: owner integration
  review, preserve the moved fixture correction and both backlog handoffs,
  then rerun affected checks on the integrated branch with authorization.

### Handoff — Priority 5A (refactor/agent-split-executor)

- **Commits:** `fe922d96615ed5d3f2dbae7aede57dcd2bc31e64` —
  `refactor(agent): Split executor internals (S07)` (implementation checkpoint);
  `8692104d5b02d3b82d2be5c27d092e9428743a73` — trim three EOF blank lines
  only (final implementation checkpoint). Initial handoff commit:
  `48145ba858b88a80224e24b92aaf3c907eb61ab7`.
  Based on verified `origin/main` `a52e85c5a022ccec4710fe633b6fe2af3cfe087e`,
  which includes prerequisite PR #38. Local review only; not pushed or merged.
- **What changed:**
  - `packages/agent/src/executor/workflows.ts`: workflow policies and first-user
    context builders for research briefs, project updates, and weekly plans,
    including starting-URL prefetch and bounded recent-update formatting.
  - `packages/agent/src/executor/exportPipeline.ts`: immutable proposal creation,
    approval waiting, granted-export revalidation, create-only artifact-file
    writing, and export refusal/abandonment errors. Approval decisions still
    enter through `TaskExecutor` and resolve its shared waiter map.
  - `packages/agent/src/executor/appendices.ts`: report Markdown formatting and
    runtime-owned retrieved-source, project-file, and saved-update appendices.
  - `packages/agent/src/executor/records.ts` and `errors.ts`: internal run records
    and shared internal-error/abort helpers, avoiding circular imports.
  - `packages/agent/src/executor.ts`: reduced from 1,781 to 1,001 lines; retains
    queue draining, the global run lock, limits, tool dispatch, cancellation,
    recovery, failure classification, and internal report persistence. Public
    exports are preserved through re-exports; `index.ts` is byte-identical,
    including the existing fake-provider inventory-heading export. Relative
    imports retain `.js`; no dependencies, tests, assertions, limits, event
    payloads, messages, or security checks were changed.
  - Extraction review compared moved method bodies/policy text with the baseline
    after only member-reference and indentation normalization. A TypeScript AST
    comparison confirmed 25 retained orchestration methods are byte-identical;
    constructor wiring and the two delegating methods were reviewed separately.
- **Verification run** (all commands from this worktree, Windows):
  - `pnpm install --offline --frozen-lockfile`: first attempt timed out at
    120 seconds (279/281 added); a separate second 120-second attempt passed,
    281 packages reused, zero downloaded. pnpm warned that dependency build
    scripts were ignored; subsequent builds and real SQLite/DPAPI tests passed.
  - `pnpm exec tsc -p packages/agent/tsconfig.json --noEmit`: failed before
    installation completed (`tsc` not found); superseded by the full build.
  - `pnpm lint`: passed (120-second command bound).
  - `pnpm build`: passed all five workspace builds (180-second command bound).
    Landing emitted an unset-`metadataBase` warning; not changed in this slice.
  - `pnpm --filter @openfrost/agent test`: initial focused attempt timed out at
    the 120-second command bound; not counted as a pass.
  - `pnpm test`: completed with failure (600-second bound): API 68 passed,
    2 failed; the real-DPAPI provider-key test exceeded its existing 20-second
    timeout and the following key-presence assertion failed.
  - `CI=true pnpm --filter @openfrost/api exec vitest run test/settings.test.ts`:
    9 passed, 1 failed (same existing 20-second DPAPI test timeout;
    180-second command bound). No assertions or test timeouts were changed.
  - `CI=true pnpm --filter @openfrost/agent test`: passed, 121 tests across
    13 files (300-second command bound).
  - `CI=true pnpm test`: passed, all 328 tests across 34 files: domain 83,
    db 54 (including real Windows DPAPI round-trips), agent 121, API 70
    (including all settings tests), with no skipped tests (600-second bound).
    `CI=true` selects non-interactive output; tests were not weakened.
  - `git --no-pager diff --check`: passed before implementation commit and
    after appending the initial handoff, but did not inspect then-untracked files.
  - `git --no-pager diff --check a52e85c5a022ccec4710fe633b6fe2af3cfe087e..HEAD`:
    final committed-range review initially found three extra EOF blank lines in
    new modules; removed in `8692104`. The range check then passed.
  - `git --no-pager diff --cached --check`: passed for the whitespace fix.
    `pnpm lint` passed again after that fix (120-second bound).
- **Not run / Limitations:**
  - Build and tests passed on `fe922d9`; not repeated after the three-line
    EOF-whitespace-only fix. Lint and the committed-range whitespace check were
    repeated and passed; no executable code changed after the passing suite.
  - No Rust checks (no Rust changes), remote CI, paid-provider calls, or manual
    live API/TUI workflow. Existing fake-provider/tool and API integration tests
    cover the refactored workflows; real-provider execution was not exercised.
  - Earlier dependency/test timing failures are recorded above; the complete
    final workspace suite passed unchanged. No unrelated timeout fixes added.
  - No push, PR, merge, or other priority implemented. S07's owner-use gate
    remains open. Next: owner review of this implementation and handoff branch.

### Integration audit — Priorities 3–5 (2026-11-24)

- Owner authorized sequential PR integration: Priority 5A, 3, 4, then 5B;
  each merge requires passing configured Windows CI. S07 remains open.
- Read-only spot-checks found no blockers: Priority 4 keeps existing API
  responses/statuses and identical shared auth validation; Priority 3 adds
  the intended async hashing and five-failure/30-second login backoff.
- The 88-test Rust baseline predates Priority 5B: d0c3ebf added 24 legitimate
  stream-lifetime, stale-read, and retry tests after the earlier 64-test
  checkpoint. Priority 5B preserves all 88 tests and moved function bodies.
- Drizzle journal idx 6/tag 0006_indexes, SQL, snapshot linkage and generated
  schema agree on exactly eight additive indexes. The upgrade test uses the
  real pre-0006 SQL migrations against populated file-backed SQLite.
- Priority 5A re-verification: pnpm lint, CI=true pnpm test (328 passed:
  domain 83, db 54 including real Windows DPAPI, agent 121, API 70), and
  pnpm build passed. Initial four-minute TypeScript and unnecessary cold
  Rust checks timed out; the complete TypeScript retry passed unchanged
  with a ten-minute bound. Rust was unchanged and will be checked by CI.
- Not run: interactive visual TUI and live-provider workflows. Primary
  checkout retains the owner-provided untracked execution brief untouched.

### Integration — Priority 3 (2026-11-24)

- Priority 5A landed via PR #40, merge c06ecce50d5f54b479f785ff1ffe92e18297955e.
- Merged origin/main into the Priority 3 branch without rewriting history;
  backlog auto-merged, preserving both complete handoffs and audit evidence.
- Re-verification on the integrated code: pnpm lint, CI=true pnpm test, and
  pnpm build all passed, including real Windows DPAPI tests. No code
  conflict or test/assertion change was needed.
- S07 owner-use gate remains open; next is Windows PR CI and authorized merge.

### Integration — Priority 4 (2026-11-24)

- Priority 3 landed via PR #41, merge a8797628d717807c34d4bc9fa29d48d433a8c0b0.
- Merged updated origin/main without rewriting history. auth.ts auto-merged:
  shared domain setup/login schemas coexist with awaited owner credentials,
  serialized verifications, five-failure/30-second backoff, 429/Retry-After,
  session/cookie/origin/CSRF behavior and all Priority 3 tests.
- The only conflict was appended backlog text; retained both sides in full.
  A line-subsequence check confirms both pre-merge backlog versions survive.
- Integrated verification: pnpm lint, CI=true pnpm test (521 passed: domain
  258, db 64 with real Windows DPAPI, agent 121, API 78), pnpm build passed.
  Rust fmt, Clippy with warnings denied, all 117 tests, and build passed.
- No paid-provider or interactive visual TUI workflow run. S07 remains open.
  Next: Windows PR CI, then authorized merge before integrating Priority 5B.

### Integration — Priority 5B (2026-11-24)

- Priority 4 landed via PR #42, merge c6b8ad9. Merged updated origin/main into
  `refactor/tui-split-app-and-ui` without rewriting history (`8cbb5b8`).
  Priority 4's nested `sample_routine()` fixture correction is present at
  `apps/tui/src/app/mod.rs` after the move; both backlog handoffs retained.
- Re-verification after the interrupted Zed audit (2026-11-24): inside
  `apps/tui`, `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`,
  `cargo test` (**117 passed**, 0 failed, 0 ignored), and `cargo build` all passed.
- Not run: interactive visual TUI, paid-provider calls, or TypeScript suite
  (no TS changes in this slice). S07 owner-use gate remains open.
  Next: push branch, open PR, Windows CI, then authorized merge.

### Handoff — `openfrost` CLI Launcher (`feat/tui-cli-launcher`, 2026-11-24)

- Scope (S09 follow-up, cut from `origin/main` at `90b66d8`): single-command
  `openfrost` binary (`[[bin]] name = "openfrost"` in `apps/tui/Cargo.toml`)
  with CLI parsing (`apps/tui/src/cli.rs`), local loopback API auto-spawn and
  lifecycle subcommands (`start`, `stop`, `status`, `logs`, `--no-spawn`,
  `--api`) in `apps/tui/src/runtime.rs` and `apps/tui/src/main.rs`, Windows
  installer (`scripts/install.ps1` + root `pnpm run install:cli`), and updated
  `README.md` quick start. Closing the TUI still leaves the background API
  running; OS-boot autostart remains out of scope (`AGENTS.md` §6).
- Verification:
  - Rust (`apps/tui`): `cargo fmt --all -- --check`,
    `cargo clippy --all-targets -- -D warnings`, `cargo test` (**130 passed**),
    and `cargo build` passed.
  - TypeScript workspace: `pnpm build` and `pnpm test` (**521 passed**: domain
    258, db 64 with real Windows DPAPI, agent 121, api 78) passed. `pnpm lint`
    failed only on pre-existing untracked `.worktrees/integration-smoke.mjs`
    (no TS/JS files changed in this slice).
  - Real workflow: isolated temp `OPENFROST_HOME` + port `18787` CLI smoke test
    verified `--version`, `status`, `start` (detached Node + `/health`), `logs`,
    and `stop` (PID validation + clean removal); owner confirmed live `openfrost`
    works.
- Not run: paid-provider calls. S07 owner-use gate remains open.
  Next: open PR from `feat/tui-cli-launcher`, verify Windows CI, and merge when
  authorized.

### Handoff - `openfrost update` Command (`feat/openfrost-update`, 2026-11-24)

- Scope (S09 follow-up, cut from `origin/main`): `openfrost update` and
  `openfrost update --check` in the Rust CLI (`apps/tui/src/update.rs`, wired
  through `cli.rs` and `main.rs`; `runtime::read_runtime_config` is now
  `pub(crate)`). Source-based installs only: it resolves the checkout from
  `repoRoot` (or the `apps/api/dist/main.js` ancestor) in `runtime.json`,
  refuses on tracked changes or a missing upstream, fast-forwards with
  `git pull --ff-only`, runs `pnpm install --frozen-lockfile` and
  `scripts/install.ps1`, and restarts the managed API if it was running. On
  Windows the running `openfrost.exe` is renamed to `openfrost.exe.old` so
  `cargo install --force` can replace it (restored on failure, deleted on the
  next update). `README.md` gained an "Updating" section.
- Verification: inside `apps/tui`, `cargo fmt`, `cargo clippy --all-targets -- -D warnings`,
  and `cargo test` (**134 passed**, including new CLI parsing, repo-root
  resolution, and dirty-tree tests) passed. `openfrost update --check` was
  smoke-tested against a real install.
- Follow-up (2026-11-24): reproduced that the installed CLI resolves the current
  checkout on `feat/tui-redesign`, reports it up to date, and then `update`
  would skip rebuilding whenever the checkout had no commits behind upstream.
  `update` now always rebuilds/reinstalls from the current clean checkout after
  its fast-forward attempt; `--check` distinguishes local commits ahead of the
  upstream. The README now documents that behavior.
- Follow-up verification: `cargo fmt --all -- --check`,
  `cargo clippy --all-targets -- -D warnings`, `cargo test` (**123 passed**),
  and `cargo build` passed in `apps/tui`; `git diff --check` passed. The
  installed `openfrost update --check` reproduced the no-new-commits state.
- Not run: a full `openfrost update` apply against a live install (pull,
  rebuild, exe swap, API restart), non-Windows apply (intentionally
  unsupported), paid-provider calls. S07 owner-use gate remains open.
  Merged as PR #46; README "Updating" section and this entry landed in a docs
  follow-up.

### Handoff — Local Auth Removal to Loopback-Only Model (`feat/remove-local-auth`, 2026-11-24)

- **Scope & Rationale:**
  - Removed local authentication (passwords, user onboarding/login screens,
    session cookies, CSRF protection, and logout) in favor of a loopback-only
    single-user model suited for a Windows-first personal AI OS.
  - Streamlines user experience: launching `openfrost` or running the TUI opens
    directly into the main Control Center without onboarding hurdles or session
    expiry.
  - Eliminates CSRF tokens and cookie handling across API and TUI clients while
    preserving all essential security invariants.
- **Architectural & Security Boundaries Preserved:**
  - **Loopback binding:** API binds strictly to `127.0.0.1` (loopback only).
  - **Browser Origin guard:** Fastify `onRequest` hook validates incoming
    `Origin` headers against allowlisted origins; foreign origins are rejected
    with `403 Forbidden`. Non-browser clients (such as the local TUI) send no
    `Origin` header and are permitted directly.
  - **Windows DPAPI secret protection:** Provider API keys remain encrypted with
    per-user Windows DPAPI; keys are stored via Settings and never exposed in
    plaintext files or logs.
  - **Folder grants & path boundaries:** Project access requires explicit root
    folder grants with canonical-path verification, junction/symlink escaping
    prevention, and bounded file reads.
  - **SSRF protection:** Public web fetch tool enforces strict DNS resolution,
    private/loopback/link-local/NAT64 address filtering, and redirect checks.
  - **Approval-bound exports:** Report exports remain guarded by explicit owner
    approval on exact immutable proposals, create-only writes, and audit events.
  - **Database schema preservation:** SQLite `users` and `sessions` tables and
    historical domain events are retained without dropping, preserving additive
    migration history and database compatibility.
- **Component Changes:**
  - `apps/api`:
    - Removed `/api/auth` endpoints (`setup`, `login`, `session`, `logout`) and
      deleted `src/routes/auth.ts`.
    - Removed `@fastify/cookie`, session tracking, and CSRF token verification.
    - Preserved `onRequest` origin validation and CORS allowlisting in `src/app.ts`.
    - Updated API test suites (`test/auth.test.ts`, `test/helpers.ts`, etc.) to
      verify origin guarding and direct loopback API access without session cookies.
  - `apps/tui`:
    - Removed `Screen::Login` and `Screen::Onboarding`, `render_auth`, password
      `TextArea`, and `Alt+X` logout action across `src/app/mod.rs`, `src/apply.rs`,
      `src/ui/mod.rs`, `src/main.rs`, and `src/api_tests.rs`.
    - Updated `ApiClient` in `src/api.rs`: removed auth endpoints (`setup`,
      `login`, `session`, `logout`), removed CSRF token header management and
      cookie jar.
    - Updated startup sequence in `src/main.rs`: checks `GET /health` and drops
      straight into `Screen::Main` (retaining retry on `Screen::Connecting` when
      `--no-spawn` is used before the API is ready).
  - `packages/domain`:
    - Removed `SetupRequest`, `LoginRequest`, `SessionResponse`, and `AuthSuccess`
      schemas and contract fixtures.
  - Documentation:
    - Updated `README.md` (security overview and quick start) and `AGENTS.md`
      (direction, target architecture, and rule 8) to reflect the loopback-only
      single-user model.
- **Verification Commands:**
  - `pnpm lint && pnpm test && pnpm build`
  - `cargo fmt --all --manifest-path apps/tui/Cargo.toml -- --check`
  - `cargo clippy --manifest-path apps/tui/Cargo.toml --all-targets -- -D warnings`
  - `cargo test --manifest-path apps/tui/Cargo.toml`
  - `cargo build --manifest-path apps/tui/Cargo.toml`
  - `cargo install --path apps/tui --locked`
- **Limitations / Not Run:**
  - No paid-provider model or web-search calls.
  - S07 owner-use gate remains open.
  - Next steps:
  - Full verification suite run by `@verifier`.
  - Open PR from `feat/remove-local-auth`, verify Windows CI, and merge upon owner authorization.

## S09a — Provider choice: add AMD Token Factory

- **Status:** Implemented locally on `feat/amd-tokenfactory-provider` (pending verification and real-key evaluation)
- **Depends on:** S09

Owner-approved spec change (2026-11-26): the built-in provider set extends
from three to four (`openai`, `gemini`, `openrouter`, `tokenfactory`) to add
AMD Radeon Token Factory (`https://developer.amd.com.cn/radeon/tokenfactory`),
one active at a time, each with its own DPAPI-protected key and configured model.
Still no per-task provider selection and no plugin system — four built-in
adapters only.

### Acceptance criteria

- [x] The owner can choose `tokenfactory` as the active provider in Settings
      (API and TUI); the choice and its model persist and take effect on the
      next run without a restart.
- [x] Token Factory's `rc-` key is stored DPAPI-protected under its own
      purpose (`provider-key:tokenfactory`), never echoed or logged, and
      scrubbed by log and memory secret redaction patterns.
- [x] `TokenFactoryProvider` uses `POST https://developer.amd.com.cn/radeon/api/v1/chat/completions`
      with function calling mapped to the shared tool seam, honest
      `webSearchSkippedReason` reporting for web-grounded runs (since Token
      Factory has no hosted search plugin), quota/rate-limit hints, truncation
      and content-filter handling, and key redaction.
- [x] Injected-transport tests, API settings tests, shared Zod <-> Rust
      contract parity fixtures, and TUI form/settings tests cover `tokenfactory`
      without real API keys or paid calls.
- [ ] Real-model evaluation with an owner `rc-` key on AMD Token Factory.

### Handoff

- Implemented: `TokenFactoryProvider` (`packages/agent/src/tokenFactoryProvider.ts`)
  over `POST https://developer.amd.com.cn/radeon/api/v1/chat/completions`,
  sharing the OpenAI-compatible Chat Completions helper
  (`packages/agent/src/chatCompletions.ts`) with `OpenRouterProvider`. Default
  model `Qwen3.8-27B` via `OPENFROST_TOKENFACTORY_MODEL` and token cap `8192`
  via `OPENFROST_TOKENFACTORY_MAX_TOKENS`. `ProviderId` and `AssistantSettings`
  contracts, shared JSON fixtures, `ActiveProvider`, `/api/settings` routes,
  Windows DPAPI key storage (`provider-key:tokenfactory`), `rc-` secret
  redaction in `packages/agent` and `packages/domain` memory guards, Rust TUI
  contracts/settings/model presets, landing copy, spec, one-pager, and
  `AGENTS.md` all updated.
- Verification: `pnpm lint`, `pnpm test` (**510 passed**: 248 domain, 65 db,
  134 agent, 63 api), and `pnpm build` pass; inside `apps/tui`, `cargo fmt
  --all -- --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`
  (**145 passed**), and `cargo build` pass.
- Not run/verified: a real-model call against AMD Token Factory using an owner
  `rc-` API key.
- Known limitations: AMD Token Factory does not expose a hosted web-search
  plugin, so research briefs set `webSearchSkippedReason` and rely on
  `startingUrls` and `fetch_page`.

