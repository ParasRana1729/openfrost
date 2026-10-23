# OpenFrost — Backlog

## Delivery plan

Use **[solo-rebuild.md](solo-rebuild.md)** with the
[current specification](../docs/ai-os-project-spec.md).

| ID | Slice | Depends on |
| --- | --- | --- |
| S00 | Clean specification-only baseline | — |
| S01 | Workspace/toolchain and minimal local task foundation | S00 |
| S02 | Research-brief vertical slice | S01 |
| S03 | Project context and updates | S02 |
| S04 | Approval-bound report export | S03 |
| S05 | Owner-approved memory | S03 |
| S06 | Weekly planning routines | S03, S05 |
| S07 | Release hardening and real-use evaluation | S04, S06 |

All items belong to ParasRana1729. IDs are local planning identifiers, **not**
GitHub issue numbers. Work one assigned slice at a time; each entry contains its
acceptance criteria. There are no team role assignments or fixed iteration dates.

**Current state:** S00 and S01 are complete. The S01 local foundation exists on
`main`: pnpm workspace, Zod contracts, SQLite persistence, DPAPI secrets,
authenticated loopback API/UI, and the bounded single-run executor. S02–S07
are unimplemented; no model provider or product workflow exists yet, so
completing a planning item is not evidence that a product feature works.
