# Project: OpenFrost Control Center UI/UX Phase 2

## Architecture
OpenFrost Control Center is a Windows-first personal AI OS web interface built with Next.js App Router (React 19) in `apps/web`, connected to a Fastify API in `apps/api` via REST endpoints and SSE streams (`/api/events/stream`), backed by `@openfrost/domain` Zod schemas, `@openfrost/db` SQLite storage, and `@openfrost/agent` single-active-run executor.

In Phase 2:
1. **Foundational Tokens & Primitives (`apps/web/components/ui/`, `apps/web/app/globals.css`)**:
   - Semantic tokens adhering to Polar Instrument palette with strict WCAG AA contrast (≥ 4.5:1).
   - Accessible primitives: `Button`, `StatusBadge`, `Card`, `Disclosure`, `ModalDialog` (native `<dialog>`), `Drawer` (slide-over accessible dialog with Esc and focus management).
   - Frontend test infrastructure: Vitest + React Testing Library + `vitest-axe` in `apps/web`.
2. **Unified Task Entry & Global Queue Visibility (R1)**:
   - Shared `TaskComposer` component used inline on the Assistant page (`/`) and inside `NewTaskDialog` on the Tasks page (`/tasks`).
   - Removal of duplicate inline task form from `/tasks`.
   - Global `StatusBar` (elevated `DispatchStrip`) in root layout/header across all views, displaying executor state (`Running`, `Queued`, `Dispatch Paused`), queue positions, pause/resume controls, and task cancel action.
3. **Readable Task & Activity Feed (R2)**:
   - Tasks page table/feed displaying human-readable titles, `StatusBadge` (`Queued`, `Running`, `Done`, `Failed`), workflow types, duration and elapsed times.
   - Isolation of raw event streams into a secondary "Raw events" debugging view.
4. **Run Detail & Plain-Language Failure Diagnosis (R3)**:
   - Slide-over `RunDetailDrawer` displaying live step progression, tool execution events (`tool.executed`, step, durationMs), source links, and output artifact with copy-to-clipboard actions.
   - `FailureDiagnosis` component mapping domain failure codes (`provider_missing`, `provider_error`, `limit_reached`, `source_unavailable`, `export_refused`, `internal`) and limits (`max_steps`, `wall_clock`, `max_input`, `max_output`) to clear root cause explanations and remediation actions (`Retry`, `Edit & retry`, `Open Settings`, `View Projects`).
   - Secondary "Raw events" disclosure within run detail.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Polar Design Tokens & Contrast | Ensure `--faint` and all text tokens meet WCAG AA (≥ 4.5:1), visible focus rings on interactive elements | M1 | ORIGINAL_REQUEST §R4 |
