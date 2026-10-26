# Claude Code Instructions for OpenFrost

Read [AGENTS.md](AGENTS.md) and the
[specification](docs/ai-os-project-spec.md) before making changes.

The repository implements S01–S06 on `main`, including weekly planning. S07
pre-week validation was performed on 2026-10-26; the owner's one-working-week
use gate remains open. Draft [PR #28](https://github.com/ParasRana1729/openfrost/pull/28)
contains provider-key redaction and NAT64 hardening; its implementation checkpoint
passed CI but is not merged. Check the [solo backlog](backlog/solo-rebuild.md)
for current evidence and limitations.

Follow the authoritative instructions instead of assuming planned architecture
already exists. Implement only the explicitly assigned slice.
