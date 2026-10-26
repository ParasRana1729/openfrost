# E2E Test Infra: OpenFrost Control Center UI/UX Phase 2

## Test Philosophy
- Requirement-driven, opaque-box testing derived strictly from `ORIGINAL_REQUEST.md` and user-facing specifications.
- Independent from implementation details; verifies UI behavior from the perspective of an end user and assistive technology.
- Methodology: Category-Partition, Boundary Value Analysis (BVA), Pairwise Combinatorial Testing, and Real-World Workload Testing.
- Accessibility: Zero axe violations across all views and interactive states (`vitest-axe`).

## Feature Inventory
| # | Feature | Source (Requirement) | Tier 1 (Coverage) | Tier 2 (Boundary/Edge) | Tier 3 (Pairwise) | Tier 4 (Workload) |
|---|---------|---------------------|:-----------------:|:----------------------:|:-----------------:|:-----------------:|
| F1 | Accessible Design Tokens & Contrast | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ | ✓ |
| F2 | Accessible Primitives (Button, Badge, Card, Disclosure, Modal, Drawer) | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ | ✓ |
| F3 | Single Primary Inline Composer (Assistant) | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F4 | Tasks Page "New task" Modal Dialog | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F5 | De-duplication of Task Form on Tasks Page | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F6 | Global Status Bar (Running, Queued, Paused) | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F7 | Queue Position Indicators (#1, #2, etc.) | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F8 | Queue Cancel Action Button | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| F9 | Dispatch Paused Banner & One-Click Resume | Backlog S08 §Phase 2 | 5 | 5 | ✓ | ✓ |
| F10 | Human-Readable Status Badges (Queued, Running, Done, Failed) | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| F11 | Execution Duration & Elapsed Time Formatting | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| F12 | Clean Task & Activity Feed Rows | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| F13 | Raw Event Log Isolation (Secondary Tab/Disclosure) | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| F14 | Accessible Slide-over Run Detail Drawer | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| F15 | Live Step Progress & Tool Execution Visualization | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| F16 | Output Artifact View & Copy-to-Clipboard Action | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| F17 | Plain-Language Failure Diagnosis (Root Causes) | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| F18 | Actionable Remediation Buttons (Retry, Edit & retry, Settings) | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| F19 | "Edit & retry" Composer Pre-population Flow | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| F20 | Automated Axe Accessibility & Keyboard Focus Rationale | ORIGINAL_REQUEST §Quality | 5 | 5 | ✓ | ✓ |

## Test Architecture
- Test runner: Vitest in `apps/web/vitest.config.ts` running in `jsdom` environment.
- Assertion libraries: `@testing-library/react`, `@testing-library/user-event`, `vitest-axe` (`toHaveNoViolations`).
- Invocation:
  - `pnpm --filter @openfrost/web test`
  - Workspace level: `pnpm test`
- Pass/Fail semantics: All unit, integration, and accessibility tests must pass with 0 errors and 0 axe violations.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Assistant Happy Path: Create Research Brief, observe queue state in global status bar, live step progression, output artifact copy | F1, F2, F3, F6, F7, F10, F11, F14, F15, F16 | High |
| 2 | Tasks Page Modal Flow: Open "New task" modal on `/tasks`, submit project update, verify dialog closes, new row appears in feed | F1, F2, F4, F5, F10, F12 | Medium |
| 3 | Queue Management & Cancellation: Submit multiple tasks, verify queue positions (#1, #2), cancel waiting task, verify feed updates | F6, F7, F8, F10, F12 | High |
| 4 | Failure Diagnosis & Remediation (Provider Missing): Simulate missing API key, inspect drawer diagnosis, click "Open Settings", verify route | F14, F17, F18, F20 | High |
| 5 | Failure Diagnosis & Edit-and-Retry (Limit Reached): Step limit failure, select "Edit & retry", verify composer opens with pre-populated prompt and constraints | F4, F14, F17, F18, F19 | High |
| 6 | Secondary Raw Events View: Open task detail, toggle raw events disclosure, verify full JSON events without cluttering default feed | F12, F13, F14 | Medium |
| 7 | Accessibility & Keyboard Navigation: Navigate entire task lifecycle using Tab, Enter, Space, and Escape; verify visible focus rings and zero axe violations | F1, F2, F4, F14, F20 | High |

## Coverage Thresholds
- Tier 1: ≥5 test cases per feature (100 total tests)
- Tier 2: ≥5 boundary & corner tests per feature (100 total tests)
- Tier 3: Pairwise combinations across major features (20 tests)
- Tier 4: ≥7 real-world application scenarios
- Accessibility: 100% of tested components and views must have zero axe violations.