| 2 | Accessible UI Primitives | Reusable `Button`, `StatusBadge`, `Card`, `Disclosure`, `ModalDialog`, `Drawer` | M1 | ORIGINAL_REQUEST §R4 |
| 3 | Frontend Testing Setup | Vitest, React Testing Library, and vitest-axe test environment in `apps/web` | M1 | ORIGINAL_REQUEST §Acceptance |
| 4 | Shared Task Composer | Extract inline task composer into reusable `TaskComposer` component with validation | M2 | ORIGINAL_REQUEST §R1 |
| 5 | Assistant Page Composer | Retain inline `TaskComposer` on Assistant (`/`) with project context and workflow toggle | M2 | ORIGINAL_REQUEST §R1 |
| 6 | Tasks Page "New task" Modal | Replace duplicate form on `/tasks` with accessible "New task" dialog reusing `TaskComposer` | M2 | ORIGINAL_REQUEST §R1 |
| 7 | Global Executor Status Bar | Header/layout bar showing executor state (Running, Queued, Dispatch Paused) on all pages | M2 | ORIGINAL_REQUEST §R1 |
| 8 | Queue Position & Cancel Action | Display queue position (e.g. #1, #2) for waiting tasks and provide immediate cancel button | M2 | ORIGINAL_REQUEST §R1 |
| 9 | Dispatch Paused Banner & Resume | Explicit warning when dispatch is paused with one-click Resume Dispatch action | M2 | Backlog S08 §Phase 2 |
| 10 | Human-Readable Task Badges | Semantic status badges (Queued, Running, Done, Failed) replacing raw state codes | M3 | ORIGINAL_REQUEST §R2 |
| 11 | Duration & Elapsed Time | Show accurate duration for completed runs and elapsed time for active/queued tasks | M3 | ORIGINAL_REQUEST §R2 |
| 12 | Activity Feed Clean Presentation | Clean row presentation of workflow type, title, timestamp, and status | M3 | ORIGINAL_REQUEST §R2 |
| 13 | Raw Event Log Isolation | Move raw activity/system event stream to secondary disclosure or tab | M3 | ORIGINAL_REQUEST §R2 |
| 14 | Slide-over Run Detail Drawer | Accessible drawer panel for inspecting any selected task or run attempt | M4 | ORIGINAL_REQUEST §R3 |
| 15 | Live Step Progress & Tool Tracing | Step-by-step progress and tool execution cards (tool, duration, step) in drawer | M4 | ORIGINAL_REQUEST §R3 |
| 16 | Artifact Viewer with Copy | Markdown output artifact presentation with copy-to-clipboard action | M4 | ORIGINAL_REQUEST §R3 |
| 17 | Plain-Language Failure Diagnosis | Root cause explanation mapped from failure codes and limits | M4 | ORIGINAL_REQUEST §R3 |
| 18 | Failure Remediation Actions | Context-aware actions: Retry, Edit & retry (pre-populating composer), Open Settings, View Projects | M4 | ORIGINAL_REQUEST §R3 |
| 19 | Detail Raw Events Disclosure | Collapsible secondary disclosure for low-level run and tool events | M4 | ORIGINAL_REQUEST §R3 |
| 20 | E2E Testing Suite & Axe Audits | Automated test suite covering Tiers 1-4 and 0 axe violations on all updated views | M5 | ORIGINAL_REQUEST §Acceptance |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Design Tokens, Primitives & Test Harness | Accessible primitives (`Button`, `StatusBadge`, `Card`, `Disclosure`, `ModalDialog`, `Drawer`), CSS contrast fixes, and Vitest+RTL+axe test setup in `apps/web` | none | DONE (136 web tests, 0 axe violations, clean audit) |
| M2 | Unified Task Entry & Global Queue Visibility | Shared `TaskComposer`, Assistant page inline form, Tasks page "New task" dialog, global `StatusBar` with queue positions, cancel action, and resume button | M1 | DONE (178 web tests, 0 axe violations, clean audit, gate PASS) |
| M3 | Readable Task & Activity Feed | Readable task table/feed with `StatusBadge`, duration/elapsed calculations, workflow types, and isolated secondary raw event feed | M1 | DONE (263 web tests, 0 axe violations, clean audit, gate PASS) |
| M4 | Run Detail Drawer & Failure Diagnosis | Accessible `RunDetailDrawer`, live step progression, tool execution visualization, artifact copy, plain-language `FailureDiagnosis`, and remediation actions (Retry, Edit & retry, Settings) | M1, M2, M3 | PLANNED |
| M5 | Final E2E Pass & Quality Gate | Verify 100% pass of E2E test suite (`TEST_READY.md`), zero axe violations, and zero regressions on `pnpm lint && pnpm test && pnpm build` | M1, M2, M3, M4 | PLANNED |

## Interface Contracts
### `TaskComposer` Props
```typescript
export interface TaskComposerProps {
  projects: ProjectSummary[];
  activeProjectId?: string | null;
  initialValues?: {
    kind?: 'research_brief' | 'project_update';
    title?: string;
    request?: string;
    projectId?: string;
    constraints?: string[];
    startingUrls?: string[];
  };
  onSuccess?: (task: Task) => void;
  onCancel?: () => void;
  inline?: boolean;
}
```

### `StatusBadge` Props
```typescript
export type HumanStatus = 'queued' | 'running' | 'done' | 'failed' | 'awaiting_approval' | 'canceled';

export interface StatusBadgeProps {
  state: TaskState | RunState;
  size?: 'sm' | 'md';
}
```

### `RunDetailDrawer` Props
```typescript
export interface RunDetailDrawerProps {
  task: Task | null;
  runs: AgentRun[];
  events: Event[];
  artifact: TaskArtifact | null;
  isOpen: boolean;
  onClose: () => void;
  onRetry?: (taskId: string) => Promise<void>;
  onEditAndRetry?: (task: Task) => void;
  onCancelTask?: (taskId: string) => Promise<void>;
}
```

### Failure Diagnosis Mapper
```typescript
export interface Diagnosis {
  title: string;
  explanation: string;
  remediation: Array<{
    label: string;
    action: 'retry' | 'edit_retry' | 'settings' | 'projects';
  }>;
}

export function diagnoseFailure(
  failure: RunFailure | null,
  taskError: string | null
): Diagnosis;
```

## Code Layout
- `apps/web/app/globals.css`: Design tokens, contrast adjustments, focus ring definitions.
- `apps/web/components/ui/`:
  - `Button.tsx`: Accessible button primitive with variants and focus states.
  - `StatusBadge.tsx`: Human-readable status badges (Queued, Running, Done, Failed).
  - `Card.tsx`: Polar Instrument card container.
  - `Disclosure.tsx`: Accessible accordion/disclosure primitive.
  - `ModalDialog.tsx`: Accessible HTML `<dialog>` wrapper with backdrop and keyboard focus trap.
  - `Drawer.tsx`: Accessible slide-over panel with `role="dialog"`, `aria-modal="true"`, and escape key handling.
- `apps/web/components/`:
  - `TaskComposer.tsx`: Unified task creation composer.
  - `NewTaskDialog.tsx`: Modal dialog containing TaskComposer for Tasks page.
  - `StatusBar.tsx`: Global executor status bar (Running, Queued with position, Dispatch Paused, cancel/resume actions).
  - `TaskFeed.tsx`: Readable task list with human status badges, duration, and selection.
  - `RunDetailDrawer.tsx`: Slide-over inspection drawer with live steps, tools, artifact copy, and failure diagnosis.
  - `FailureDiagnosis.tsx`: Plain-language failure root cause and remediation buttons.
  - `RawEventsView.tsx`: Secondary disclosure for low-level system events.
- `apps/web/test/`: Component and accessibility tests (using Vitest, RTL, and axe).
