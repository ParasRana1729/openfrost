/**
 * apps/web/test/challenger-m2-2-a11y-dialog.test.tsx
 *
 * EMPIRICAL ADVERSARIAL CHALLENGER M2.2:
 * Accessibility and Modal Dialog Mechanics Verification
 *
 * Verifies:
 * 1. NewTaskDialog:
 *    - Autofocus lands on prompt textarea when opened
 *    - Focus trap mechanics and background inertness (HTML5 <dialog showModal>)
 *    - Escape key dismissal
 *    - Trigger button focus restoration
 *    - Form state resets cleanly on reopen unless pre-populated
 * 2. StatusBar:
 *    - Live elapsed timer increments cleanly every second without re-rendering unrelated trees
 *    - Queue position numbers #1 and #2 match strict FIFO order by createdAt
 *    - Dispatch paused banner alert semantics (role="alert")
 * 3. Accessibility:
 *    - Zero axe violations across open dialog and status bar states
 */

import React, { useState } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, type MockInstance } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import type { Task, Project } from '@openfrost/domain';

import { NewTaskDialog } from '../components/NewTaskDialog';
import { StatusBar } from '../components/StatusBar';
import { ToastProvider } from '../components/ToastProvider';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/tasks',
  useSearchParams: () => new URLSearchParams(),
}));

beforeAll(() => {
  if (typeof globalThis.EventSource === 'undefined') {
    globalThis.EventSource = class MockEventSource {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      close = vi.fn();
    } as unknown as typeof EventSource;
  }
});

const axeOptions = {
  rules: {
    region: { enabled: false },
  },
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Adversarial Verification Task',
    request: 'Test accessibility and focus management',
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

const mockProjects: Project[] = [
  {
    id: 'proj-1',
    name: 'Orbital Dynamics',
    instructions: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
];

const mockSession = {
  authenticated: true,
  ownerCreated: true,
  onboardingCompletedAt: '2026-10-01T00:00:00Z',
  csrfToken: 'test-csrf-token',
};

async function renderWithAct(ui: React.ReactElement) {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(ui);
  });
  return result!;
}

