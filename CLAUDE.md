# Claude Code Instructions for OpenFrost

Read [AGENTS.md](AGENTS.md) and the
[specification](docs/ai-os-project-spec.md) before making changes.

The repository currently implements S01–S05: workspace, contracts, persistence,
DPAPI secrets, loopback API/UI, bounded executor, research briefs, project
updates, approval-bound export, and owner-approved memory. S06 weekly planning is
next; S07 release hardening remains. Check the [solo backlog](backlog/solo-rebuild.md)
for what actually exists.

Follow the authoritative instructions instead of assuming planned architecture
already exists. Implement only the explicitly assigned slice.
