# Shared TUI wire contracts (S09 / Priority 4)

These are canonical checked-in JSON examples, not generated build output.
Both `packages/domain/test/contracts.test.ts` and the tests in
`apps/tui/src/contracts.rs` read these exact files. No API, provider, credentials,
or pnpm build output is needed by Cargo.

Each payload file is a nonempty array of `{ "name": "case", "value": { ... } }`.
`enums.json` contains the complete ordered variants of the mirrored enums.
The fixtures cover 19 response/entity shapes, 16 mutating request shapes,
including setup/login, and 11 enums. Setup completes onboarding atomically;
there is no separate onboarding endpoint or body. All credential-like values
are inert test strings, never usable keys or sessions.

- Vitest parses payloads through exported production Zod schemas. New transport
  envelopes compose the existing entity schemas; setup/login API routes import
  the same domain validators used by these fixture tests (no route-local copies).
- Rust deserializes responses and verifies every fixture field survives
  serialization, catching silently ignored/renamed fields as well as null drift.
  Extra serialized default nulls for omitted response optionals are allowed.
- Rust constructs real request structs independently of the fixture loader and
  compares serialized JSON exactly. The expected JSON is never deserialized
  into a request struct to manufacture the actual value. Vitest also rejects
  extra request keys and checks optional-versus-nullable distinctions.
- Both suites check the fixture-file inventory; enum fixtures must match Zod's
  entire variant list and Rust's explicitly constructed/serialized variants.
- Tests are included in root `pnpm test` and `cargo test` in `apps/tui`, run by
  the existing separate Windows CI jobs. Rust stays outside the pnpm workspace.

## Updating a contract

Change `packages/domain` first, then the API/mirror as appropriate. Add or edit
named examples for both absent/null and populated values where supported.
Update the independent Rust request constructors and both registries when adding
a shape; update enum variants on both sides. Run both complete verification
suites documented in `AGENTS.md`; do not regenerate fixtures during tests.

## Mismatches exposed by this suite

- Routine list/detail views nest the entity under `routine`; Rust previously
  flattened it. The mirror now consumes the actual nested API shape.
- Project update responses are base projects without `grants`; the Rust project
  mirror now defaults that field to an empty list when absent. List/create
  responses still carry grants. This is not an API authorization change.
- A task title is required by domain. Rust retains its source-compatible
  `Option<String>` field to avoid UI refactoring but now refuses serialization
  when it is absent. The old HTTP mock's invalid title-less body is corrected.
- Provider model omission preserves the configured model; explicit null resets
  it. `SetProviderConfigRequest<Model = String>` preserves existing callers and
  also permits `SetProviderConfigRequest<Option<String>>` with `Some(None)` to
  encode null. This tests the wire shape, not a new UI action: the existing API
  helper still accepts the default specialization only.

This finite fixture suite is a drift tripwire, not proof of equivalence between
all Rust values and Zod refinements (lengths, ranges, workflow rules, etc.). The
API remains the runtime validation/security boundary. It does not exercise an
interactive API/TUI session or close the S07 owner-use gate.
