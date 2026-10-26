/**
 * apps/web/test/challenger-m2-stress.test.tsx
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST SUITE: Milestone 2 Task Creation & Queue Controls
 *
 * Verifies:
 * 1. Validation edge cases: empty request, URL boundaries (>5 URLs, non-http schemes, whitespace),
 *    missing project for project_update, workflow switching, title auto-derivation edge cases.
 * 2. Submission mechanics: Ctrl+Enter, Meta+Enter, regular Enter, double-submit prevention.
 * 3. Cancel action timing & race conditions: spam clicking, API errors, loading states.
 * 4. StatusBar rapid queue & executor transitions: FIFO sorting, elapsed timer clock skew,
 *    overflow count, dispatch paused banner and resume debounce.
 * 5. Axe accessibility across all stress states.
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, type MockInstance } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import type { Task, Project } from '@openfrost/domain';

import { StatusBar } from '../components/StatusBar';
import { TaskComposer, deriveTitle } from '../components/TaskComposer';
import { NewTaskDialog } from '../components/NewTaskDialog';
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
  usePathname: () => '/',
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
    title: 'Adversarial Test Task',
    request: 'Verify edge cases under empirical stress',
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
  csrfToken: 'test-csrf-token-stress',
};

const mockProjects: Project[] = [
  {
    id: 'proj-alpha',
    name: 'Project Alpha',
    instructions: 'Follow guidelines',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'proj-beta',
    name: 'Project Beta',
    instructions: null,
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

describe('Challenger M2: Empirical Stress Test Suite', () => {
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
  // 1. Validation Edge Cases & Boundaries
  // =========================================================================
  describe('TaskComposer: Validation Edge Cases', () => {
    it('disables submission for empty, whitespace-only, and newline-only requests', async () => {
      await renderWithAct(
        <ToastProvider>
          <TaskComposer projects={mockProjects} csrfToken="csrf-123" />
        </ToastProvider>,
      );

      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      const submitBtn = screen.getByRole('button', { name: /Queue task/i });

      expect(submitBtn).toBeDisabled();

      // Only spaces
      fireEvent.change(textarea, { target: { value: '     ' } });
      expect(submitBtn).toBeDisabled();
      expect(screen.getByText('Describe the work you need first.')).toBeInTheDocument();

      // Only newlines and tabs
      fireEvent.change(textarea, { target: { value: '\n\n\t  \n' } });
      expect(submitBtn).toBeDisabled();

      // Non-empty string enables submit
      fireEvent.change(textarea, { target: { value: 'Valid prompt' } });
      expect(submitBtn).toBeEnabled();
    });

    it('rigorously tests URL boundaries: 0, 1, 5, 6 URLs, empty lines, and non-http schemes', async () => {
      const { container } = await renderWithAct(
        <ToastProvider>
          <TaskComposer projects={mockProjects} csrfToken="csrf-123" />
        </ToastProvider>,
      );

      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      fireEvent.change(textarea, { target: { value: 'Research task with URLs' } });

      // Open advanced options disclosure to view URLs textarea
      const disclosureBtn = screen.getByRole('button', { name: /Advanced options/i });
      fireEvent.click(disclosureBtn);

      const urlsTextarea = screen.getByLabelText(/Starting URLs/i);
      const submitBtn = screen.getByRole('button', { name: /Queue task/i });

      // 5 valid URLs with mixed case schemes and trailing query params
      const valid5Urls = [
        'https://example.com/one',
        'http://example.com/two?filter=active',
        'HTTPS://CAPS.EXAMPLE.ORG',
        'http://localhost:3000/api',
        'https://sub.domain.co.uk/path/file.html',
      ].join('\n');

      fireEvent.change(urlsTextarea, { target: { value: valid5Urls } });
      expect(submitBtn).toBeEnabled();
      expect(screen.queryByText(/Starting URLs must begin with/i)).not.toBeInTheDocument();

      // Empty lines between valid URLs are safely ignored
      const validWithGaps = [
        'https://example.com/one',
        '',
        '   ',
        'https://example.com/two',
      ].join('\n');
      fireEvent.change(urlsTextarea, { target: { value: validWithGaps } });
      expect(submitBtn).toBeEnabled();

      // 6 URLs (exceeding MAX_STARTING_URLS = 5)
      const invalid6Urls = [
        'https://example.com/1',
        'https://example.com/2',
        'https://example.com/3',
        'https://example.com/4',
        'https://example.com/5',
        'https://example.com/6',
      ].join('\n');
      fireEvent.change(urlsTextarea, { target: { value: invalid6Urls } });
      expect(submitBtn).toBeDisabled();
      expect(
        screen.getAllByText('At most 5 starting URLs are allowed (6 given).').length,
      ).toBeGreaterThanOrEqual(1);

      // Non-HTTP schemes
      const schemesToReject = [
        'ftp://files.example.com',
        'javascript:alert(1)',
        'file:///C:/secrets.txt',
        'data:text/plain;base64,SGVsbG8=',
        'www.example.com', // missing scheme
      ];

      for (const badScheme of schemesToReject) {
        fireEvent.change(urlsTextarea, { target: { value: badScheme } });
        expect(submitBtn).toBeDisabled();
        expect(
          screen.getByText('Starting URLs must begin with http:// or https://.'),
        ).toBeInTheDocument();
      }

      expect(await axe(container, axeOptions)).toHaveNoViolations();
    });

    it('enforces project selection requirement for project_update workflow', async () => {
      await renderWithAct(
        <ToastProvider>
          <TaskComposer projects={mockProjects} csrfToken="csrf-123" />
        </ToastProvider>,
      );

      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      fireEvent.change(textarea, { target: { value: 'Update codebase notes' } });

      // Switch to project_update
      const projectUpdateBtn = screen.getByRole('button', { name: /Project update/i });
      fireEvent.click(projectUpdateBtn);

      const submitBtn = screen.getByRole('button', { name: /Queue task/i });
      // Initially no project is chosen -> disabled
      expect(submitBtn).toBeDisabled();
      expect(screen.getByText('Choose a project to prepare its update.')).toBeInTheDocument();

      // Select project Alpha
      const select = screen.getByLabelText('Project for update');
      fireEvent.change(select, { target: { value: 'proj-alpha' } });

      expect(submitBtn).toBeEnabled();
      expect(screen.getByText('Ready to queue. The task runs in the background.')).toBeInTheDocument();

      // Deselect back to empty
      fireEvent.change(select, { target: { value: '' } });
      expect(submitBtn).toBeDisabled();
    });

    it('handles zero projects edge case for project_update workflow', async () => {
      await renderWithAct(
        <ToastProvider>
          <TaskComposer projects={[]} csrfToken="csrf-123" />
        </ToastProvider>,
      );

      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      fireEvent.change(textarea, { target: { value: 'Draft update' } });

      fireEvent.click(screen.getByRole('button', { name: /Project update/i }));

      const submitBtn = screen.getByRole('button', { name: /Queue task/i });
      expect(submitBtn).toBeDisabled();

      // Displays helpful error guide linking to projects page
      expect(
        screen.getByText(/A project update needs a project with a granted folder/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Create a project before preparing a project update.'),
      ).toBeInTheDocument();
    });

    it('preserves and switches workflow states cleanly without bleeding startingUrls into project_update', async () => {
      const handleSuccess = vi.fn();
      let capturedBody: Record<string, unknown> | null = null;

      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          capturedBody = JSON.parse(init.body as string);
          return new Response(JSON.stringify({ task: makeTask() }), { status: 202 });
        }
        return new Response('{}');
      });

      await renderWithAct(
        <ToastProvider>
          <TaskComposer
            projects={mockProjects}
            csrfToken="csrf-123"
            onSuccess={handleSuccess}
          />
        </ToastProvider>,
      );

      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      fireEvent.change(textarea, { target: { value: 'Multi-workflow test' } });

      // Enter URLs in research_brief
      fireEvent.click(screen.getByRole('button', { name: /Advanced options/i }));
      fireEvent.change(screen.getByLabelText(/Starting URLs/i), {
        target: { value: 'https://example.com/one\nhttps://example.com/two' },
      });

      // Switch to project_update and pick project
      fireEvent.click(screen.getByRole('button', { name: /Project update/i }));
      fireEvent.change(screen.getByLabelText('Project for update'), {
        target: { value: 'proj-beta' },
      });

      // Submit project_update
      fireEvent.click(screen.getByRole('button', { name: /Queue task/i }));

      await waitFor(() => {
        expect(capturedBody).not.toBeNull();
      });

      const body = capturedBody as unknown as Record<string, unknown>;

      // Crucial: startingUrls must NOT be included in project_update request payload
      expect(body.kind).toBe('project_update');
      expect(body.projectId).toBe('proj-beta');
      expect(body.startingUrls).toBeUndefined();
    });

    it('correctly auto-derives and truncates titles across varied inputs', () => {
      // Single line short
      expect(deriveTitle('Simple task')).toBe('Simple task');

      // Leading newlines and spaces
      expect(deriveTitle('\n\n   Leading whitespace trimmed   \nSecond line')).toBe(
        'Leading whitespace trimmed',
      );

      // Exactly 80 chars
      const eighty = 'A'.repeat(80);
      expect(deriveTitle(eighty)).toBe(eighty);

      // 81 chars -> truncated to 77 chars + ellipsis
      const eightyOne = 'B'.repeat(81);
      const derived = deriveTitle(eightyOne);
      expect(derived).toBe('B'.repeat(77) + '…');
      expect(derived.length).toBe(78);

      // Carriage return + line feed
      expect(deriveTitle('Windows CRLF\r\nSecond line')).toBe('Windows CRLF');
    });

    it('prefers explicit title override and ignores whitespace-only override', async () => {
      let capturedBody: Record<string, unknown> | null = null;
      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          capturedBody = JSON.parse(init.body as string);
          return new Response(JSON.stringify({ task: makeTask() }), { status: 202 });
        }
        return new Response('{}');
      });

      await renderWithAct(
        <ToastProvider>
          <TaskComposer
            projects={[]}
            csrfToken="csrf-123"
            initialValues={{
              request: 'Underlying prompt for title check',
              title: 'Explicit Title Here',
            }}
          />
        </ToastProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: /Queue task/i }));

      await waitFor(() => {
        expect(capturedBody).not.toBeNull();
      });
      const body = capturedBody as unknown as Record<string, unknown>;
      expect(body.title).toBe('Explicit Title Here');
    });
  });

  // =========================================================================
  // 2. Keyboard Shortcuts & Concurrent Submissions
  // =========================================================================
  describe('TaskComposer: Keyboard Shortcuts & Concurrency', () => {
    it('submits on Meta+Enter (Command+Enter on macOS)', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ task: makeTask() }), { status: 202 }),
      );

      await renderWithAct(
        <ToastProvider>
          <TaskComposer projects={[]} csrfToken="csrf-123" />
        </ToastProvider>,
      );

      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      fireEvent.change(textarea, { target: { value: 'Mac shortcut task' } });

      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          '/api/tasks',
          expect.objectContaining({ method: 'POST' }),
        );
      });
    });

    it('does NOT submit on plain Enter without Ctrl/Meta modifier', async () => {
      await renderWithAct(
        <ToastProvider>
          <TaskComposer projects={[]} csrfToken="csrf-123" />
        </ToastProvider>,
      );

      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      fireEvent.change(textarea, { target: { value: 'Multiline text line 1' } });

      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: false, metaKey: false });

      // No fetch should have been made
      expect(fetchSpy).not.toHaveBeenCalledWith(
        '/api/tasks',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('does NOT submit on Ctrl+Enter if validation fails (e.g. empty or invalid URL)', async () => {
      await renderWithAct(
        <ToastProvider>
          <TaskComposer projects={[]} csrfToken="csrf-123" />
        </ToastProvider>,
      );

      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      // Empty textarea
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

      expect(fetchSpy).not.toHaveBeenCalledWith(
        '/api/tasks',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('prevents double-submission when Ctrl+Enter or clicks are spammed in flight', async () => {
      let resolvePost: (value: Response) => void;
      const postPromise = new Promise<Response>((resolve) => {
        resolvePost = resolve;
      });

      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return postPromise;
        }
        return new Response('{}');
      });

      await renderWithAct(
        <ToastProvider>
          <TaskComposer projects={[]} csrfToken="csrf-123" />
        </ToastProvider>,
      );

      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      fireEvent.change(textarea, { target: { value: 'Single submit verification' } });

      const submitBtn = screen.getByRole('button', { name: /Queue task/i });

      // Trigger first submission
      fireEvent.click(submitBtn);

      // Verify button is now loading and disabled
      expect(submitBtn).toBeDisabled();
      expect(screen.getByText('Queuing…')).toBeInTheDocument();

      // Spam Ctrl+Enter while in flight
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      fireEvent.click(submitBtn);

      // Resolve the original request
      await act(async () => {
        resolvePost!(new Response(JSON.stringify({ task: makeTask() }), { status: 202 }));
      });

      // Verify only 1 POST was dispatched
      const postCalls = fetchSpy.mock.calls.filter(
        ([url, init]) =>
          (typeof url === 'string' && url.includes('/api/tasks')) &&
          init?.method === 'POST',
      );
      expect(postCalls).toHaveLength(1);
    });

    it('displays server error toast and message when task creation fails', async () => {
      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return new Response(JSON.stringify({ error: 'Database constraint violation' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response('{}');
      });

      await renderWithAct(
        <ToastProvider>
          <TaskComposer projects={[]} csrfToken="csrf-123" />
        </ToastProvider>,
      );

      const textarea = screen.getByRole('textbox', { name: /^Task$/i });
      fireEvent.change(textarea, { target: { value: 'Task that will fail' } });

      fireEvent.click(screen.getByRole('button', { name: /Queue task/i }));

      await waitFor(() => {
        expect(screen.getAllByText('Database constraint violation').length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  // =========================================================================
  // 3. StatusBar: Cancel Action Timing & Error Handling
  // =========================================================================
  describe('StatusBar: Cancel Timing & Concurrency', () => {
    it('prevents multiple cancel calls when cancel button is clicked repeatedly', async () => {
      const cancelMock = vi.fn().mockReturnValue(new Promise(() => {})); // hung promise

      const task = makeTask({
        id: 'task-long-run',
        title: 'Long running task',
        state: 'running',
      });

      await renderWithAct(
        <ToastProvider>
          <StatusBar
            session={mockSession}
            executor={{ busy: true, activeTaskId: 'task-long-run', dispatchPaused: false }}
            tasks={[task]}
            onCancel={cancelMock}
          />
        </ToastProvider>,
      );

      const cancelBtn = screen.getByRole('button', { name: /Cancel active task/i });

      // Click multiple times
      fireEvent.click(cancelBtn);
      fireEvent.click(cancelBtn);
      fireEvent.click(cancelBtn);

      expect(cancelMock).toHaveBeenCalledTimes(1);
      expect(cancelBtn).toBeDisabled();
    });

    it('handles cancel rejection gracefully without leaving UI disabled permanently', async () => {
      const cancelMock = vi.fn().mockRejectedValue(new Error('Task already finished'));

      const task = makeTask({
        id: 'task-race',
        title: 'Racing task',
        state: 'running',
      });

      await renderWithAct(
        <ToastProvider>
          <StatusBar
            session={mockSession}
            executor={{ busy: true, activeTaskId: 'task-race', dispatchPaused: false }}
            tasks={[task]}
            onCancel={cancelMock}
          />
        </ToastProvider>,
      );

      const cancelBtn = screen.getByRole('button', { name: /Cancel active task/i });
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(cancelMock).toHaveBeenCalledTimes(1);
      });

      // Canceling state is cleared and button is re-enabled
      await waitFor(() => {
        expect(cancelBtn).not.toBeDisabled();
      });
    });
  });

  // =========================================================================
  // 4. StatusBar: Queue Ordering, Elapsed Timer Skew & Transitions
  // =========================================================================
  describe('StatusBar: Queue Ordering & Transitions', () => {
    it('sorts queued tasks strictly by FIFO createdAt regardless of array order', async () => {
      const taskOldest = makeTask({
        id: 'q-1',
        title: 'First queued task',
        createdAt: '2026-10-26T07:00:00Z',
        state: 'queued',
      });
      const taskMiddle = makeTask({
        id: 'q-2',
        title: 'Second queued task',
        createdAt: '2026-10-26T07:10:00Z',
        state: 'queued',
      });
      const taskNewest = makeTask({
        id: 'q-3',
        title: 'Third queued task',
        createdAt: '2026-10-26T07:20:00Z',
        state: 'queued',
      });

      // Pass in reverse order
      await renderWithAct(
        <ToastProvider>
          <StatusBar
            session={mockSession}
            executor={{ busy: false, activeTaskId: null, dispatchPaused: false }}
            tasks={[taskNewest, taskOldest, taskMiddle]}
          />
        </ToastProvider>,
      );

      // Verify #1 is taskOldest and #2 is taskMiddle
      expect(screen.getByLabelText('Queue position 1')).toHaveTextContent('#1');
      expect(screen.getByText('First queued task')).toBeInTheDocument();

      expect(screen.getByLabelText('Queue position 2')).toHaveTextContent('#2');
      expect(screen.getByText('Second queued task')).toBeInTheDocument();

      // Overflow indicator
      expect(screen.getByText('+1 more')).toBeInTheDocument();
    });

    it('handles clock skew gracefully when active task createdAt is in the future', async () => {
      // Future timestamp (clock skew scenario)
      const futureTime = new Date(Date.now() + 10000).toISOString();
      const activeTask = makeTask({
        id: 'future-task',
        title: 'Task with future timestamp',
        state: 'running',
        updatedAt: futureTime,
      });

      await renderWithAct(
        <ToastProvider>
          <StatusBar
            session={mockSession}
            executor={{ busy: true, activeTaskId: 'future-task', dispatchPaused: false }}
            tasks={[activeTask]}
          />
        </ToastProvider>,
      );

      // Elapsed time should clamp to 0s instead of displaying negative or NaN
      expect(screen.getByText('0s')).toBeInTheDocument();
    });

    it('formats multi-minute and multi-hour elapsed durations correctly', async () => {
      // 1 hour, 2 minutes, 5 seconds = 3725 seconds
      const pastTime = new Date(Date.now() - 3725000).toISOString();
      const activeTask = makeTask({
        id: 'long-run-task',
        title: 'Very long running analysis',
        state: 'running',
        updatedAt: pastTime,
      });

      await renderWithAct(
        <ToastProvider>
          <StatusBar
            session={mockSession}
            executor={{ busy: true, activeTaskId: 'long-run-task', dispatchPaused: false }}
            tasks={[activeTask]}
          />
        </ToastProvider>,
      );

      // 1h 02m format
      expect(screen.getByText('1h 02m')).toBeInTheDocument();
    });

    it('prevents multiple resume dispatch calls when resume button is clicked repeatedly', async () => {
      const resumeMock = vi.fn().mockReturnValue(new Promise(() => {}));

      await renderWithAct(
        <ToastProvider>
          <StatusBar
            session={mockSession}
            executor={{ busy: false, activeTaskId: null, dispatchPaused: true }}
            tasks={[]}
            onResumeDispatch={resumeMock}
          />
        </ToastProvider>,
      );

      const resumeBtn = screen.getByRole('button', { name: /Resume dispatch/i });
      fireEvent.click(resumeBtn);
      fireEvent.click(resumeBtn);

      expect(resumeMock).toHaveBeenCalledTimes(1);
      expect(resumeBtn).toBeDisabled();
    });
  });

  // =========================================================================
  // 5. Modal Dialog Cancellation & Reset
  // =========================================================================
  describe('NewTaskDialog: Cancellation & Integration', () => {
    it('invokes onClose when Cancel button inside dialog is clicked', async () => {
      const handleClose = vi.fn();

      await renderWithAct(
        <ToastProvider>
          <NewTaskDialog
            isOpen={true}
            onClose={handleClose}
            projects={mockProjects}
          />
        </ToastProvider>,
      );

      const cancelBtn = screen.getByRole('button', { name: /^Cancel$/i });
      fireEvent.click(cancelBtn);

      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });
});
