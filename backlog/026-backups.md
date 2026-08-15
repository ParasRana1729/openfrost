---
num: 026
title: "P1 — Encrypted backup/restore: automatic local backups + openfrost backup create/restore"
owner: PLATFORM
area: platform
labels: [P1, area:platform]
iteration: "Iteration 3"
depends_on: [005, 006]
---

## Context
Protect a power user's chats, workspace memory, and configuration (spec §3, #38). Automatic encrypted local backups plus explicit `openfrost backup create` / `openfrost backup restore` commands.

## Scope
- Backup contents: SQLite DB + workspace Markdown folders + config (excluding live secrets, or re-encrypted within the archive).
- Commands: `openfrost backup create` (to `%USERPROFILE%\.openfrost\backups\` by default, otherwise given path), `openfrost backup restore <file>`.
- Automatic: daily scheduled backup with retention (keep last N).
- Encryption: AES-GCM with a key derived from DPAPI-wrapped secret — restores only on the same Windows user (scope per spec).
- Integrity: manifest with checksums; restore validates before touch.

## Acceptance criteria
- [ ] `backup create` produces an archive that restores on the same machine.
- [ ] Daily auto-backup runs and retention prunes old archives.
- [ ] Restore validates the manifest and refuses corrupted archives.
- [ ] Backup/restore never writes plaintext secrets to disk.