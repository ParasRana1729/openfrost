# OpenFrost — Product one-pager

- **Direction:** Accepted; core workflows and TUI Control Center implemented on `main`
- **Release:** v0.1, Windows-first local runtime and Rust terminal UI (TUI) Control Center
- **Source of truth:** [Full specification](./ai-os-project-spec.md)

**Current repository: S00–S06, S08 Phase 1, and S09 (Rust Ratatui + Crossterm
TUI Control Center in `apps/tui`, replacing `apps/web`) are implemented on
`main`.** The shipped product includes research briefs, project updates,
approval-bound export, owner-approved memory, and owner-confirmed weekly
planning, alongside the static product page in `apps/landing`. S07 pre-week
validation was performed on 2026-10-26; the owner's one-working-week evaluation
remains open. The S07 follow-up in
[PR #28](https://github.com/ParasRana1729/openfrost/pull/28) adds provider-key
redaction and NAT64 private-address checks; it does not close S07.

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
- One local terminal UI (TUI) Control Center (`apps/tui`) for conversation, tasks, results, memory, routines, and approvals over the loopback API, plus a static landing page (`apps/landing`).
- One globally active run, with a persistent queue, finite limits, and cancellation.
- Owner-chosen model provider (OpenAI, Gemini, OpenRouter, or AMD Token Factory) with a DPAPI-protected key; SQLite + Drizzle for local state.
- Inspectable, editable, owner-approved global preferences and project memory.
- Public web research, granted text-file reads, approved export of new reports,
  and owner-approved memory.

The PC must be awake and the runtime running. Closing the TUI is fine;
shutting down the PC stops work. Local-first is not offline: selected context is
sent to the model/search provider, with that disclosure during onboarding.

## Control and trust

- Reads stay within granted scope; out-of-scope requests are denied.
- Keep `auto`, `telegram`, and `local` risk identifiers. In v0.1 all approvals are
  local Control Center approvals; `telegram` names the standard-write tier, not a
  required Telegram integration. High-risk tools remain disabled.
- A report is saved internally before any separate export. Source files are not
  changed; exporting a new file requires review of its content and destination.
- No arbitrary shell, deletion, overwrites, credential handling by the model, or
  browser/OS computer use.

## Not v0.1

Agent teams, remote/mobile/GUI desktop clients, Telegram, cloud workers, Docker,
connector catalogs, marketplace/MCP integrations, voice, multiple simultaneous
providers, and self-directed proactive work. Do not add infrastructure for
hypothetical users.

## Success and delivery

Ship only when all three jobs produce useful, source-backed saved results;
project isolation and approval boundaries hold; restart/cancellation/missed-run
handling works; and the owner has evaluated the workflows over one working week.
The complete release gates are in the full specification.

Build sequentially from the [solo backlog](../backlog/solo-rebuild.md): local
foundation → research brief → projects → reviewable export → memory → weekly
planning → TUI Control Center (S09, landed) → release hardening (S07). S00–S06,
S08 Phase 1, and S09 are complete on `main`; S07 remains in progress.
