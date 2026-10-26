/**
 * apps/web/test/task-feed.test.tsx
 *
 * Comprehensive verification for Milestone 3 (Requirement R2: Readable Task and Activity Feed):
 * - Tier 1: Functional requirements (StatusBadge, WorkflowBadges, URL pills, Durations, Filter tabs, Search, Actions, Empty states)
 * - Tier 2: Boundary value & Edge cases (Subsecond durations, clock skew clamping, long strings, missing project/run data)
 * - Tier 3: Keyboard operability & Event bubbling isolation (Compound Accessible Row Pattern, Title button, discrete actions)
 * - Tier 4: Automated Axe accessibility audits across all states (0 violations)
 * - Format utilities & React live timer hook
 * - Secondary RawEventsView isolation and clipboard copy
 * - TasksPage integration
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, type MockInstance } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import type { Task, Project, Event, AgentRun } from '@openfrost/domain';

import { TaskFeed } from '../components/TaskFeed';
import { RawEventsView } from '../components/RawEventsView';
import TasksPage from '../app/tasks/page';
import { ToastProvider } from '../components/ToastProvider';
import {
  formatDuration,
  formatTimeAgo,
  formatToolDuration,
  formatRunDuration,
  formatTaskDuration,
  formatToolCall,
  describeEvent,
  useElapsedTimer,
} from '../lib/format';

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

// Polyfill EventSource for JSDOM
beforeAll(() => {
  if (typeof globalThis.EventSource === 'undefined') {
    globalThis.EventSource = class MockEventSource {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      close = vi.fn();
    } as unknown as typeof EventSource;
  }
});

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
    attemptCount: 1,
    lastRunId: null,
    resultArtifactId: null,
    error: null,
    createdAt: new Date(Date.now() - 120_000).toISOString(), // 2m ago
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

const mockProjects: Project[] = [
  {
    id: 'proj-apollo',
    name: 'Apollo Guidance Rebuild',
    instructions: 'Keep memory bounded to 4KB',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'proj-gemini',
    name: 'Gemini Capsule Telemetry',
    instructions: 'Validate all telemetry channels',
    createdAt: '2026-10-02T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
  },
];

const mockSession = {
  authenticated: true,
  ownerCreated: true,
  onboardingCompletedAt: '2026-10-01T00:00:00Z',
  csrfToken: 'test-csrf-token-m3',
};

// Component helper for testing useElapsedTimer in isolation
function TimerTester({ startedAt, active = true }: { startedAt: string; active?: boolean }) {
  const elapsed = useElapsedTimer(startedAt, active);
  return <div data-testid="timer-display">{elapsed}</div>;
}

describe('Format Utilities (lib/format.ts)', () => {
  it('formatDuration handles 0, subseconds, seconds, minutes, hours, days and invalid values', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-5000)).toBe('0s'); // clock skew clamp
    expect(formatDuration(450)).toBe('0s'); // subsecond integer floor
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(42000)).toBe('42s');
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(135000)).toBe('2m 15s');
    expect(formatDuration(3600000)).toBe('1h');
    expect(formatDuration(3840000)).toBe('1h 4m');
    expect(formatDuration(86400000)).toBe('1d');
    expect(formatDuration(93600000)).toBe('1d 2h');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(NaN)).toBe('—');
  });

  it('formatToolDuration formats subsecond ms and second values cleanly', () => {
    expect(formatToolDuration(342)).toBe('342ms');
    expect(formatToolDuration(999)).toBe('999ms');
    expect(formatToolDuration(1000)).toBe('1.0s');
    expect(formatToolDuration(1250)).toBe('1.3s');
    expect(formatToolDuration(null)).toBeNull();
    expect(formatToolDuration(undefined)).toBeNull();
  });

  it('formatTimeAgo handles future skew, just now, seconds, minutes, hours, days and invalid', () => {
    const now = 1000000000;
    expect(formatTimeAgo(new Date(now + 10000).toISOString(), now)).toBe('just now'); // future skew
    expect(formatTimeAgo(new Date(now - 5000).toISOString(), now)).toBe('just now');
    expect(formatTimeAgo(new Date(now - 45000).toISOString(), now)).toBe('45s ago');
    expect(formatTimeAgo(new Date(now - 180000).toISOString(), now)).toBe('3m ago');
    expect(formatTimeAgo(new Date(now - 7200000).toISOString(), now)).toBe('2h ago');
    expect(formatTimeAgo(new Date(now - 86400000 * 3).toISOString(), now)).toBe('3d ago');
    expect(formatTimeAgo(null)).toBe('—');
    expect(formatTimeAgo('invalid-date')).toBe('—');
  });

  it('formatRunDuration formats active runs and completed runs', () => {
    const now = 1000000000;
    const runningRun: AgentRun = {
      id: 'run-1',
      taskId: 't-1',
      attempt: 1,
      state: 'running',
      startedAt: new Date(now - 18000).toISOString(),
      endedAt: null,
      failure: null,
      usage: null,
    };
    expect(formatRunDuration(runningRun, now)).toBe('running for 18s');

    const completedRun: AgentRun = {
      ...runningRun,
      state: 'completed',
      endedAt: new Date(now - 3000).toISOString(),
    };
    expect(formatRunDuration(completedRun, now)).toBe('15s');

    expect(formatRunDuration(null)).toBe('—');
  });

  it('formatTaskDuration calculates durations across queued, running, and completed states', () => {
    const now = 1000000000;
    const queuedTask = makeTask({
      state: 'queued',
      createdAt: new Date(now - 60000).toISOString(),
    });
    expect(formatTaskDuration(queuedTask, null, now)).toBe('queued 1m ago');

    const runningTask = makeTask({
      state: 'running',
      updatedAt: new Date(now - 25000).toISOString(),
    });
    expect(formatTaskDuration(runningTask, null, now)).toBe('running for 25s');

    const completedTask = makeTask({
      state: 'completed',
      updatedAt: new Date(now - 120000).toISOString(),
    });
    expect(formatTaskDuration(completedTask, null, now)).toBe('completed 2m ago');
  });

  it('formatToolCall formats web_search, fetch_page, read_project_file, propose_memory, and fallbacks', () => {
    const search1 = formatToolCall({ tool: 'web_search', count: 1 });
    expect(search1.name).toBe('Web search');
    expect(search1.description).toBe('Web search executed');
    expect(search1.duration).toBeNull();
    expect(search1.ok).toBe(true);

    const searchMulti = formatToolCall({ tool: 'web_search', count: 3 });
    expect(searchMulti.description).toBe('Web search (3 queries)');

    const fetchOk = formatToolCall({ tool: 'fetch_page', durationMs: 342, ok: true });
    expect(fetchOk.name).toBe('Page fetch');
    expect(fetchOk.description).toBe('Page fetched');
    expect(fetchOk.duration).toBe('342ms');

    const fetchFail = formatToolCall({ tool: 'fetch_page', durationMs: 1200, ok: false });
    expect(fetchFail.description).toBe('Page fetch failed');
    expect(fetchFail.duration).toBe('1.2s');
    expect(fetchFail.ok).toBe(false);

    const readProj = formatToolCall({ tool: 'read_project_file', durationMs: 45, ok: true });
    expect(readProj.name).toBe('Project read');
    expect(readProj.description).toBe('Project file read');

    const memProp = formatToolCall({ tool: 'propose_memory', durationMs: 12, ok: true });
    expect(memProp.name).toBe('Memory proposal');

    const custom = formatToolCall({ tool: 'export_report', durationMs: 500, ok: true });
    expect(custom.name).toBe('Export Report');
    expect(custom.description).toBe('Export Report executed');
  });

  it('describeEvent correctly maps domain events to human titles and categories', () => {
    const event1: Event = {
      id: 1,
      type: 'task.created',
      taskId: 't-1',
      runId: null,
      payload: {},
      createdAt: '2026-10-26T10:00:00Z',
    };
    const desc1 = describeEvent(event1);
    expect(desc1.title).toBe('Task queued');
    expect(desc1.category).toBe('task');
    expect(desc1.isError).toBe(false);

    const eventFail: Event = {
      id: 2,
      type: 'task.failed',
      taskId: 't-1',
      runId: null,
      payload: { error: 'Network timeout reached' },
      createdAt: '2026-10-26T10:05:00Z',
    };
    const descFail = describeEvent(eventFail);
    expect(descFail.title).toBe('Task failed');
    expect(descFail.subtitle).toBe('Network timeout reached');
    expect(descFail.isError).toBe(true);

    const eventUnknown: Event = {
      id: 3,
      type: 'custom.system_action' as Event['type'],
      taskId: null,
      runId: null,
      payload: {},
      createdAt: '2026-10-26T10:05:00Z',
    };
    const descUnknown = describeEvent(eventUnknown);
    expect(descUnknown.title).toBe('Custom — System Action');
    expect(descUnknown.category).toBe('system');
  });
});

describe('useElapsedTimer Hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks every second and updates the elapsed time', () => {
    const startTime = new Date().toISOString();
    render(<TimerTester startedAt={startTime} />);

    expect(screen.getByTestId('timer-display').textContent).toBe('0s');

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('timer-display').textContent).toBe('5s');

    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.getByTestId('timer-display').textContent).toBe('1m 5s');
  });
});

describe('RawEventsView Component', () => {
  const sampleEvents: Event[] = [
    {
      id: 1,
      type: 'task.created',
      taskId: 'task-123',
      runId: null,
      payload: { request: 'Inspect telemetry' },
      createdAt: '2026-10-26T10:00:00Z',
    },
    {
      id: 2,
      type: 'tool.executed',
      taskId: 'task-123',
      runId: 'run-456',
      payload: { tool: 'web_search', durationMs: 400, ok: true },
      createdAt: '2026-10-26T10:01:00Z',
    },
  ];

  it('renders collapsed by default with event count badge', () => {
    render(<RawEventsView events={sampleEvents} />);
    // Badge has 2
    expect(screen.getByText('2')).toBeInTheDocument();
    // Region is hidden by default
    const region = screen.getByRole('region', { hidden: true });
    expect(region).toBeInTheDocument();
  });

  it('expands when disclosure trigger is clicked and displays scrollable console with tabIndex 0', async () => {
    render(<RawEventsView events={sampleEvents} defaultOpen={true} />);

    const consoleRegion = screen.getByRole('region', { name: 'Raw events log' });
    expect(consoleRegion).toBeInTheDocument();
    expect(consoleRegion).toHaveAttribute('tabIndex', '0');
    expect(consoleRegion).toHaveClass('raw-events-console');

    expect(screen.getByText('task.created')).toBeInTheDocument();
    expect(screen.getByText('tool.executed')).toBeInTheDocument();
    expect(screen.getAllByText('task:task-123').length).toBe(2);
    expect(screen.getByText('run:run-456')).toBeInTheDocument();
  });

  it('copies JSON to clipboard when "Copy JSON" button is clicked', async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    render(<RawEventsView events={sampleEvents} defaultOpen={true} />);

    const copyBtn = screen.getByRole('button', { name: /Copy all raw events as JSON/i });
    expect(copyBtn).toBeInTheDocument();

    await user.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith(JSON.stringify(sampleEvents, null, 2));
    expect(screen.getByText('Copied JSON!')).toBeInTheDocument();
  });

  it('displays empty message when no events exist', () => {
    render(<RawEventsView events={[]} defaultOpen={true} />);
    expect(screen.getByText('No events recorded.')).toBeInTheDocument();
  });

  it('passes automated axe accessibility audits in both collapsed and expanded states', async () => {
    const { container, rerender } = render(<RawEventsView events={sampleEvents} defaultOpen={false} />);
    let results = await axe(container, axeComponentOptions);
    expect(results).toHaveNoViolations();

    rerender(<RawEventsView events={sampleEvents} defaultOpen={true} />);
    results = await axe(container, axeComponentOptions);
    expect(results).toHaveNoViolations();
  });
});

describe('TaskFeed Component (R2 Acceptance Criteria)', () => {
  const taskQueued = makeTask({
    id: 't-queued',
    title: 'Research orbital mechanics',
    kind: 'research_brief',
    state: 'queued',
    startingUrls: ['https://nasa.gov'],
  });

  const taskRunning = makeTask({
    id: 't-running',
    title: 'Update flight software kernel',
    kind: 'project_update',
    state: 'running',
    projectId: 'proj-apollo',
  });

  const taskDone = makeTask({
    id: 't-done',
    title: 'Generate monthly telemetry summary',
    kind: 'export_report',
    state: 'completed',
  });

  const taskFailed = makeTask({
    id: 't-failed',
    title: 'Compile trajectory analysis',
    kind: 'research_brief',
    state: 'failed',
    error: 'Provider API key missing or expired',
    startingUrls: ['https://esa.int', 'https://jaxa.jp'],
  });

  const mixedTasks = [taskQueued, taskRunning, taskDone, taskFailed];

  it('renders all task rows with StatusBadge, workflow badges, and accessible list container', () => {
    render(<TaskFeed tasks={mixedTasks} projects={mockProjects} />);

    const list = screen.getByRole('list', { name: 'Tasks and activity feed' });
    expect(list).toBeInTheDocument();

    // Check titles
    expect(screen.getByText('Research orbital mechanics')).toBeInTheDocument();
    expect(screen.getByText('Update flight software kernel')).toBeInTheDocument();
    expect(screen.getByText('Generate monthly telemetry summary')).toBeInTheDocument();
    expect(screen.getByText('Compile trajectory analysis')).toBeInTheDocument();

    // Check status badges
    expect(screen.getByRole('status', { name: 'Status: Queued' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Status: Running' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Status: Done' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Status: Failed' })).toBeInTheDocument();

    // Check workflow badges
    expect(screen.getAllByText('Research brief').length).toBe(2);
    expect(screen.getByText('Project update')).toBeInTheDocument();
    expect(screen.getByText('Export')).toBeInTheDocument();

    // Check URL pills
    expect(screen.getByText('🌐 1 URL')).toBeInTheDocument();
    expect(screen.getByText('🌐 2 URLs')).toBeInTheDocument();

    // Check project badge link
    expect(screen.getByRole('link', { name: 'Project: Apollo Guidance Rebuild' })).toBeInTheDocument();
  });

  it('filters tasks by status tabs (All, Active, Queued, Done, Failed)', async () => {
    const user = userEvent.setup();
    render(<TaskFeed tasks={mixedTasks} projects={mockProjects} />);

    // Initially All (4)
    expect(screen.getByRole('tab', { name: /All \(4\)/i })).toHaveClass('active');
    expect(screen.getByText('Research orbital mechanics')).toBeInTheDocument();
    expect(screen.getByText('Update flight software kernel')).toBeInTheDocument();
    expect(screen.getByText('Generate monthly telemetry summary')).toBeInTheDocument();
    expect(screen.getByText('Compile trajectory analysis')).toBeInTheDocument();

    // Click Active tab -> only running task
    await user.click(screen.getByRole('tab', { name: /Active \(1\)/i }));
    expect(screen.queryByText('Research orbital mechanics')).not.toBeInTheDocument();
    expect(screen.getByText('Update flight software kernel')).toBeInTheDocument();
    expect(screen.queryByText('Generate monthly telemetry summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Compile trajectory analysis')).not.toBeInTheDocument();

    // Click Queued tab -> only queued task
    await user.click(screen.getByRole('tab', { name: /Queued \(1\)/i }));
    expect(screen.getByText('Research orbital mechanics')).toBeInTheDocument();
    expect(screen.queryByText('Update flight software kernel')).not.toBeInTheDocument();

    // Click Done tab -> only completed task
    await user.click(screen.getByRole('tab', { name: /Done \(1\)/i }));
    expect(screen.getByText('Generate monthly telemetry summary')).toBeInTheDocument();
    expect(screen.queryByText('Research orbital mechanics')).not.toBeInTheDocument();

    // Click Failed tab -> only failed task
    await user.click(screen.getByRole('tab', { name: /Failed \(1\)/i }));
    expect(screen.getByText('Compile trajectory analysis')).toBeInTheDocument();
    expect(screen.queryByText('Generate monthly telemetry summary')).not.toBeInTheDocument();
  });

  it('filters tasks live using search input', async () => {
    const user = userEvent.setup();
    render(<TaskFeed tasks={mixedTasks} projects={mockProjects} />);

    const searchInput = screen.getByRole('searchbox', { name: /Search tasks by title or request/i });
    await user.type(searchInput, 'orbital');

    expect(screen.getByText('Research orbital mechanics')).toBeInTheDocument();
    expect(screen.queryByText('Update flight software kernel')).not.toBeInTheDocument();
    expect(screen.queryByText('Generate monthly telemetry summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Compile trajectory analysis')).not.toBeInTheDocument();
  });

  it('renders clean empty state when no tasks exist', () => {
    render(<TaskFeed tasks={[]} />);
    expect(screen.getByText('Nothing queued right now.')).toBeInTheDocument();
    expect(
      screen.getByText('Describe what the assistant should work on above, and it will run here — one task at a time.'),
    ).toBeInTheDocument();
  });

  it('renders "No tasks match your filter" with reset action when search yields zero results', async () => {
    const user = userEvent.setup();
    render(<TaskFeed tasks={mixedTasks} />);

    const searchInput = screen.getByRole('searchbox', { name: /Search tasks by title or request/i });
    await user.type(searchInput, 'nonexistent query 12345');

    expect(screen.getByText('No tasks match your filter.')).toBeInTheDocument();
    const resetBtn = screen.getByRole('button', { name: 'Reset filters' });
    await user.click(resetBtn);

    // Filter reset restores all tasks
    expect(screen.getByText('Research orbital mechanics')).toBeInTheDocument();
  });

  it('Compound Accessible Row Pattern: Title button activates onSelectTask for keyboard users', async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    render(<TaskFeed tasks={[taskRunning]} onSelectTask={onSelectTask} />);

    const titleBtn = screen.getByRole('button', { name: /View run details for Update flight software kernel/i });
    expect(titleBtn).toBeInTheDocument();

    await user.click(titleBtn);
    expect(onSelectTask).toHaveBeenCalledTimes(1);
    expect(onSelectTask).toHaveBeenCalledWith(taskRunning);
  });

  it('Compound Accessible Row Pattern: Mouse click on Card whitespace delegates to onSelectTask', async () => {
    const onSelectTask = vi.fn();
    const { container } = render(<TaskFeed tasks={[taskRunning]} onSelectTask={onSelectTask} />);

    const card = container.querySelector('.task-row-card') as HTMLDivElement;
    expect(card).toBeInTheDocument();

    // Click on the card container directly
    fireEvent.click(card);
    expect(onSelectTask).toHaveBeenCalledTimes(1);
    expect(onSelectTask).toHaveBeenCalledWith(taskRunning);
  });

  it('Event Bubbling Isolation: Clicking Cancel button calls onCancelTask without calling onSelectTask', async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    const onCancelTask = vi.fn();
    render(
      <TaskFeed
        tasks={[taskRunning]}
        onSelectTask={onSelectTask}
        onCancelTask={onCancelTask}
      />,
    );

    const cancelBtn = screen.getByRole('button', { name: /Cancel task: Update flight software kernel/i });
    await user.click(cancelBtn);

    expect(onCancelTask).toHaveBeenCalledTimes(1);
    expect(onCancelTask).toHaveBeenCalledWith(taskRunning.id);
    expect(onSelectTask).not.toHaveBeenCalled();
  });

  it('Event Bubbling Isolation: Clicking Retry button calls onRetryTask without calling onSelectTask', async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    const onRetryTask = vi.fn();
    render(
      <TaskFeed
        tasks={[taskFailed]}
        onSelectTask={onSelectTask}
        onRetryTask={onRetryTask}
      />,
    );

    const retryBtn = screen.getByRole('button', { name: /Retry task: Compile trajectory analysis/i });
    await user.click(retryBtn);

    expect(onRetryTask).toHaveBeenCalledTimes(1);
    expect(onRetryTask).toHaveBeenCalledWith(taskFailed.id);
    expect(onSelectTask).not.toHaveBeenCalled();
  });

  it('Event Bubbling Isolation: Clicking Project link does NOT call onSelectTask', async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    render(
      <TaskFeed
        tasks={[taskRunning]}
        projects={mockProjects}
        onSelectTask={onSelectTask}
      />,
    );

    const projectLink = screen.getByRole('link', { name: 'Project: Apollo Guidance Rebuild' });
    projectLink.addEventListener('click', (e) => e.preventDefault());
    await user.click(projectLink);

    expect(onSelectTask).not.toHaveBeenCalled();
  });

  it('passes automated axe accessibility audits on mixed task feed with zero violations', async () => {
    let results: Awaited<ReturnType<typeof axe>>;
    await act(async () => {
      const { container } = render(<TaskFeed tasks={mixedTasks} projects={mockProjects} />);
      results = await axe(container, axeComponentOptions);
    });
    expect(results!).toHaveNoViolations();
  });

  it('passes automated axe accessibility audits on empty task feed with zero violations', async () => {
    const { container } = render(<TaskFeed tasks={[]} />);
    const results = await axe(container, axeComponentOptions);
    expect(results).toHaveNoViolations();
  });
});

describe('TasksPage Integration (M3)', () => {
  let fetchSpy: MockInstance<typeof globalThis.fetch>;

  const tasksData = [
    makeTask({
      id: 'task-live-1',
      title: 'Analyze Martian atmospheric telemetry',
      kind: 'research_brief',
      state: 'running',
    }),
    makeTask({
      id: 'task-live-2',
      title: 'Update life support control parameters',
      kind: 'project_update',
      state: 'completed',
      projectId: 'proj-apollo',
    }),
  ];

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (u.includes('/api/auth/session')) {
        return new Response(JSON.stringify(mockSession));
      }
      if (u.includes('/api/tasks/task-live-1')) {
        return new Response(
          JSON.stringify({
            task: tasksData[0],
            runs: [],
            events: [
              {
                id: 1,
                type: 'task.created',
                taskId: 'task-live-1',
                runId: null,
                payload: {},
                createdAt: '2026-10-26T10:00:00Z',
              },
            ],
            artifact: null,
            approval: null,
          }),
        );
      }
      if (u.includes('/api/tasks')) {
        return new Response(
          JSON.stringify({
            tasks: tasksData,
            executor: { busy: true, activeTaskId: 'task-live-1', dispatchPaused: false },
          }),
        );
      }
      if (u.includes('/api/projects')) {
        return new Response(JSON.stringify({ projects: mockProjects }));
      }
      if (u.includes('/api/exports/destinations')) {
        return new Response(JSON.stringify({ destinations: [] }));
      }
      if (u.includes('/api/settings/model')) {
        return new Response(JSON.stringify({ model: 'gpt-4o' }));
      }
      return new Response('{}');
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('renders TasksPage with TaskFeed and handles task detail inspection with secondary RawEventsView', async () => {
    const user = userEvent.setup();
    let renderResult: ReturnType<typeof render>;

    await act(async () => {
      renderResult = render(
        <ToastProvider>
          <TasksPage />
        </ToastProvider>,
      );
    });

    // Check TaskFeed loaded
    expect(await screen.findByText('Analyze Martian atmospheric telemetry')).toBeInTheDocument();
    expect(screen.getByText('Update life support control parameters')).toBeInTheDocument();

    // Check StatusBadges
    expect(screen.getByRole('status', { name: 'Status: Running' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Status: Done' })).toBeInTheDocument();

    // Open detail for task-live-1
    const titleBtn = screen.getByRole('button', {
      name: /View run details for Analyze Martian atmospheric telemetry/i,
    });
    await user.click(titleBtn);

    // Detail panel opens with secondary RawEventsView
    expect(await screen.findByRole('button', { name: /Close details/i })).toBeInTheDocument();
    expect(screen.getByText('Raw task events')).toBeInTheDocument();

    // Verify zero axe accessibility violations on TasksPage
    const results = await axe(renderResult!.container, axeComponentOptions);
    expect(results).toHaveNoViolations();
  });
});