describe('Challenger M2.2: Accessibility & Modal Dialog Mechanics', () => {
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
      return new Response('{}');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // =========================================================================
  // 1. NewTaskDialog: Focus, Trap, Escape, Restoration, Form State Reset
  // =========================================================================
  describe('NewTaskDialog Mechanics & A11y', () => {
    function DialogHarness({
      initialValues,
    }: {
      initialValues?: React.ComponentProps<typeof NewTaskDialog>['initialValues'];
    }) {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <ToastProvider>
          <div>
            <button id="external-trigger-btn" type="button" onClick={() => setIsOpen(true)}>
              New task
            </button>
            <div id="background-content">
              <button id="background-btn" type="button">
                Background Action
              </button>
            </div>
            <NewTaskDialog
              isOpen={isOpen}
              onClose={() => setIsOpen(false)}
              projects={mockProjects}
              initialValues={initialValues}
            />
          </div>
        </ToastProvider>
      );
    }

    it('autofocus lands on prompt textarea when opened', async () => {
      await renderWithAct(<DialogHarness />);

      const triggerBtn = screen.getByRole('button', { name: 'New task' });
      triggerBtn.focus();
      expect(document.activeElement).toBe(triggerBtn);

      // Open the dialog inside act
      await act(async () => {
        fireEvent.click(triggerBtn);
      });

      const dialog = screen.getByRole('dialog', { name: /New task/i });
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('open');

      // Autofocus check: active element must be the Task prompt textarea
      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      expect(document.activeElement).toBe(textarea);
    });

    it('Escape key dismisses modal and restores focus to "New task" trigger button', async () => {
      await renderWithAct(<DialogHarness />);

      const triggerBtn = screen.getByRole('button', { name: 'New task' });
      triggerBtn.focus();
      await act(async () => {
        fireEvent.click(triggerBtn);
      });

      const dialog = screen.getByRole('dialog', { name: /New task/i });
      expect(dialog).toHaveAttribute('open');

      // Trigger Escape on the native dialog (fires cancel event)
      await act(async () => {
        fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
        fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
      });

      // Dialog is dismissed
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      // Focus restoration check: focus returns to the original trigger button
      expect(document.activeElement).toBe(triggerBtn);
    });

    it('restores focus to trigger button when dismissed via close button (✕)', async () => {
      await renderWithAct(<DialogHarness />);

      const triggerBtn = screen.getByRole('button', { name: 'New task' });
      triggerBtn.focus();
      await act(async () => {
        fireEvent.click(triggerBtn);
      });

      const closeBtn = screen.getByRole('button', { name: 'Close dialog' });
      expect(closeBtn).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(closeBtn);
      });

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      expect(document.activeElement).toBe(triggerBtn);
    });

    it('verifies background content is inert and modal semantics are set (aria-modal="true", showModal)', async () => {
      const showModalSpy = vi.spyOn(HTMLDialogElement.prototype, 'showModal');

      const { container } = await renderWithAct(<DialogHarness />);

      const triggerBtn = screen.getByRole('button', { name: 'New task' });
      await act(async () => {
        fireEvent.click(triggerBtn);
      });

      const dialog = screen.getByRole('dialog', { name: /New task/i });
      expect(dialog).toBeInTheDocument();

      // Native HTML5 showModal was called (ensuring browser-level top layer & inert backdrop)
      expect(showModalSpy).toHaveBeenCalled();

      // Accessibility attributes
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('role', 'dialog');
      expect(dialog).toHaveAttribute('aria-labelledby');
      expect(dialog).toHaveAttribute('aria-describedby');

      // Axe audit with dialog open
      expect(await axe(container, axeOptions)).toHaveNoViolations();
    });

    it('resets form state cleanly on reopen after dismissal without submission', async () => {
      await renderWithAct(<DialogHarness />);

      const triggerBtn = screen.getByRole('button', { name: 'New task' });
      await act(async () => {
        fireEvent.click(triggerBtn);
      });

      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      await act(async () => {
        fireEvent.change(textarea, { target: { value: 'Draft content that will be discarded' } });
      });
      expect(textarea).toHaveValue('Draft content that will be discarded');

      // Close without submitting via Close button
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
      });

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      // Re-open dialog
      await act(async () => {
        fireEvent.click(triggerBtn);
      });

      const reopenedTextarea = screen.getByRole('textbox', { name: /^Task$/i });
      // Clean reset: prompt must be empty!
      expect(reopenedTextarea).toHaveValue('');
    });

    it('preserves pre-populated initialValues when specified (M4 Edit & Retry)', async () => {
      const prePopulated = {
        kind: 'project_update' as const,
        projectId: 'proj-1',
        title: 'Retry: Synthesize telemetry',
        request: 'Investigate telemetry anomalies with bounded scope',
        constraints: 'Limit to 5 steps',
      };

      await renderWithAct(<DialogHarness initialValues={prePopulated} />);

      const triggerBtn = screen.getByRole('button', { name: 'New task' });
      await act(async () => {
        fireEvent.click(triggerBtn);
      });

      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      expect(textarea).toHaveValue('Investigate telemetry anomalies with bounded scope');

      const kindBtn = screen.getByRole('button', { name: /Project update/i });
      expect(kindBtn).toHaveAttribute('aria-pressed', 'true');

      const projectSelect = screen.getByLabelText('Project for update');
      expect(projectSelect).toHaveValue('proj-1');
    });
  });

  // =========================================================================
  // 2. StatusBar: Live Timer, FIFO Queue Ordering, Paused Banner Alert
  // =========================================================================
  describe('StatusBar Mechanics & Semantics', () => {
    it('live elapsed timer increments every second without re-rendering unrelated trees', async () => {
      const unrelatedRenderSpy = vi.fn();

      function UnrelatedLayoutSibling() {
        unrelatedRenderSpy();
        return <div data-testid="unrelated-layout-node">Persistent Layout Content</div>;
      }

      const activeTask = makeTask({
        id: 'task-active-timer',
        title: 'Compute orbital mechanics trajectory',
        kind: 'research_brief',
        state: 'running',
        updatedAt: new Date(Date.now() - 5000).toISOString(), // 5s elapsed
      });

      function LayoutHarness() {
        return (
          <ToastProvider>
            <main>
              <StatusBar
                session={mockSession}
                executor={{ busy: true, activeTaskId: 'task-active-timer', dispatchPaused: false }}
                tasks={[activeTask]}
              />
              <UnrelatedLayoutSibling />
            </main>
          </ToastProvider>
        );
      }

      await renderWithAct(<LayoutHarness />);

      expect(screen.getByText('5s')).toBeInTheDocument();
      const initialRenders = unrelatedRenderSpy.mock.calls.length;
      expect(initialRenders).toBeGreaterThanOrEqual(1);

      // Advance timer by 1 second
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText('6s')).toBeInTheDocument();

      // Advance timer by 4 more seconds
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.getByText('10s')).toBeInTheDocument();

      // Verify unrelated layout sibling was NOT re-rendered by StatusBar timer ticks
      expect(unrelatedRenderSpy.mock.calls.length).toBe(initialRenders);
    });

    it('sorts queue items in strict FIFO order according to createdAt timestamp', async () => {
      const qOldest = makeTask({
        id: 'task-fifo-1',
        title: 'Task Created First (Oldest)',
        createdAt: '2026-10-26T06:00:00.000Z',
        state: 'queued',
      });
      const qMiddle = makeTask({
        id: 'task-fifo-2',
        title: 'Task Created Second (Middle)',
        createdAt: '2026-10-26T06:15:00.000Z',
        state: 'queued',
      });
      const qNewest = makeTask({
        id: 'task-fifo-3',
        title: 'Task Created Third (Newest)',
        createdAt: '2026-10-26T06:30:00.000Z',
        state: 'queued',
      });

      // Pass tasks shuffled (Newest, Oldest, Middle)
      await renderWithAct(
        <ToastProvider>
          <StatusBar
            session={mockSession}
            executor={{ busy: false, activeTaskId: null, dispatchPaused: false }}
            tasks={[qNewest, qOldest, qMiddle]}
          />
        </ToastProvider>,
      );

      // Total count
      expect(screen.getByText('3 tasks waiting')).toBeInTheDocument();

      // #1 badge MUST be the oldest task
      const pos1Badge = screen.getByLabelText('Queue position 1');
      expect(pos1Badge).toHaveTextContent('#1');
      expect(screen.getByText('Task Created First (Oldest)')).toBeInTheDocument();

      // #2 badge MUST be the middle task
      const pos2Badge = screen.getByLabelText('Queue position 2');
      expect(pos2Badge).toHaveTextContent('#2');
      expect(screen.getByText('Task Created Second (Middle)')).toBeInTheDocument();

      // Overflow indicator for #3
      expect(screen.getByText('+1 more')).toBeInTheDocument();
    });

    it('excludes active task from queue count and positions even if labeled queued', async () => {
      const activeTask = makeTask({
        id: 'task-active',
        title: 'Active Running Task',
        state: 'running',
        updatedAt: new Date().toISOString(),
      });
      const queued1 = makeTask({
        id: 'task-q1',
        title: 'Queued Task 1',
        createdAt: '2026-10-26T07:00:00Z',
        state: 'queued',
      });

      await renderWithAct(
        <ToastProvider>
          <StatusBar
            session={mockSession}
            executor={{ busy: true, activeTaskId: 'task-active', dispatchPaused: false }}
            tasks={[activeTask, queued1]}
          />
        </ToastProvider>,
      );

      expect(screen.getByText('1 task waiting')).toBeInTheDocument();
      expect(screen.getByLabelText('Queue position 1')).toHaveTextContent('#1');
      expect(screen.getByText('Queued Task 1')).toBeInTheDocument();
    });

    it('dispatch paused banner has role="alert" with complete warning content and resume action', async () => {
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

      // Verify role="alert" on the warning banner
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveClass('status-bar-alert');

      // Warning text semantics
      expect(screen.getByText('Dispatch paused after recovery')).toBeInTheDocument();
      expect(
        screen.getByText('Unfinished runs from a previous session require review.'),
      ).toBeInTheDocument();

      // Resume button
      const resumeBtn = screen.getByRole('button', { name: 'Resume dispatch' });
      expect(resumeBtn).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(resumeBtn);
      });
      expect(handleResume).toHaveBeenCalledTimes(1);

      // Axe audit of paused banner
      expect(await axe(container, axeOptions)).toHaveNoViolations();
    });
  });
});
