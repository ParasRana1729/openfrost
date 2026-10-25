# OpenFrost — Solo rebuild backlog

- **Specification:** [v0.1 solo rebuild](../docs/ai-os-project-spec.md)
- **Owner for every item:** ParasRana1729
- **Current assignment:** S04 or S05 next; S03 complete (see its handoff)

These are local backlog identifiers, not GitHub issue numbers. Only S00 is in
scope for the current reset. S01–S07 are planned, unimplemented
work; ownership is not permission for an agent to start all of them or publish
anything. Implement the next explicitly assigned item in dependency order.

There is no implementation or runnable toolchain in this baseline. Documentation
describes intended behavior; verify actual code and checks before claiming progress.

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

- **Status:** Planned
- **Depends on:** S03

Add one narrow write: exporting a saved report as a new Markdown file beneath an
explicitly granted destination. Internal artifact storage already works without
this feature.

### Acceptance criteria

- [ ] Risk contracts retain `auto`, `telegram`, and `local`; standard writes use
      the `telegram` identifier but approvals occur in the local web app only.
- [ ] Review shows exact content and destination and binds the decision to an
      immutable action/run with expiry and audit events.
- [ ] Rejecting, changing content, expiring, canceling, or revoking access prevents
      execution. Duplicate decisions cannot write twice.
- [ ] Export creates a new file without overwrite; canonical-root checks and
      execution-time validation prevent escapes, including changed junctions.
- [ ] Unknown write outcomes are reconciled rather than replayed automatically.
- [ ] Delete/overwrite/shell/system/credential tools remain unavailable; approval
      cannot override a denied capability or folder boundary.

## S05 — Add inspectable, owner-approved memory

- **Status:** Planned
- **Depends on:** S03

Keep conversation history separate from durable global preferences and project
facts. Start with Markdown and straightforward retrieval, not embeddings.

### Acceptance criteria

- [ ] The owner can confirm a proposed memory, inspect its scope/source/date,
      edit it, and delete it from future memory retrieval.
- [ ] Only approved global preferences and the active project's approved facts
      enter a task's context; source history is not silently deleted with memory.
- [ ] Markdown is canonical memory content; SQLite metadata/indexes do not become
      a competing copy. External edits are detected before overwrite.
- [ ] Tests cover approval, deletion, project isolation, restart, external edits,
      and exclusion of secrets from memory proposals.

## S06 — Add owner-confirmed weekly planning routines

- **Status:** Planned
- **Depends on:** S03, S05

Reuse the task executor to draft priorities from scoped notes and recent updates.
Do not add external notifications, calendar integration, or self-assigned work.

### Acceptance criteria

- [ ] The owner reviews a task template, project/source scope, time zone, and
      cadence before enabling; routines can be paused, edited, or removed.
- [ ] The runtime runs due work without an open browser, honoring the global queue
      and execution limits, and saves a source-backed weekly-plan artifact.
- [ ] Persisted occurrence identifiers prevent duplicates across ticks/restarts,
      clock changes, and daylight-saving transitions.
- [ ] Unavailable-runtime intervals produce one missed occurrence for review per
      routine, with “run once now”/“skip”, not an automatic replay burst.
- [ ] Fake-clock integration tests cover due, missed, paused, edited, failed,
      overlapping, and restart cases.

## S07 — Harden and validate the personal-use release

- **Status:** Planned
- **Depends on:** S04, S06

This is a working-product gate, not just a passing build.

### Acceptance criteria

- [ ] `pnpm lint && pnpm test && pnpm build` passes.
- [ ] Document and perform fresh Windows setup, DPAPI round-trip under the owner,
      local authentication, migration, and clean runtime start/stop.
- [ ] Exercise all three real workflows and inspect citations, project isolation,
      approved export, rejection, cancellation, and missing-source behavior.
- [ ] Verify browser closure, runtime interruption, queued-work recovery, missed
      routines, revoked grants, duplicate requests, and unavailable provider behavior.
- [ ] Record one working week's usefulness/corrections and resolve release blockers.
- [ ] README/setup instructions describe what actually ships, where data lives,
      and the limitations; planned work is not advertised as a completed feature.
