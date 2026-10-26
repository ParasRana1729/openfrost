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
| S08 | Control Center usability quick wins (Phase 1) | S01–S06 |

All items belong to ParasRana1729. IDs are local planning identifiers, **not**
GitHub issue numbers. Work one assigned slice at a time; each entry contains its
acceptance criteria. There are no team role assignments or fixed iteration dates.

**Current state:** S00–S06 are complete on `main`. This includes the pnpm
workspace, shared Zod contracts, SQLite persistence, DPAPI secrets, authenticated
loopback API/UI, bounded executor, research briefs, project updates,
approval-bound export, owner-approved Markdown memory, and weekly planning.
S07 pre-week validation was performed on 2026-10-26; the owner's one-working-week
evaluation remains open. The S07 follow-up in
[PR #28](https://github.com/ParasRana1729/openfrost/pull/28) adds provider-key
redaction and NAT64 hardening; it does not complete S07. See the
[solo backlog](solo-rebuild.md)
handoffs for evidence, scope, and limitations.
S08 Phase 1 improves the existing Control Center and does not close or alter
the S07 one-working-week release gate.
