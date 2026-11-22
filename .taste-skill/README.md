# `.taste-skill` design artifacts

This directory stores design direction, briefs, and critique notes generated
for OpenFrost's web surfaces.

## Current status (post-S09)

- **Active — `apps/landing`:** `direction.json`, `critique.md`,
  `revamp/brief.md`, `revamp/direction.json`, and `revamp/critique.md` apply to
  the static Next.js marketing and source landing page (`apps/landing`).
  Product copy must reflect the current S09 architecture: local Fastify loopback
  API (`apps/api`) plus the Rust Ratatui + Crossterm TUI Control Center
  (`apps/tui`).
- **Superseded — `revamp/app/`:** `revamp/app/direction.json` targeted the
  earlier Next.js Control Center web app (`apps/web`), which was removed and
  replaced by `apps/tui` in S09. Kept as historical context only; do not apply
  web-app layout rules to `apps/tui`.

Visual inspection screenshots under `.taste-skill/inspect/`,
`.taste-skill/before/`, and `.taste-skill/revamp/{*-render,final*,production*,flashy}/`
are gitignored.
