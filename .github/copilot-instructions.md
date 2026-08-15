# GitHub Copilot Instructions for OpenFrost

Refer to `AGENTS.md` and `docs/ai-os-project-spec.md` for architectural rules and conventions.

- Use strict TypeScript with Zod validations.
- Place all shared entities and enums in `packages/domain`.
- Use Drizzle ORM over `better-sqlite3` for database operations.
- Security: Never expose or store secrets in plaintext (use Windows DPAPI). Enforce the 3-tier action approval workflow (`auto`, `telegram`, `local`).
