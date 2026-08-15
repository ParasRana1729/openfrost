---
num: 011
title: "P0 — Workspace editor UI + templates picker"
owner: UI
area: ui
labels: [P0, area:ui]
iteration: "Iteration 1"
depends_on: [008, 010]
---

## Context
The workspace editor is where the "AI OS has different apps" narrative becomes tangible for the user. They need to pick a template, then toggle capabilities and write custom instructions — all visually.

## Scope
- Templates picker: General / Learning / Coding / Custom, each with a short description.
- Editor form: name, custom instructions (rich text → `instructions.md`), persona, model override (from #014), capability toggles with guards (e.g., terminal requires selecting allowed folders).
- Allowed-folder picker (folder dialog or typed absolute path) with validation against #010.
- Telegram-allowed toggle.

## Acceptance criteria
- [ ] Create a custom workspace via UI end-to-end; it appears in the switcher (#008).
- [ ] Toggle terminal → UI requires at least one allowed folder before saving.
- [ ] Instructions/persona edits persist to the workspace Markdown folder.
- [ ] Form validation errors are shown inline and clear.