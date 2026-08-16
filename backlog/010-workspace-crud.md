---
num: 010
title: "P0 — Workspace CRUD + templates + capability toggles + custom instructions (API)"
owner: AGENT
area: agent
labels: [P0, area:agent]
iteration: "Iteration 1"
depends_on: [007]
---

## Context

A workspace is an AI app (spec §3, #6): template-based, capability toggles, custom instructions. Coding = terminal/file/browser tools; Learning = chat/memory only; General = chat/memory + promoted summaries; custom = template + toggles + instructions.

## Scope

- API (Fastify) endpoints: `GET/POST /api/workspaces`, `GET/PATCH/DELETE /api/workspaces/:id`.
- Template presets: General, Learning, Coding (+ custom-from-template).
- Capability flags per workspace: chat, memory, folders, terminal, managedBrowser, schedules, telegramAllowed.
- Custom instructions field + `instructions.md`/`persona.md` sync with the Markdown folder from #006.
- Validate: only one workspace can own a given allowed-folder root; roots must be absolute paths.

## Acceptance criteria

- [ ] Create each template; verify default capabilities match spec (§3 #19: Coding has PC tools; General/Learning context/chat/memory only).
- [ ] PATCH capability toggles persist and are reflected in the Markdown folder.
- [ ] Custom workspace from Coding template + custom instructions → `.allowed-folders` respected by agent tooling (#017).
- [ ] API unit/integration tests for CRUD + validation errors.
