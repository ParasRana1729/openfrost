/**
 * apps/web/test/challenger-m3-interactions.test.tsx
 *
 * EMPIRICAL ADVERSARIAL CHALLENGE TEST SUITE: Milestone 3 (Requirement R2)
 *
 * Verifies:
 * 1. Row click delegation vs child button isolation:
 *    - Clicking card whitespace delegates to `onSelectTask`.
 *    - Clicking child non-interactive elements (spans, badges, heading, metadata) delegates to `onSelectTask`.
 *    - Clicking `Cancel` button invokes `onCancelTask` and DOES NOT invoke `onSelectTask`.
 *    - Clicking `Retry` button invokes `onRetryTask` and DOES NOT invoke `onSelectTask`.
 *    - Clicking `Project` link DOES NOT invoke `onSelectTask`.
 *    - Clicking external URL link DOES NOT invoke `onSelectTask`.
 *    - Clicking `Details` button invokes `onSelectTask` without double execution or card click bubbling.
 *    - Clicking `Title` button invokes `onSelectTask` without double execution or card click bubbling.
 * 2. Keyboard Enter and Space semantics:
 *    - Title button: Enter / Space triggers `onSelectTask` exactly 1 time without bubbling or double firing.
 *    - Cancel button: Enter / Space triggers `onCancelTask` without triggering `onSelectTask`.
 *    - Retry button: Enter / Space triggers `onRetryTask` without triggering `onSelectTask`.
 *    - Details button: Enter / Space triggers `onSelectTask` without triggering `onCancelTask`/`onRetryTask` or double firing.
 *    - Predictable sequential tab order across interactive controls.
 * 3. RawEventsView disclosure, scrolling & clipboard interaction:
 *    - Expand/collapse toggle via summary button.
 *    - Keyboard scrolling region with `role="region"`, `aria-label="Raw events log"`, and `tabIndex={0}`.
 *    - Formatted JSON payload rendering (`<details>`, `<summary>payload</summary>`, `<pre><code>`) vs omitting for empty payloads.
 *    - "Copy JSON" clipboard interaction, 2-second timeout reversion, and graceful rejection handling.
 * 4. Multi-row stress and adversarial inputs:
 *    - Regex search resilience, XSS string safety, missing project fallbacks, attempt counters.
 * 5. Automated axe scans:
 *    - Zero axe violations on TaskFeed, expanded RawEventsView, and combined views.
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import type { Task, Project, Event } from '@openfrost/domain';

import { TaskFeed } from '../components/TaskFeed';
import { RawEventsView } from '../components/RawEventsView';

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

const axeOptions = {
  rules: {
    region: { enabled: false },
  },
};

// Fixture helpers
function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).slice(2, 9)}`,
    title: 'Adversarial Task Verification',
    request: 'Verify row delegation, keyboard bubbling isolation, and accessibility',
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
    createdAt: new Date(Date.now() - 300_000).toISOString(), // 5m ago
    updatedAt: new Date(Date.now() - 120_000).toISOString(),
    ...overrides,
  };
}

const mockProjects: Project[] = [
  {
    id: 'proj-alpha',
    name: 'Apollo Guidance Subsystem',
    instructions: 'Strict memory bounded execution',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'proj-beta',
    name: 'Gemini Capsule Telemetry',
    instructions: 'High-frequency logging',
    createdAt: '2026-10-02T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
  },
];

const sampleEvents: Event[] = [
  {
    id: 101,
    type: 'task.created',
    taskId: 'task-adv-1',
    runId: null,
    payload: { title: 'Adversarial Task Verification', kind: 'research_brief' },
    createdAt: '2026-10-26T09:00:00Z',
  },
  {
    id: 102,
    type: 'run.started',
    taskId: 'task-adv-1',
    runId: 'run-adv-10',
    payload: { attempt: 1 },
    createdAt: '2026-10-26T09:01:00Z',
  },
  {
    id: 103,
    type: 'tool.executed',
    taskId: 'task-adv-1',
    runId: 'run-adv-10',
    payload: {
      tool: 'web_search',
      arguments: { query: 'quantum computing 2026' },
      durationMs: 412,
      ok: true,
      step: 1,
    },
    createdAt: '2026-10-26T09:02:00Z',
  },
  {
    id: 104,
    type: 'run.completed',
    taskId: 'task-adv-1',
    runId: 'run-adv-10',
    payload: {}, // Empty payload test
    createdAt: '2026-10-26T09:03:00Z',
  },
];

describe('Probe 1: Row Click Delegation vs Child Button & Link Isolation', () => {
  const queuedTask = makeTask({
    id: 'task-q1',
    title: 'Queued analysis task',
    kind: 'research_brief',
    state: 'queued',
    startingUrls: ['https://example.com/one', 'https://example.com/two'],
  });

  const runningTask = makeTask({
    id: 'task-r1',
    title: 'Running simulation pipeline',
    kind: 'project_update',
    state: 'running',
    projectId: 'proj-alpha',
    attemptCount: 2,
  });

  const failedTask = makeTask({
    id: 'task-f1',
    title: 'Failed orbital computation',
    kind: 'export_report',
    state: 'failed',
    error: 'Provider API key missing or expired',
    attemptCount: 3,
  });

  it('delegates clicks on card whitespace directly to onSelectTask', () => {
    const onSelectTask = vi.fn();
    const { container } = render(
      <TaskFeed tasks={[runningTask]} onSelectTask={onSelectTask} />,
    );

    const card = container.querySelector('.task-row-card') as HTMLDivElement;
    expect(card).toBeInTheDocument();

    fireEvent.click(card);
    expect(onSelectTask).toHaveBeenCalledTimes(1);
    expect(onSelectTask).toHaveBeenCalledWith(runningTask);
  });

  it('delegates clicks on non-interactive child elements to onSelectTask', () => {
    const onSelectTask = vi.fn();
    const { container } = render(
      <TaskFeed tasks={[runningTask]} projects={mockProjects} onSelectTask={onSelectTask} />,
    );

    // Click on header div
    const header = container.querySelector('.task-row-header') as HTMLElement;
    fireEvent.click(header);
    expect(onSelectTask).toHaveBeenCalledTimes(1);

    // Click on meta container div
    const meta = container.querySelector('.task-row-meta') as HTMLElement;
    fireEvent.click(meta);
    expect(onSelectTask).toHaveBeenCalledTimes(2);

    // Click on duration display span
    const durationSpan = container.querySelector('.task-duration') as HTMLElement;
    fireEvent.click(durationSpan);
    expect(onSelectTask).toHaveBeenCalledTimes(3);

    // Click on created time span
    const timeSpan = container.querySelector('.task-time') as HTMLElement;
    fireEvent.click(timeSpan);
    expect(onSelectTask).toHaveBeenCalledTimes(4);

    // Click on attempt count badge
    const attemptSpan = container.querySelector('.task-attempts') as HTMLElement;
    fireEvent.click(attemptSpan);
    expect(onSelectTask).toHaveBeenCalledTimes(5);

    // Click on workflow badge
    const workflowBadge = container.querySelector('.workflow-project-update') as HTMLElement;
    fireEvent.click(workflowBadge);
    expect(onSelectTask).toHaveBeenCalledTimes(6);
  });

  it('delegates clicks on URL pills and error snippets to onSelectTask', () => {
    const onSelectTask = vi.fn();
    const { container } = render(
      <TaskFeed tasks={[queuedTask, failedTask]} onSelectTask={onSelectTask} />,
    );

    // URL pill on queued task
    const urlPill = container.querySelector('.url-pill') as HTMLElement;
    expect(urlPill).toBeInTheDocument();
    fireEvent.click(urlPill);
    expect(onSelectTask).toHaveBeenCalledTimes(1);
    expect(onSelectTask).toHaveBeenCalledWith(queuedTask);

    // Error snippet on failed task
    const errorSnippet = container.querySelector('.task-error-snippet') as HTMLElement;
    expect(errorSnippet).toBeInTheDocument();
    fireEvent.click(errorSnippet);
    expect(onSelectTask).toHaveBeenCalledTimes(2);
    expect(onSelectTask).toHaveBeenCalledWith(failedTask);
  });

  it('isolates Cancel button: calls onCancelTask and DOES NOT call onSelectTask', async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    const onCancelTask = vi.fn();

    render(
      <TaskFeed
        tasks={[runningTask]}
        onSelectTask={onSelectTask}
        onCancelTask={onCancelTask}
      />,
    );

    const cancelBtn = screen.getByRole('button', { name: /Cancel task: Running simulation pipeline/i });
    expect(cancelBtn).toBeInTheDocument();

    await user.click(cancelBtn);

    expect(onCancelTask).toHaveBeenCalledTimes(1);
    expect(onCancelTask).toHaveBeenCalledWith(runningTask.id);
    expect(onSelectTask).not.toHaveBeenCalled();
  });

  it('isolates Retry button: calls onRetryTask and DOES NOT call onSelectTask', async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    const onRetryTask = vi.fn();

    render(
      <TaskFeed
        tasks={[failedTask]}
        onSelectTask={onSelectTask}
        onRetryTask={onRetryTask}
      />,
    );

    const retryBtn = screen.getByRole('button', { name: /Retry task: Failed orbital computation/i });
    expect(retryBtn).toBeInTheDocument();

    await user.click(retryBtn);

    expect(onRetryTask).toHaveBeenCalledTimes(1);
    expect(onRetryTask).toHaveBeenCalledWith(failedTask.id);
    expect(onSelectTask).not.toHaveBeenCalled();
  });

  it('isolates Project link: does NOT call onSelectTask when project link is clicked', async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();

    render(
      <TaskFeed
        tasks={[runningTask]}
        projects={mockProjects}
        onSelectTask={onSelectTask}
      />,
    );

    const projectLink = screen.getByRole('link', { name: 'Project: Apollo Guidance Subsystem' });
    expect(projectLink).toBeInTheDocument();
    projectLink.addEventListener('click', (e) => e.preventDefault());

    await user.click(projectLink);

    expect(onSelectTask).not.toHaveBeenCalled();
  });

  it('isolates any nested anchor element: clicking a link does NOT trigger onSelectTask', () => {
    const onSelectTask = vi.fn();
    const { container } = render(
      <TaskFeed tasks={[runningTask]} onSelectTask={onSelectTask} />,
    );

    const card = container.querySelector('.task-row-card') as HTMLDivElement;
    // Inject a synthetic link to test target.closest('a') guard
    const testLink = document.createElement('a');
    testLink.href = 'https://example.com/external';
    testLink.textContent = 'External Source';
    testLink.addEventListener('click', (e) => e.preventDefault());
    card.appendChild(testLink);

    fireEvent.click(testLink);
    expect(onSelectTask).not.toHaveBeenCalled();
  });

  it('Details button: invokes onSelectTask exactly once without card bubbling or double execution', async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    const onCancelTask = vi.fn();
    const onRetryTask = vi.fn();

    render(
      <TaskFeed
        tasks={[runningTask]}
        onSelectTask={onSelectTask}
        onCancelTask={onCancelTask}
        onRetryTask={onRetryTask}
      />,
    );

    const detailsBtn = screen.getByRole('button', { name: /Details for task: Running simulation pipeline/i });
    expect(detailsBtn).toBeInTheDocument();

    await user.click(detailsBtn);

    expect(onSelectTask).toHaveBeenCalledTimes(1);
    expect(onSelectTask).toHaveBeenCalledWith(runningTask);
    expect(onCancelTask).not.toHaveBeenCalled();
    expect(onRetryTask).not.toHaveBeenCalled();
  });

  it('Title button: invokes onSelectTask exactly once without card bubbling or double execution', async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();

    render(
      <TaskFeed tasks={[runningTask]} onSelectTask={onSelectTask} />,
    );

    const titleBtn = screen.getByRole('button', { name: /View run details for Running simulation pipeline/i });
    expect(titleBtn).toBeInTheDocument();

    await user.click(titleBtn);

    expect(onSelectTask).toHaveBeenCalledTimes(1);
    expect(onSelectTask).toHaveBeenCalledWith(runningTask);
  });

  it('handles rapid sequential clicking on Cancel without race conditions or invoking onSelectTask', async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    const onCancelTask = vi.fn();

    render(
      <TaskFeed
        tasks={[runningTask]}
        onSelectTask={onSelectTask}
        onCancelTask={onCancelTask}
      />,
    );

    const cancelBtn = screen.getByRole('button', { name: /Cancel task: Running simulation pipeline/i });

    // Spam clicks 3 times
    await user.click(cancelBtn);
    await user.click(cancelBtn);
    await user.click(cancelBtn);

    expect(onCancelTask).toHaveBeenCalledTimes(3);
    expect(onSelectTask).not.toHaveBeenCalled();
  });
});

describe('Probe 2: Keyboard Enter and Space Semantics & Tab Traversal', () => {
  const taskQueued = makeTask({
    id: 't-kbd-1',
    title: 'Keyboard accessibility task',
    kind: 'project_update',
    state: 'queued',
    projectId: 'proj-beta',
  });

  const taskFailed = makeTask({
    id: 't-kbd-2',
    title: 'Keyboard retry task',
    kind: 'export_report',
    state: 'failed',
    error: 'Timeout exceeded',
  });

  it('Title button: Enter and Space trigger onSelectTask exactly once each without bubbling', async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();

    render(<TaskFeed tasks={[taskQueued]} onSelectTask={onSelectTask} />);

    const titleBtn = screen.getByRole('button', { name: /View run details for Keyboard accessibility task/i });

    titleBtn.focus();
    expect(titleBtn).toHaveFocus();

    // Enter
    await user.keyboard('{Enter}');
    expect(onSelectTask).toHaveBeenCalledTimes(1);
    expect(onSelectTask).toHaveBeenCalledWith(taskQueued);

    // Space
    await user.keyboard(' ');
    expect(onSelectTask).toHaveBeenCalledTimes(2);
  });

  it('Cancel button: Enter and Space trigger onCancelTask and DO NOT trigger onSelectTask', async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    const onCancelTask = vi.fn();

    render(
      <TaskFeed
        tasks={[taskQueued]}
        onSelectTask={onSelectTask}
        onCancelTask={onCancelTask}
      />,
    );

    const cancelBtn = screen.getByRole('button', { name: /Cancel task: Keyboard accessibility task/i });

    cancelBtn.focus();
    expect(cancelBtn).toHaveFocus();

    // Enter
    await user.keyboard('{Enter}');
    expect(onCancelTask).toHaveBeenCalledTimes(1);
    expect(onCancelTask).toHaveBeenCalledWith(taskQueued.id);
    expect(onSelectTask).not.toHaveBeenCalled();

    // Space
    await user.keyboard(' ');
    expect(onCancelTask).toHaveBeenCalledTimes(2);
    expect(onSelectTask).not.toHaveBeenCalled();
  });

  it('Retry button: Enter and Space trigger onRetryTask and DO NOT trigger onSelectTask', async () => {
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

    const retryBtn = screen.getByRole('button', { name: /Retry task: Keyboard retry task/i });

    retryBtn.focus();
    expect(retryBtn).toHaveFocus();

    // Enter
    await user.keyboard('{Enter}');
    expect(onRetryTask).toHaveBeenCalledTimes(1);
    expect(onRetryTask).toHaveBeenCalledWith(taskFailed.id);
    expect(onSelectTask).not.toHaveBeenCalled();

    // Space
    await user.keyboard(' ');
    expect(onRetryTask).toHaveBeenCalledTimes(2);
    expect(onSelectTask).not.toHaveBeenCalled();
  });

  it('Details button: Enter and Space trigger onSelectTask exactly once each without double firing', async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    const onCancelTask = vi.fn();

    render(
      <TaskFeed
        tasks={[taskQueued]}
        onSelectTask={onSelectTask}
        onCancelTask={onCancelTask}
      />,
    );

    const detailsBtn = screen.getByRole('button', { name: /Details for task: Keyboard accessibility task/i });

    detailsBtn.focus();
    expect(detailsBtn).toHaveFocus();

    // Enter
    await user.keyboard('{Enter}');
    expect(onSelectTask).toHaveBeenCalledTimes(1);
    expect(onSelectTask).toHaveBeenCalledWith(taskQueued);
    expect(onCancelTask).not.toHaveBeenCalled();

    // Space
    await user.keyboard(' ');
    expect(onSelectTask).toHaveBeenCalledTimes(2);
    expect(onCancelTask).not.toHaveBeenCalled();
  });

  it('traverses interactive elements in logical tab order without skipping or trapping', async () => {
    const user = userEvent.setup();
    render(<TaskFeed tasks={[taskQueued]} projects={mockProjects} />);

    // Tab 1-5: Filter tabs (All, Active, Queued, Done, Failed)
    // Tab 6: Search input
    // Tab 7: Title button
    // Tab 8: Project link
    // Tab 9: Cancel button
    // Tab 10: Details button

    const titleBtn = screen.getByRole('button', { name: /View run details for Keyboard accessibility task/i });
    const projectLink = screen.getByRole('link', { name: 'Project: Gemini Capsule Telemetry' });
    const cancelBtn = screen.getByRole('button', { name: /Cancel task: Keyboard accessibility task/i });
    const detailsBtn = screen.getByRole('button', { name: /Details for task: Keyboard accessibility task/i });

    titleBtn.focus();
    expect(titleBtn).toHaveFocus();

    await user.tab();
    expect(projectLink).toHaveFocus();

    await user.tab();
    expect(cancelBtn).toHaveFocus();

    await user.tab();
    expect(detailsBtn).toHaveFocus();
  });
});

describe('Probe 3: RawEventsView Disclosure, Scrolling, Payloads & Clipboard', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('renders collapsed by default and expands/collapses when toggle button is clicked', async () => {
    const user = userEvent.setup();
    render(<RawEventsView events={sampleEvents} />);

    // Initially collapsed
    const disclosureBtn = screen.getByRole('button', { name: /Raw system events/i });
    expect(disclosureBtn).toHaveAttribute('aria-expanded', 'false');

    // Toggle open
    await user.click(disclosureBtn);
    expect(disclosureBtn).toHaveAttribute('aria-expanded', 'true');

    const consoleRegion = screen.getByRole('region', { name: 'Raw events log' });
    expect(consoleRegion).toBeInTheDocument();

    // Toggle closed
    await user.click(disclosureBtn);
    expect(disclosureBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('supports controlled open state and invokes onToggle callback', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(
      <RawEventsView events={sampleEvents} isOpen={false} onToggle={onToggle} />,
    );

    const toggleBtn = screen.getByRole('button', { name: /Raw system events/i });
    await user.click(toggleBtn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(true);

    rerender(<RawEventsView events={sampleEvents} isOpen={true} onToggle={onToggle} />);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('console container has role="region", aria-label="Raw events log", and tabIndex={0} for keyboard scrolling', () => {
    render(<RawEventsView events={sampleEvents} defaultOpen={true} />);

    const consoleRegion = screen.getByRole('region', { name: 'Raw events log' });
    expect(consoleRegion).toBeInTheDocument();
    expect(consoleRegion).toHaveAttribute('tabIndex', '0');
    expect(consoleRegion).toHaveClass('raw-events-console');

    // Test programmatic focus
    consoleRegion.focus();
    expect(consoleRegion).toHaveFocus();
  });

  it('renders JSON payload details only when payload is non-empty', () => {
    render(<RawEventsView events={sampleEvents} defaultOpen={true} />);

    // Event 101, 102, 103 have payloads -> 3 payload details elements
    const payloadDetails = screen.getAllByText('payload');
    expect(payloadDetails.length).toBe(3);

    // Event 103 has arguments query
    expect(screen.getByText(/"query": "quantum computing 2026"/)).toBeInTheDocument();
    expect(screen.getByText(/"tool": "web_search"/)).toBeInTheDocument();

    // Event 104 has empty payload `{}` -> should not add an extra details
    expect(screen.getByText('run.completed')).toBeInTheDocument();
  });

  it('formats deeply nested JSON payloads cleanly with indentation', () => {
    const deepEvent: Event = {
      id: 201,
      type: 'tool.executed',
      taskId: 't-deep',
      runId: 'r-deep',
      payload: {
        config: {
          subsystems: ['gnc', 'propulsion', 'telemetry'],
          limits: { maxSteps: 50, wallClockMs: 60000 },
        },
      },
      createdAt: '2026-10-26T09:10:00Z',
    };

    render(<RawEventsView events={[deepEvent]} defaultOpen={true} />);

    expect(screen.getByText(/"subsystems": \[/)).toBeInTheDocument();
    expect(screen.getByText(/"limits": \{/)).toBeInTheDocument();
  });

  it('handles "Copy JSON" interaction, copies formatted JSON, and reverts label after 2000ms', async () => {
    vi.useFakeTimers();

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    render(<RawEventsView events={sampleEvents} defaultOpen={true} />);

    const copyBtn = screen.getByRole('button', { name: /Copy all raw events as JSON/i });
    expect(copyBtn).toHaveTextContent('Copy JSON');

    fireEvent.click(copyBtn);

    // Flush resolved clipboard promise
    await act(async () => {
      await Promise.resolve();
    });

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith(JSON.stringify(sampleEvents, null, 2));
    expect(copyBtn).toHaveTextContent('Copied JSON!');

    // Advance 2 seconds
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(copyBtn).toHaveTextContent('Copy JSON');
    vi.useRealTimers();
  });

  it('gracefully handles clipboard failure without crashing', async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockRejectedValue(new Error('Clipboard permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    render(<RawEventsView events={sampleEvents} defaultOpen={true} />);

    const copyBtn = screen.getByRole('button', { name: /Copy all raw events as JSON/i });
    expect(copyBtn).toBeInTheDocument();

    // Should not throw or crash
    await user.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledTimes(1);
  });

  it('displays empty state and hides Copy JSON button when events list is empty', () => {
    render(<RawEventsView events={[]} defaultOpen={true} />);

    expect(screen.getByText('No events recorded.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy all raw events as JSON/i })).not.toBeInTheDocument();
  });

  it('hides Copy JSON button when showCopyAll is false', () => {
    render(<RawEventsView events={sampleEvents} defaultOpen={true} showCopyAll={false} />);

    expect(screen.queryByRole('button', { name: /Copy all raw events as JSON/i })).not.toBeInTheDocument();
  });
});

describe('Probe 4: Adversarial Edge Cases & Multi-Row Feeds', () => {
  it('resiliently handles search inputs containing regex special characters without errors', async () => {
    const tasks = [
      makeTask({ id: 't-regex-1', title: 'Task with [brackets] and (parentheses)', request: 'Req 1' }),
      makeTask({ id: 't-regex-2', title: 'Task with *asterisks* and +plus+', request: 'Req 2' }),
      makeTask({ id: 't-regex-3', title: 'Task with ?question marks? and $dollar^', request: 'Req 3' }),
    ];

    render(<TaskFeed tasks={tasks} />);

    const searchInput = screen.getByRole('searchbox', { name: /Search tasks by title or request/i });

    // Search with unescaped regex metacharacters via change event
    fireEvent.change(searchInput, { target: { value: '[brackets]' } });
    expect(screen.getByText('Task with [brackets] and (parentheses)')).toBeInTheDocument();
    expect(screen.queryByText('Task with *asterisks* and +plus+')).not.toBeInTheDocument();
    expect(screen.queryByText('Task with ?question marks? and $dollar^')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: '*asterisks*' } });
    expect(screen.getByText('Task with *asterisks* and +plus+')).toBeInTheDocument();
    expect(screen.queryByText('Task with [brackets] and (parentheses)')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: '?question' } });
    expect(screen.getByText('Task with ?question marks? and $dollar^')).toBeInTheDocument();
    expect(screen.queryByText('Task with *asterisks* and +plus+')).not.toBeInTheDocument();
  });

  it('safely renders HTML and script strings as plain text without DOM injection', () => {
    const xssTask = makeTask({
      id: 't-xss-1',
      title: '<script>alert("xss")</script><img src=x onerror=alert(1)>',
      request: '<b>Bold Request</b>',
      error: '<svg onload=alert(2)>Error',
    });

    render(<TaskFeed tasks={[xssTask]} />);

    expect(screen.getByText('<script>alert("xss")</script><img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getByText('Error: <svg onload=alert(2)>Error')).toBeInTheDocument();
  });

  it('falls back gracefully to truncated project ID when projectId is unknown in projects list', () => {
    const orphanTask = makeTask({
      id: 't-orphan-1',
      title: 'Task referencing unknown project',
      projectId: 'unknown-project-guid-12345678',
    });

    render(<TaskFeed tasks={[orphanTask]} projects={mockProjects} />);

    expect(screen.getByRole('link', { name: 'Project: unknown-…' })).toBeInTheDocument();
    expect(screen.getByText('📁 unknown-…')).toBeInTheDocument();
  });

  it('handles 50 tasks across various workflow kinds and states with correct filter counts', () => {
    const largeTasks: Task[] = [];
    for (let i = 0; i < 50; i++) {
      const state = i < 10 ? 'queued' : i < 20 ? 'running' : i < 35 ? 'completed' : 'failed';
      const kind =
        i % 4 === 0
          ? 'research_brief'
          : i % 4 === 1
            ? 'project_update'
            : i % 4 === 2
              ? 'export_report'
              : 'weekly_plan';
      largeTasks.push(
        makeTask({
          id: `task-bulk-${i}`,
          title: `Bulk Task #${i}`,
          state,
          kind,
          projectId: i % 2 === 0 ? 'proj-alpha' : null,
        }),
      );
    }

    render(<TaskFeed tasks={largeTasks} projects={mockProjects} />);

    expect(screen.getByRole('tab', { name: /All \(50\)/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Active \(10\)/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Queued \(10\)/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Done \(15\)/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Failed \(15\)/i })).toBeInTheDocument();
  });
});

describe('Probe 5: Automated Axe Accessibility Audits', () => {
  const diverseTasks = [
    makeTask({
      id: 'task-a11y-1',
      title: 'Research orbital maneuvers',
      kind: 'research_brief',
      state: 'queued',
      startingUrls: ['https://nasa.gov', 'https://esa.int'],
    }),
    makeTask({
      id: 'task-a11y-2',
      title: 'Update propulsion controls',
      kind: 'project_update',
      state: 'running',
      projectId: 'proj-alpha',
      attemptCount: 2,
    }),
    makeTask({
      id: 'task-a11y-3',
      title: 'Export guidance report',
      kind: 'export_report',
      state: 'completed',
    }),
    makeTask({
      id: 'task-a11y-4',
      title: 'Failed trajectory convergence',
      kind: 'weekly_plan',
      state: 'failed',
      error: 'Iteration limit exceeded',
      attemptCount: 3,
    }),
  ];

  it('TaskFeed with multiple diverse rows passes axe audit with zero violations', async () => {
    let results: Awaited<ReturnType<typeof axe>>;
    await act(async () => {
      const { container } = render(
        <TaskFeed tasks={diverseTasks} projects={mockProjects} />,
      );
      results = await axe(container, axeOptions);
    });

    expect(results!).toHaveNoViolations();
  });

  it('RawEventsView expanded with multiple events and payloads passes axe audit with zero violations', async () => {
    let results: Awaited<ReturnType<typeof axe>>;
    await act(async () => {
      const { container } = render(
        <RawEventsView events={sampleEvents} defaultOpen={true} />,
      );
      results = await axe(container, axeOptions);
    });

    expect(results!).toHaveNoViolations();
  });

  it('Combined view containing TaskFeed and expanded RawEventsView passes axe with zero violations', async () => {
    let results: Awaited<ReturnType<typeof axe>>;
    await act(async () => {
      const { container } = render(
        <div>
          <TaskFeed tasks={diverseTasks} projects={mockProjects} />
          <RawEventsView events={sampleEvents} defaultOpen={true} />
        </div>,
      );
      results = await axe(container, axeOptions);
    });

    expect(results!).toHaveNoViolations();
  });

  it('Empty TaskFeed and zero search results state pass axe audits with zero violations', async () => {
    let results: Awaited<ReturnType<typeof axe>>;
    let renderResult: ReturnType<typeof render>;
    await act(async () => {
      renderResult = render(<TaskFeed tasks={[]} />);
      results = await axe(renderResult.container, axeOptions);
    });
    expect(results!).toHaveNoViolations();

    // Zero filter results state with Reset filters button
    await act(async () => {
      renderResult.rerender(<TaskFeed tasks={diverseTasks} />);
    });
    const searchInput = screen.getByRole('searchbox', { name: /Search tasks by title or request/i });
    fireEvent.change(searchInput, { target: { value: 'nonexistent-query-string-xyz' } });

    await act(async () => {
      results = await axe(renderResult.container, axeOptions);
    });
    expect(results!).toHaveNoViolations();
  });
});
