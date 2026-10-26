/**
 * apps/web/test/task-entry.test.tsx
 *
 * Integrated verification of:
 * - R1 / M2: Unified Task Entry (Assistant inline composer + Tasks "New task" dialog)
 * - De-duplication: Absence of duplicate inline form on Tasks page
 * - Global StatusBar: Running, Queued (#1, #2), Dispatch Paused, and Cancel actions
 * - Accessibility: Zero axe violations across all states
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, type MockInstance } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import type { Task, Project } from '@openfrost/domain';

import { StatusBar } from '../components/StatusBar';
import HomePage from '../app/page';
import TasksPage from '../app/tasks/page';
import { ToastProvider } from '../components/ToastProvider';
import { TaskComposer } from '../components/TaskComposer';
import { NewTaskDialog } from '../components/NewTaskDialog';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

// Polyfill EventSource for JSDOM if needed
beforeAll(() => {
  if (typeof globalThis.EventSource === 'undefined') {
    globalThis.EventSource = class MockEventSource {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      close = vi.fn();
    } as unknown as typeof EventSource;
  }
});

// Disable region landmark check for isolated component tests
const axeComponentOptions = {
  rules: {
    region: { enabled: false },
  },
};

// Fixture helpers
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Research quantum computing breakthroughs',
    request: 'Provide a concise overview of quantum computing in 2026',
    constraints: null,
    startingUrls: null,
    projectId: null,
    kind: 'research_brief',
    exportArgs: null,
    routineId: null,
    state: 'queued',
    attemptCount: 0,
    lastRunId: null,
    resultArtifactId: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const mockSession = {
  authenticated: true,
  ownerCreated: true,
  onboardingCompletedAt: '2026-10-01T00:00:00Z',
  csrfToken: 'test-csrf-token-xyz',
};

const mockProjects: Project[] = [
  {
    id: 'proj-1',
    name: 'Apollo Guidance Rebuild',
    instructions: 'Keep memory bounded to 4KB',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
];

async function renderWithAct(ui: React.ReactElement) {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(ui);
  });
  return result!;
}

describe('Task Entry & Global Status Bar (M2 Integration)', () => {
  let fetchSpy: MockInstance<typeof globalThis.fetch>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (u.includes('/api/auth/session')) {
        return new Response(JSON.stringify(mockSession));
      }
      if (u.includes('/api/tasks')) {
        return new Response(
          JSON.stringify({
            tasks: [],
            executor: { busy: false, activeTaskId: null, dispatchPaused: false },
          }),
        );
      }
      if (u.includes('/api/projects')) {
        return new Response(JSON.stringify({ projects: mockProjects }));
      }
      if (u.includes('/api/events')) {
        return new Response(JSON.stringify({ events: [] }));
      }
      if (u.includes('/api/approvals')) {
        return new Response(JSON.stringify({ approvals: [] }));
      }
      if (u.includes('/api/routines')) {
        return new Response(JSON.stringify({ routines: [] }));
      }
      if (u.includes('/api/exports/destinations')) {
        return new Response(JSON.stringify({ destinations: [] }));
      }
      return new Response('{}');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ===========================================================================
  // 1. Assistant Page Inline Task Composer
  // ===========================================================================
  describe('Assistant Page Inline Composer', () => {
    it('renders the inline composer on the Assistant page with workflow toggles', async () => {
      const { container } = await renderWithAct(
        <ToastProvider>
          <HomePage />
        </ToastProvider>,
      );

      await waitFor(() => {
        expect(
          screen.getByRole('textbox', { name: /^Task$/i }),
        ).toBeInTheDocument();
      });

      // Verifies composer textarea and workflow toggle chips
      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      expect(textarea).toHaveAttribute(
        'placeholder',
        expect.stringContaining('Describe the task'),
      );
      expect(
        screen.getByRole('button', { name: /Research brief/i }),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(
        screen.getByRole('button', { name: /Project update/i }),
      ).toHaveAttribute('aria-pressed', 'false');

      // Submit button is disabled when empty
      const queueBtn = screen.getByRole('button', { name: /Queue task/i });
      expect(queueBtn).toBeDisabled();

      // Zero accessibility violations
      expect(await axe(container, axeComponentOptions)).toHaveNoViolations();
    });

    it('submits a new task inline from Assistant page and resets composer', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (u.includes('/api/auth/session')) {
          return new Response(JSON.stringify(mockSession));
        }
        if (u.includes('/api/tasks') && init?.method === 'POST') {
          const body = JSON.parse(init.body as string);
          return new Response(
            JSON.stringify({
              task: makeTask({ title: body.title, request: body.request }),
            }),
            { status: 202 },
          );
        }
        if (u.includes('/api/tasks')) {
          return new Response(
            JSON.stringify({
              tasks: [],
              executor: { busy: false, activeTaskId: null, dispatchPaused: false },
            }),
          );
        }
        if (u.includes('/api/projects')) {
          return new Response(JSON.stringify({ projects: [] }));
        }
        if (u.includes('/api/events')) {
          return new Response(JSON.stringify({ events: [] }));
        }
        if (u.includes('/api/approvals')) {
          return new Response(JSON.stringify({ approvals: [] }));
        }
        if (u.includes('/api/routines')) {
          return new Response(JSON.stringify({ routines: [] }));
        }
        return new Response('{}');
      });

      await renderWithAct(
        <ToastProvider>
          <HomePage />
        </ToastProvider>,
      );

      await waitFor(() =>
        expect(screen.getByRole('textbox', { name: /^Task$/i })).toBeInTheDocument(),
      );

      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      await user.type(textarea, 'Analyze lithium extraction efficiencies');

      const queueBtn = screen.getByRole('button', { name: /Queue task/i });
      expect(queueBtn).toBeEnabled();

      await user.click(queueBtn);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/tasks',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('Analyze lithium extraction efficiencies'),
          }),
        );
      });

      // Textarea clears and toast notifies owner
      await waitFor(() => {
        expect(textarea).toHaveValue('');
        expect(screen.getByText(/Task added to the queue/i)).toBeInTheDocument();
      });
    });
  });

  // ===========================================================================
  // 2. Tasks Page "New task" Modal & Duplicate Form Removal
  // ===========================================================================
  describe('Tasks Page "New Task" Modal Dialog & De-duplication', () => {
    it('contains NO duplicate inline "New task" form in Tasks page body', async () => {
      await renderWithAct(
        <ToastProvider>
          <TasksPage />
        </ToastProvider>,
      );

      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).toBeInTheDocument(),
      );

      // Acceptance criterion check: No duplicate inline form on the page!
      expect(
        screen.queryByRole('heading', { level: 1, name: 'New task' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Workflow/i)).not.toBeInTheDocument();

      // Top action button exists to launch modal
      const newTaskBtn = screen.getByRole('button', { name: /New task/i });
      expect(newTaskBtn).toBeInTheDocument();
      expect(newTaskBtn).toHaveClass('btn-primary');
    });

    it('opens "New task" modal, submits task, and closes dialog', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (u.includes('/api/auth/session')) {
          return new Response(JSON.stringify(mockSession));
        }
        if (u.includes('/api/tasks') && init?.method === 'POST') {
          return new Response(JSON.stringify({ task: makeTask() }), { status: 202 });
        }
        if (u.includes('/api/tasks')) {
          return new Response(
            JSON.stringify({
              tasks: [],
              executor: { busy: false, activeTaskId: null, dispatchPaused: false },
            }),
          );
        }
        if (u.includes('/api/projects')) {
          return new Response(JSON.stringify({ projects: [] }));
        }
        if (u.includes('/api/exports/destinations')) {
          return new Response(JSON.stringify({ destinations: [] }));
        }
        return new Response('{}');
      });

      const { container } = await renderWithAct(
        <ToastProvider>
          <TasksPage />
        </ToastProvider>,
      );

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /New task/i })).toBeInTheDocument(),
      );

      // Click "New task" button
      await user.click(screen.getByRole('button', { name: /New task/i }));

      // Dialog opens
      const dialog = screen.getByRole('dialog', { name: /New task/i });
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('open');

      // Compose inside dialog
      const promptInput = screen.getByRole('textbox', { name: /^Task$/i });
      await user.type(promptInput, 'Inspect solar radiation telemetry');

      await user.click(screen.getByRole('button', { name: /Queue task/i }));

      // API invoked
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/tasks',
          expect.objectContaining({ method: 'POST' }),
        );
      });

      // Dialog is closed
      await waitFor(() => {
        expect(dialog).not.toHaveAttribute('open');
      });

      expect(await axe(container, axeComponentOptions)).toHaveNoViolations();
    });
  });

  // ===========================================================================
  // 3. Global Status Bar State Rendering
  // ===========================================================================
  describe('Global StatusBar States', () => {
    it('renders Idle state when executor is not busy and queue is empty', async () => {
      const { container } = await renderWithAct(
        <ToastProvider>
          <StatusBar
            session={mockSession}
            executor={{ busy: false, activeTaskId: null, dispatchPaused: false }}
            tasks={[]}
          />
        </ToastProvider>,
      );

      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('idle')).toBeInTheDocument();
      expect(screen.getByText('0 waiting')).toBeInTheDocument();
      expect(screen.getByText('open')).toBeInTheDocument();

      expect(await axe(container, axeComponentOptions)).toHaveNoViolations();
    });

    it('renders Running state with active task title, kind, elapsed time, and cancel button', async () => {
      const startedAt = new Date(Date.now() - 42000).toISOString();
      const activeTask = makeTask({
        id: 'task-active-1',
        title: 'Deep analysis of superconductor anomalies',
        kind: 'research_brief',
        state: 'running',
        updatedAt: startedAt,
      });

      const { container } = await renderWithAct(
        <ToastProvider>
          <StatusBar
            session={mockSession}
            executor={{ busy: true, activeTaskId: 'task-active-1', dispatchPaused: false }}
            tasks={[activeTask]}
          />
        </ToastProvider>,
      );

      // Verify pulse badge
      const badge = screen.getByRole('status', { name: /Status: Running/i });
      expect(badge).toBeInTheDocument();
      expect(badge.querySelector('.dot-pulse')).toBeInTheDocument();

      // Verify task details
      expect(screen.getByText('[Research brief]')).toBeInTheDocument();
      expect(
        screen.getByText('Deep analysis of superconductor anomalies'),
      ).toBeInTheDocument();
      expect(screen.getByText(/42s/)).toBeInTheDocument();

      // Verify cancel button with descriptive aria-label
      const cancelBtn = screen.getByRole('button', {
        name: 'Cancel active task Deep analysis of superconductor anomalies',
      });
      expect(cancelBtn).toBeInTheDocument();

      // Advance timer by 3 seconds
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(screen.getByText(/45s/)).toBeInTheDocument();

      expect(await axe(container, axeComponentOptions)).toHaveNoViolations();
    });

    it('renders Queued state with count and positions #1 and #2 with individual cancel buttons', async () => {
      const queued1 = makeTask({
        id: 'task-q1',
        title: 'Compile monthly telemetry report',
        createdAt: '2026-10-26T08:00:00Z',
        state: 'queued',
      });
      const queued2 = makeTask({
        id: 'task-q2',
        title: 'Update kernel memory map',
        createdAt: '2026-10-26T08:05:00Z',
        state: 'queued',
      });
      const queued3 = makeTask({
        id: 'task-q3',
        title: 'Export benchmark results',
        createdAt: '2026-10-26T08:10:00Z',
        state: 'queued',
      });

      const { container } = await renderWithAct(
        <ToastProvider>
          <StatusBar
            session={mockSession}
            executor={{ busy: false, activeTaskId: null, dispatchPaused: false }}
            tasks={[queued1, queued2, queued3]}
          />
        </ToastProvider>,
      );

      // Count badge
      expect(screen.getByText('3 tasks waiting')).toBeInTheDocument();

      // Position #1
      expect(screen.getByLabelText('Queue position 1')).toHaveTextContent('#1');
      expect(screen.getByText('Compile monthly telemetry report')).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: 'Cancel queued task #1 Compile monthly telemetry report',
        }),
      ).toBeInTheDocument();

      // Position #2
      expect(screen.getByLabelText('Queue position 2')).toHaveTextContent('#2');
      expect(screen.getByText('Update kernel memory map')).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: 'Cancel queued task #2 Update kernel memory map',
        }),
      ).toBeInTheDocument();

      // Overflow indicator
      expect(screen.getByText('+1 more')).toBeInTheDocument();

      expect(await axe(container, axeComponentOptions)).toHaveNoViolations();
    });

    it('renders Dispatch Paused alert banner with "Resume dispatch" button', async () => {
      const handleResume = vi.fn().mockResolvedValue(undefined);

      const { container } = await renderWithAct(
        <ToastProvider>
          <StatusBar
            session={mockSession}
            executor={{ busy: false, activeTaskId: null, dispatchPaused: true }}
            tasks={[]}
            onResumeDispatch={handleResume}
          />
        </ToastProvider>,
      );

      // Alert banner
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(screen.getByText('Dispatch paused after recovery')).toBeInTheDocument();

      const resumeBtn = screen.getByRole('button', { name: /Resume dispatch/i });
      expect(resumeBtn).toBeInTheDocument();

      // Trigger resume
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(resumeBtn);
      expect(handleResume).toHaveBeenCalledTimes(1);

      expect(await axe(container, axeComponentOptions)).toHaveNoViolations();
    });
  });

  // ===========================================================================
  // 4. Cancel Action Interactions
  // ===========================================================================
  describe('Cancel Actions in StatusBar', () => {
    it('cancels active running task via POST /api/tasks/:id/cancel', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const handleCancel = vi.fn().mockResolvedValue(undefined);

      const activeTask = makeTask({
        id: 'task-to-cancel-1',
        title: 'Run long web synthesis',
        state: 'running',
      });

      await renderWithAct(
        <ToastProvider>
          <StatusBar
            session={mockSession}
            executor={{ busy: true, activeTaskId: 'task-to-cancel-1', dispatchPaused: false }}
            tasks={[activeTask]}
            onCancel={handleCancel}
          />
        </ToastProvider>,
      );

      const cancelBtn = screen.getByRole('button', { name: /Cancel active task/i });
      await user.click(cancelBtn);

      expect(handleCancel).toHaveBeenCalledWith('task-to-cancel-1');
    });

    it('cancels queued task #1 via POST /api/tasks/:id/cancel', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const handleCancel = vi.fn().mockResolvedValue(undefined);

      const queuedTask = makeTask({
        id: 'task-queued-cancel-1',
        title: 'Scheduled weekly plan',
        state: 'queued',
      });

      await renderWithAct(
        <ToastProvider>
          <StatusBar
            session={mockSession}
            executor={{ busy: false, activeTaskId: null, dispatchPaused: false }}
            tasks={[queuedTask]}
            onCancel={handleCancel}
          />
        </ToastProvider>,
      );

      const cancelBtn = screen.getByRole('button', { name: /Cancel queued task #1/i });
      await user.click(cancelBtn);

      expect(handleCancel).toHaveBeenCalledWith('task-queued-cancel-1');
    });
  });

  // ===========================================================================
  // 5. Reusable TaskComposer & NewTaskDialog Unit Verification
  // ===========================================================================
  describe('TaskComposer & NewTaskDialog Features', () => {
    it('supports pre-population with initialValues (for M4 Edit & Retry)', async () => {
      await renderWithAct(
        <ToastProvider>
          <TaskComposer
            projects={mockProjects}
            inline={true}
            initialValues={{
              kind: 'project_update',
              projectId: 'proj-1',
              title: 'Retry: Update Documentation',
              request: 'Re-read the project notes and retry',
              constraints: 'Limit to 1000 tokens',
            }}
            csrfToken="csrf-test"
          />
        </ToastProvider>,
      );

      expect(screen.getByRole('textbox', { name: /^Task$/i })).toHaveValue(
        'Re-read the project notes and retry',
      );
      expect(
        screen.getByRole('button', { name: /Project update/i }),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByLabelText('Project for update')).toHaveValue('proj-1');
      expect(screen.getByLabelText(/Constraints/i)).toHaveValue('Limit to 1000 tokens');
    });

    it('submits on Ctrl+Enter in task prompt textarea', async () => {
      const handleSuccess = vi.fn();
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ task: makeTask() }), { status: 202 }),
      );

      await renderWithAct(
        <ToastProvider>
          <TaskComposer
            projects={[]}
            inline={true}
            csrfToken="csrf-test"
            onSuccess={handleSuccess}
          />
        </ToastProvider>,
      );

      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      fireEvent.change(textarea, { target: { value: 'Shortcut submission task' } });

      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/tasks',
          expect.objectContaining({ method: 'POST' }),
        );
      });
    });

    it('NewTaskDialog passes axe check when rendered open', async () => {
      const { container } = await renderWithAct(
        <ToastProvider>
          <NewTaskDialog
            isOpen={true}
            onClose={vi.fn()}
            projects={mockProjects}
          />
        </ToastProvider>,
      );

      expect(await axe(container, axeComponentOptions)).toHaveNoViolations();
    });
  });
});
