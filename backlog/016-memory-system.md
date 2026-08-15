---
num: 016
title: "P1 — Memory system: editable Markdown, auto summary, promote-to-General, workspace boundary"
owner: AGENT
area: agent
labels: [P1, area:agent, area:security]
iteration: "Iteration 1"
depends_on: [006, 014]
---

## Context
Memory model from spec §3 (#26, Q9): visible and editable workspace memory in `memory/*.md`, auto-saved summaries, explicit promote-to-General. General sees only **promoted summaries**, never raw chats/files of other workspaces.

## Scope
- Memory writer: after conversation milestones, agent drafts/updates `memory/<topic>.md` in the workspace folder (still user-visible).
- `promote` action: copies a summary into General workspace memory with source attribution; General agent loads promoted summaries in its system prompt.
- Memory boundary enforcement: agent context builder includes **only** its own workspace memory + General's promoted summaries.
- Memory search: SQLite-backed full-text index over memory files for retrieval (OpenClaw-style).

## Acceptance criteria
- [ ] Memory files created are valid Markdown, editable in the UI (workspace settings → Memory).
- [ ] Promoting a fact makes it visible to General; demoting hides it.
- [ ] Coding/agent never sees Learning's raw memory (unit test on context builder).
- [ ] Search retrieves across memory files; results ranked and scoped to the workspace.