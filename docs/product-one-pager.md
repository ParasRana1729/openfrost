# OpenFrost — Product one-pager

- **Direction:** Accepted; implementation in progress
- **Builder and first user:** ParasRana1729
- **Release:** v0.1, Windows-first local runtime and local web app
- **Source of truth:** [Full specification](./ai-os-project-spec.md)

**Current repository: S00–S06 are implemented on `main`.** The shipped product
includes research briefs, project updates, approval-bound export, owner-approved
memory, and owner-confirmed weekly planning. S07 pre-week validation was
performed on 2026-10-26; the owner's one-working-week evaluation remains open.
Draft [PR #28](https://github.com/ParasRana1729/openfrost/pull/28) adds provider-key
redaction and NAT64 private-address checks. Its implementation checkpoint passed
CI, but the changes are not merged.

## Problem

Useful work often spans a question, scattered project notes, research, and
follow-up. A chat answer alone leaves the owner to collect the evidence, save the
result, and remember to repeat the work.

## Promise

> One personal AI agent that turns requests and recurring responsibilities into
> completed work, with useful memory, visible progress, and owner control.

“AI OS” is the foundation for tasks, context, tools, memory, permissions, and
background execution, not a replacement for Windows or a collection of personas.

## First three jobs

| Job | Deliverable |
| --- | --- |
| Research brief | A saved comparison and recommendation with public sources and explicit uncertainties. |
| Project update | A dated summary of granted project notes, with evidence, blockers, and proposed next steps. |
| Weekly planning | An owner-scheduled draft of priorities based on project notes and recent updates. |

## Smallest coherent product

- One assistant; projects scope its context without creating separate identities.
- One local web app for conversation, tasks, results, memory, and approvals.
- One globally active run, with a persistent queue, finite limits, and cancellation.
- Owner-chosen model provider (OpenAI, Gemini, or OpenRouter) with a DPAPI-protected key; SQLite + Drizzle for local state.
- Inspectable, editable, owner-approved global preferences and project memory.
- Public web research, granted text-file reads, approved export of new reports,
  and owner-approved memory.

The PC must be awake and the runtime running. Closing the browser is fine;
shutting down the PC stops work. Local-first is not offline: selected context is
sent to the model/search provider, with that disclosure during onboarding.

## Control and trust

- Reads stay within granted scope; out-of-scope requests are denied.
- Keep `auto`, `telegram`, and `local` risk identifiers. In v0.1 all approvals are
  local web approvals; `telegram` names the standard-write tier, not a required
  Telegram integration. High-risk tools remain disabled.
- A report is saved internally before any separate export. Source files are not
  changed; exporting a new file requires review of its content and destination.
- No arbitrary shell, deletion, overwrites, credential handling by the model, or
  browser/OS computer use.

## Not v0.1

Agent teams, remote/mobile clients, Telegram, cloud workers, Docker, native apps,
connector catalogs, marketplace/MCP integrations, voice, multiple providers, and
self-directed proactive work. Do not add infrastructure for hypothetical users.

## Success and delivery

Ship only when all three jobs produce useful, source-backed saved results;
project isolation and approval boundaries hold; restart/cancellation/missed-run
handling works; and the owner has evaluated the workflows over one working week.
The complete release gates are in the full specification.

Build sequentially from the [solo backlog](../backlog/solo-rebuild.md): local
foundation → research brief → projects → reviewable export → memory → weekly
planning → release hardening. S00–S06 are complete; S07 remains in progress.
