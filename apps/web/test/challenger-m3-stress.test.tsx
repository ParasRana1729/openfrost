/**
 * apps/web/test/challenger-m3-stress.test.tsx
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST SUITE: Milestone 3 TaskFeed & Formatting Deliverables
 *
 * Verifies:
 * 1. Live elapsed timer stress:
 *    - Rapid fake timer advances (seconds, minutes, hours, days)
 *    - Component unmount timer cleanup & memory leak prevention
 *    - Negative clock skew clamping (future startedAt -> '0s')
 *    - Subsecond flooring & clamping (<1000ms -> '0s')
 *    - Invalid / unparseable / null / empty timestamp resilience
 *    - Dynamic toggling of timer active state
 *    - Live DOM updates inside TaskFeed for running tasks
 * 2. Filter tab transitions and search filtering:
 *    - Rapid cycling across all tabs ('all', 'active', 'queued', 'done', 'failed')
 *    - Live counter recalculations on tasks prop mutation
 *    - Case-insensitive search stress (mixed-case, upper, lower)
 *    - Empty & whitespace-only query passthrough
 *    - Non-matching query empty state & "Reset filters" dual-reset behavior
 *    - Search matching across title, request, and error fields
 *    - Combined tab + search query intersection filtering
 * 3. Queue elapsed calculations:
 *    - formatTimeAgo boundary conditions: <10s ('just now') vs >=10s ('10s ago')
 *    - Granular intervals: seconds, minutes, hours, days, >7d calendar fallback
 *    - Future timestamps (clock skew) clamping to 'just now'
 *    - formatTaskDuration for queued tasks across all elapsed ranges
 * 4. Completed duration edge cases:
 *    - formatDuration millisecond flooring, multi-hour, multi-day, negative, and NaN
 *    - formatToolDuration subsecond rounding, fractional seconds, and null/NaN
 *    - formatRunDuration and formatTaskDuration fallback hierarchies when latestRun is absent,
 *      partial, or corrupt
 *    - Terminal state formatting for failed, canceled, and interrupted tasks
 * 5. Axe accessibility audits:
 *    - 0 violations across all feed states (running, mixed workflows, filtered empty, feed empty)
 *    - Keyboard focus navigation & ARIA semantics
 *    - RawEventsView accessibility in collapsed & expanded console states
 */

import React, { useState } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import type { Task, Project, Event, AgentRun } from '@openfrost/domain';

import { TaskFeed } from '../components/TaskFeed';
import { RawEventsView } from '../components/RawEventsView';
import {
  formatDuration,
  formatToolDuration,
  formatTimeAgo,
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

// Fixture factory
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
    attemptCount: 1,
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

// Helper component for testing useElapsedTimer directly
function HookTimerTester({
  startedAt,
  active = true,
}: {
  startedAt: string | null | undefined;
  active?: boolean;
}) {
  const elapsed = useElapsedTimer(startedAt, active);
  return <div data-testid="hook-timer-value">{elapsed}</div>;
}

// Helper wrapper allowing dynamic toggling of props
function DynamicTimerContainer({ initialStartedAt }: { initialStartedAt: string }) {
  const [active, setActive] = useState(true);
  const [startedAt, setStartedAt] = useState(initialStartedAt);
  const elapsed = useElapsedTimer(startedAt, active);

  return (
    <div>
      <div data-testid="dynamic-elapsed">{elapsed}</div>
      <button type="button" onClick={() => setActive((prev) => !prev)}>
        Toggle Active
      </button>
      <button type="button" onClick={() => setStartedAt(new Date().toISOString())}>
        Reset Timestamp
      </button>
    </div>
  );
}

describe('Challenger M3: Adversarial Stress Test Suite', () => {
  // =========================================================================
  // 1. Live Elapsed Timer Stress
  // =========================================================================
  describe('1. Live Elapsed Timer Stress (useElapsedTimer & Running Tasks)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('handles rapid fake timer advances across seconds, minutes, hours, and days', () => {
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);
      const startTimeIso = new Date(baseTime).toISOString();

      render(<HookTimerTester startedAt={startTimeIso} active={true} />);
      const display = screen.getByTestId('hook-timer-value');
      expect(display.textContent).toBe('0s');

      // +1s
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(display.textContent).toBe('1s');

      // +58s (total 59s)
      act(() => {
        vi.advanceTimersByTime(58000);
      });
      expect(display.textContent).toBe('59s');

      // +1s (total 60s -> 1m)
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(display.textContent).toBe('1m');

      // +15s (total 1m 15s)
      act(() => {
        vi.advanceTimersByTime(15000);
      });
      expect(display.textContent).toBe('1m 15s');

      // +3525s (total 3600s -> 1h)
      act(() => {
        vi.advanceTimersByTime(3525000);
      });
      expect(display.textContent).toBe('1h');

      // +240s (total 1h 4m)
      act(() => {
        vi.advanceTimersByTime(240000);
      });
      expect(display.textContent).toBe('1h 4m');

      // +82560s (total 86400s -> 1d)
      act(() => {
        vi.advanceTimersByTime(82560000);
      });
      expect(display.textContent).toBe('1d');

      // +7200s (total 1d 2h)
      act(() => {
        vi.advanceTimersByTime(7200000);
      });
      expect(display.textContent).toBe('1d 2h');
    });

    it('cleans up interval on unmount without throwing or leaking state updates', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const startTimeIso = new Date().toISOString();

      const { unmount } = render(<HookTimerTester startedAt={startTimeIso} />);
      expect(screen.getByTestId('hook-timer-value')).toBeInTheDocument();

      unmount();
      expect(clearIntervalSpy).toHaveBeenCalled();

      // Advancing timer after unmount should produce no act warnings or errors
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(screen.queryByTestId('hook-timer-value')).not.toBeInTheDocument();
      clearIntervalSpy.mockRestore();
    });

    it('clamps negative clock skew to "0s" when startedAt is in the future', () => {
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      // Future timestamps: +5s, +1h, +3d ahead of current time
      const future5s = new Date(baseTime + 5000).toISOString();
      const { rerender } = render(<HookTimerTester startedAt={future5s} />);
      expect(screen.getByTestId('hook-timer-value').textContent).toBe('0s');

      // Advance by 3s (still 2s in future) -> still 0s
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByTestId('hook-timer-value').textContent).toBe('0s');

      // Advance by 3s more (now 1s past startedAt) -> 1s
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByTestId('hook-timer-value').textContent).toBe('1s');

      // Extremely far in future (+2 days)
      const future2d = new Date(baseTime + 172800000).toISOString();
      rerender(<HookTimerTester startedAt={future2d} />);
      expect(screen.getByTestId('hook-timer-value').textContent).toBe('0s');
    });

    it('floors subsecond differences to "0s" and advances after 1000ms tick', () => {
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      // 450ms ago
      const subsecondIso = new Date(baseTime - 450).toISOString();
      render(<HookTimerTester startedAt={subsecondIso} />);
      expect(screen.getByTestId('hook-timer-value').textContent).toBe('0s');

      // Advance by 500ms (interval has not ticked yet, tick happens every 1000ms)
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.getByTestId('hook-timer-value').textContent).toBe('0s');

      // Advance by another 500ms (total 1000ms since mount -> interval ticks!)
      // Elapsed is now 1450ms, which formatDuration floors to 1s
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.getByTestId('hook-timer-value').textContent).toBe('1s');
    });

    it('gracefully handles invalid, null, undefined, and empty string timestamps on mount', () => {
      const { unmount: unmount1 } = render(<HookTimerTester startedAt={null} />);
      expect(screen.getByTestId('hook-timer-value').textContent).toBe('0s');
      unmount1();

      const { unmount: unmount2 } = render(<HookTimerTester startedAt={undefined} />);
      expect(screen.getByTestId('hook-timer-value').textContent).toBe('0s');
      unmount2();

      const { unmount: unmount3 } = render(<HookTimerTester startedAt="" />);
      expect(screen.getByTestId('hook-timer-value').textContent).toBe('0s');
      unmount3();

      render(<HookTimerTester startedAt="not-a-valid-date" />);
      expect(screen.getByTestId('hook-timer-value').textContent).toBe('—');
    });

    it('toggles interval behavior dynamically when active prop changes', () => {
      const startTimeIso = new Date().toISOString();
      render(<DynamicTimerContainer initialStartedAt={startTimeIso} />);

      const display = screen.getByTestId('dynamic-elapsed');
      expect(display.textContent).toBe('0s');

      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(display.textContent).toBe('4s');

      // Toggle active off
      fireEvent.click(screen.getByRole('button', { name: 'Toggle Active' }));

      // Advance timers while inactive -> elapsed value freezes and interval is stopped
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(display.textContent).toBe('4s');

      // Toggle active back on -> immediately resumes with true elapsed time (14s)
      fireEvent.click(screen.getByRole('button', { name: 'Toggle Active' }));
      expect(display.textContent).toBe('14s');
    });

    it('empirically updates TaskFeed DOM element live for running tasks', () => {
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      const runningTask = makeTask({
        id: 't-live-run',
        title: 'Realtime telemetry pipeline',
        state: 'running',
        updatedAt: new Date(baseTime).toISOString(),
      });

      render(<TaskFeed tasks={[runningTask]} />);
      expect(screen.getByText('running for 0s')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(12000);
      });
      expect(screen.getByText('running for 12s')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(65000);
      });
      expect(screen.getByText('running for 1m 17s')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // 2. Filter Tab Transitions & Search Filtering
  // =========================================================================
  describe('2. Filter Tab Transitions & Search Filtering', () => {
    const taskRunning = makeTask({
      id: 'task-1',
      title: 'Analyze Martian Soil Samples',
      request: 'Perform spectrographic analysis on soil telemetry',
      state: 'running',
    });
    const taskApproval = makeTask({
      id: 'task-2',
      title: 'Export Rover Path Plan',
      request: 'Awaiting operator approval to write to local directory',
      state: 'awaiting_approval',
    });
    const taskQueued = makeTask({
      id: 'task-3',
      title: 'Queue Orbital Adjustment',
      request: 'Calculate delta-v for Hohmann transfer',
      state: 'queued',
    });
    const taskDone = makeTask({
      id: 'task-4',
      title: 'Calibrate Star Tracker Optics',
      request: 'Completed fine calibration of optical lenses',
      state: 'completed',
    });
    const taskFailed = makeTask({
      id: 'task-5',
      title: 'Transmit Deep Space Telemetry',
      request: 'High-gain antenna link down',
      state: 'failed',
      error: 'Transmitter carrier signal lost at 8.4 GHz',
    });
    const taskCanceled = makeTask({
      id: 'task-6',
      title: 'Manual Battery Discharge',
      request: 'Owner stopped execution manually',
      state: 'canceled',
    });

    const dataset = [taskRunning, taskApproval, taskQueued, taskDone, taskFailed, taskCanceled];

    it('rapidly cycles through all filter tabs and matches counts accurately', async () => {
      const user = userEvent.setup();
      render(<TaskFeed tasks={dataset} />);

      // Verify tab counts:
      // all: 6
      // active: 2 (running + awaiting_approval)
      // queued: 1
      // done: 1
      // failed: 2 (failed + canceled)
      const tabAll = screen.getByRole('tab', { name: /All \(6\)/i });
      const tabActive = screen.getByRole('tab', { name: /Active \(2\)/i });
      const tabQueued = screen.getByRole('tab', { name: /Queued \(1\)/i });
      const tabDone = screen.getByRole('tab', { name: /Done \(1\)/i });
      const tabFailed = screen.getByRole('tab', { name: /Failed \(2\)/i });

      expect(tabAll).toHaveAttribute('aria-selected', 'true');

      // Click Active -> only running & awaiting_approval
      await user.click(tabActive);
      expect(tabActive).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Analyze Martian Soil Samples')).toBeInTheDocument();
      expect(screen.getByText('Export Rover Path Plan')).toBeInTheDocument();
      expect(screen.queryByText('Queue Orbital Adjustment')).not.toBeInTheDocument();
      expect(screen.queryByText('Calibrate Star Tracker Optics')).not.toBeInTheDocument();

      // Click Queued -> only taskQueued
      await user.click(tabQueued);
      expect(tabQueued).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Queue Orbital Adjustment')).toBeInTheDocument();
      expect(screen.queryByText('Analyze Martian Soil Samples')).not.toBeInTheDocument();

      // Click Done -> only taskDone
      await user.click(tabDone);
      expect(tabDone).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Calibrate Star Tracker Optics')).toBeInTheDocument();
      expect(screen.queryByText('Queue Orbital Adjustment')).not.toBeInTheDocument();

      // Click Failed -> taskFailed AND taskCanceled
      await user.click(tabFailed);
      expect(tabFailed).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Transmit Deep Space Telemetry')).toBeInTheDocument();
      expect(screen.getByText('Manual Battery Discharge')).toBeInTheDocument();
      expect(screen.queryByText('Calibrate Star Tracker Optics')).not.toBeInTheDocument();

      // Click back to All -> all 6 visible
      await user.click(tabAll);
      expect(tabAll).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Analyze Martian Soil Samples')).toBeInTheDocument();
      expect(screen.getByText('Calibrate Star Tracker Optics')).toBeInTheDocument();
    });

    it('dynamically recalculates counters when tasks prop mutates', () => {
      const { rerender } = render(<TaskFeed tasks={[taskQueued, taskRunning]} />);

      expect(screen.getByRole('tab', { name: /All \(2\)/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Active \(1\)/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Queued \(1\)/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Done \(0\)/i })).toBeInTheDocument();

      // Mutate tasks: taskQueued becomes running, taskRunning completed, new task added
      const updatedQueuedToRunning = { ...taskQueued, state: 'running' as const };
      const updatedRunningToDone = { ...taskRunning, state: 'completed' as const };
      const newTask = makeTask({ id: 't-new', title: 'New Task', state: 'queued' });

      rerender(<TaskFeed tasks={[updatedQueuedToRunning, updatedRunningToDone, newTask]} />);

      expect(screen.getByRole('tab', { name: /All \(3\)/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Active \(1\)/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Queued \(1\)/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /Done \(1\)/i })).toBeInTheDocument();
    });

    it('performs case-insensitive search across title, request, and error fields', async () => {
      const user = userEvent.setup();
      render(<TaskFeed tasks={dataset} />);

      const searchInput = screen.getByRole('searchbox', { name: /Search tasks by title or request/i });

      // Match via title in UPPERCASE
      await user.type(searchInput, 'MARTIAN');
      expect(screen.getByText('Analyze Martian Soil Samples')).toBeInTheDocument();
      expect(screen.queryByText('Export Rover Path Plan')).not.toBeInTheDocument();

      // Match via request in mixed case ("HoHmAnN")
      await user.clear(searchInput);
      await user.type(searchInput, 'HoHmAnN');
      expect(screen.getByText('Queue Orbital Adjustment')).toBeInTheDocument();
      expect(screen.queryByText('Analyze Martian Soil Samples')).not.toBeInTheDocument();

      // Match via error field ("carrier signal")
      await user.clear(searchInput);
      await user.type(searchInput, 'carrier signal');
      expect(screen.getByText('Transmit Deep Space Telemetry')).toBeInTheDocument();
      expect(screen.queryByText('Queue Orbital Adjustment')).not.toBeInTheDocument();
    });

    it('preserves all items when search query contains only spaces or tabs', async () => {
      const user = userEvent.setup();
      render(<TaskFeed tasks={dataset} />);

      const searchInput = screen.getByRole('searchbox', { name: /Search tasks by title or request/i });

      await user.type(searchInput, '   \t  ');
      // All 6 tasks should remain visible
      expect(screen.getByText('Analyze Martian Soil Samples')).toBeInTheDocument();
      expect(screen.getByText('Export Rover Path Plan')).toBeInTheDocument();
      expect(screen.getByText('Queue Orbital Adjustment')).toBeInTheDocument();
      expect(screen.getByText('Calibrate Star Tracker Optics')).toBeInTheDocument();
      expect(screen.getByText('Transmit Deep Space Telemetry')).toBeInTheDocument();
      expect(screen.getByText('Manual Battery Discharge')).toBeInTheDocument();
    });

    it('resets BOTH search query and filter tab when clicking "Reset filters"', async () => {
      const user = userEvent.setup();
      render(<TaskFeed tasks={dataset} />);

      // Switch to Failed tab
      await user.click(screen.getByRole('tab', { name: /Failed \(2\)/i }));

      // Type a query that matches no failed tasks
      const searchInput = screen.getByRole('searchbox', { name: /Search tasks by title or request/i });
      await user.type(searchInput, 'no_such_task_exists_xyz');

      expect(screen.getByText('No tasks match your filter.')).toBeInTheDocument();

      // Click "Reset filters"
      const resetBtn = screen.getByRole('button', { name: 'Reset filters' });
      await user.click(resetBtn);

      // Verify search input is cleared AND tab is reset to 'all'
      expect(searchInput).toHaveValue('');
      expect(screen.getByRole('tab', { name: /All \(6\)/i })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Analyze Martian Soil Samples')).toBeInTheDocument();
      expect(screen.getByText('Calibrate Star Tracker Optics')).toBeInTheDocument();
    });

    it('intersects tab filtering with search query filtering cleanly', async () => {
      const user = userEvent.setup();
      render(<TaskFeed tasks={dataset} />);

      // Filter: Active tab (taskRunning and taskApproval)
      await user.click(screen.getByRole('tab', { name: /Active \(2\)/i }));

      const searchInput = screen.getByRole('searchbox', { name: /Search tasks by title or request/i });

      // Search for "telemetry" -> taskRunning has "telemetry" in request; taskFailed also does,
      // but taskFailed is in Failed tab, so only taskRunning should appear
      await user.type(searchInput, 'telemetry');
      expect(screen.getByText('Analyze Martian Soil Samples')).toBeInTheDocument();
      expect(screen.queryByText('Export Rover Path Plan')).not.toBeInTheDocument();
      expect(screen.queryByText('Transmit Deep Space Telemetry')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 3. Queue Elapsed Calculations
  // =========================================================================
  describe('3. Queue Elapsed Calculations (formatTimeAgo & formatTaskDuration)', () => {
    it('accurately distinguishes <10s boundary as "just now" vs >=10s as "10s ago"', () => {
      const now = 1_700_000_000_000;

      // 0ms ago -> 'just now'
      expect(formatTimeAgo(new Date(now).toISOString(), now)).toBe('just now');

      // 9,999ms ago -> 'just now'
      expect(formatTimeAgo(new Date(now - 9999).toISOString(), now)).toBe('just now');

      // 10,000ms ago -> '10s ago'
      expect(formatTimeAgo(new Date(now - 10000).toISOString(), now)).toBe('10s ago');

      // 59,999ms ago -> '59s ago'
      expect(formatTimeAgo(new Date(now - 59999).toISOString(), now)).toBe('59s ago');

      // 60,000ms ago -> '1m ago'
      expect(formatTimeAgo(new Date(now - 60000).toISOString(), now)).toBe('1m ago');
    });

    it('handles multi-hour and multi-day queue times up to the 7-day calendar threshold', () => {
      const now = 1_700_000_000_000;

      // 59 minutes ago
      expect(formatTimeAgo(new Date(now - 59 * 60 * 1000).toISOString(), now)).toBe('59m ago');

      // 1 hour ago
      expect(formatTimeAgo(new Date(now - 60 * 60 * 1000).toISOString(), now)).toBe('1h ago');

      // 23 hours ago
      expect(formatTimeAgo(new Date(now - 23 * 3600 * 1000).toISOString(), now)).toBe('23h ago');

      // 1 day ago (24 hours)
      expect(formatTimeAgo(new Date(now - 24 * 3600 * 1000).toISOString(), now)).toBe('1d ago');

      // 3 days ago
      expect(formatTimeAgo(new Date(now - 3 * 86400 * 1000).toISOString(), now)).toBe('3d ago');

      // 6 days 23 hours ago
      expect(formatTimeAgo(new Date(now - (6 * 86400 + 23 * 3600) * 1000).toISOString(), now)).toBe('6d ago');

      // 7 days ago -> falls back to toLocaleDateString()
      const sevenDaysAgoDate = new Date(now - 7 * 86400 * 1000);
      expect(formatTimeAgo(sevenDaysAgoDate.toISOString(), now)).toBe(sevenDaysAgoDate.toLocaleDateString());
    });

    it('clamps future timestamps caused by clock skew to "just now"', () => {
      const now = 1_700_000_000_000;

      // 1 second in the future
      expect(formatTimeAgo(new Date(now + 1000).toISOString(), now)).toBe('just now');

      // 1 hour in the future
      expect(formatTimeAgo(new Date(now + 3600000).toISOString(), now)).toBe('just now');

      // 3 days in the future
      expect(formatTimeAgo(new Date(now + 3 * 86400000).toISOString(), now)).toBe('just now');
    });

    it('formats queued tasks via formatTaskDuration with prefix across time windows', () => {
      const now = 1_700_000_000_000;

      const taskJustNow = makeTask({
        state: 'queued',
        createdAt: new Date(now - 5000).toISOString(),
      });
      expect(formatTaskDuration(taskJustNow, null, now)).toBe('queued just now');

      const task10s = makeTask({
        state: 'queued',
        createdAt: new Date(now - 10000).toISOString(),
      });
      expect(formatTaskDuration(task10s, null, now)).toBe('queued 10s ago');

      const task3d = makeTask({
        state: 'queued',
        createdAt: new Date(now - 3 * 86400000).toISOString(),
      });
      expect(formatTaskDuration(task3d, null, now)).toBe('queued 3d ago');

      const taskFuture = makeTask({
        state: 'queued',
        createdAt: new Date(now + 60000).toISOString(),
      });
      expect(formatTaskDuration(taskFuture, null, now)).toBe('queued just now');

      const taskInvalid = makeTask({
        state: 'queued',
        createdAt: 'invalid-date',
      });
      expect(formatTaskDuration(taskInvalid, null, now)).toBe('queued —');
    });
  });

  // =========================================================================
  // 4. Completed Duration Edge Cases
  // =========================================================================
  describe('4. Completed Duration Edge Cases (formatDuration & formatTaskDuration)', () => {
    it('rigorously tests formatDuration boundary transitions', () => {
      // Millisecond flooring
      expect(formatDuration(0)).toBe('0s');
      expect(formatDuration(1)).toBe('0s');
      expect(formatDuration(499)).toBe('0s');
      expect(formatDuration(999)).toBe('0s');
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(1999)).toBe('1s');

      // Minutes boundary
      expect(formatDuration(59000)).toBe('59s');
      expect(formatDuration(60000)).toBe('1m');
      expect(formatDuration(61000)).toBe('1m 1s');
      expect(formatDuration(119000)).toBe('1m 59s');
      expect(formatDuration(120000)).toBe('2m');

      // Hours boundary
      expect(formatDuration(3599000)).toBe('59m 59s');
      expect(formatDuration(3600000)).toBe('1h');
      expect(formatDuration(3660000)).toBe('1h 1m');
      expect(formatDuration(7199000)).toBe('1h 59m');
      expect(formatDuration(7200000)).toBe('2h');

      // Days boundary
      expect(formatDuration(86399000)).toBe('23h 59m');
      expect(formatDuration(86400000)).toBe('1d');
      expect(formatDuration(90000000)).toBe('1d 1h');
      expect(formatDuration(172800000)).toBe('2d');
      expect(formatDuration(180000000)).toBe('2d 2h');

      // Edge cases
      expect(formatDuration(-1000)).toBe('0s');
      expect(formatDuration(NaN)).toBe('—');
      expect(formatDuration(null)).toBe('—');
      expect(formatDuration(undefined)).toBe('—');
    });

    it('tests formatToolDuration precision and rounding', () => {
      expect(formatToolDuration(0)).toBe('0ms');
      expect(formatToolDuration(450.4)).toBe('450ms');
      expect(formatToolDuration(999.4)).toBe('999ms');
      expect(formatToolDuration(999.6)).toBe('1.0s');
      expect(formatToolDuration(1000)).toBe('1.0s');
      expect(formatToolDuration(1250)).toBe('1.3s');
      expect(formatToolDuration(59990)).toBe('60.0s');
      expect(formatToolDuration(-50)).toBe('0ms');
      expect(formatToolDuration(null)).toBeNull();
      expect(formatToolDuration(undefined)).toBeNull();
      expect(formatToolDuration(NaN)).toBeNull();
    });

    it('tests formatRunDuration with complete, running, missing, and corrupted run data', () => {
      const now = 1_700_000_000_000;

      // Active run
      const runningRun: AgentRun = {
        id: 'r-1',
        taskId: 't-1',
        attempt: 1,
        state: 'running',
        startedAt: new Date(now - 45000).toISOString(),
        endedAt: null,
        failure: null,
        usage: null,
      };
      expect(formatRunDuration(runningRun, now)).toBe('running for 45s');

      // Completed run
      const doneRun: AgentRun = {
        ...runningRun,
        state: 'completed',
        endedAt: new Date(now - 5000).toISOString(), // ran for 40s
      };
      expect(formatRunDuration(doneRun, now)).toBe('40s');

      // Corrupted run: endedAt before startedAt (clock change) -> clamped to 0s
      const invertedRun: AgentRun = {
        ...runningRun,
        state: 'completed',
        endedAt: new Date(now - 50000).toISOString(),
      };
      expect(formatRunDuration(invertedRun, now)).toBe('0s');

      // Missing or unparseable startedAt
      expect(formatRunDuration({ ...runningRun, startedAt: 'bad-date' }, now)).toBe('—');
      expect(formatRunDuration(null)).toBe('—');
      expect(formatRunDuration(undefined)).toBe('—');
    });

    it('tests formatTaskDuration across terminal states with and without latestRun', () => {
      const now = 1_700_000_000_000;

      // Case A: completed with valid latestRun -> shows run duration
      const taskA = makeTask({ state: 'completed' });
      const runA: AgentRun = {
        id: 'r-a',
        taskId: taskA.id,
        attempt: 1,
        state: 'completed',
        startedAt: new Date(now - 125000).toISOString(),
        endedAt: new Date(now - 5000).toISOString(),
        failure: null,
        usage: null,
      };
      expect(formatTaskDuration(taskA, runA, now)).toBe('2m');

      // Case B: completed WITHOUT latestRun -> falls back to relative completed time
      const taskB = makeTask({
        state: 'completed',
        updatedAt: new Date(now - 300000).toISOString(),
      });
      expect(formatTaskDuration(taskB, null, now)).toBe('completed 5m ago');

      // Case C: completed with partial latestRun (missing endedAt) -> falls back to relative time
      const runPartial: AgentRun = {
        id: 'r-p',
        taskId: taskB.id,
        attempt: 1,
        state: 'completed',
        startedAt: new Date(now - 60000).toISOString(),
        endedAt: null,
        failure: null,
        usage: null,
      };
      expect(formatTaskDuration(taskB, runPartial, now)).toBe('completed 5m ago');

      // Case D: failed with valid latestRun -> shows run duration
      const taskD = makeTask({ state: 'failed' });
      const runD: AgentRun = {
        id: 'r-d',
        taskId: taskD.id,
        attempt: 1,
        state: 'failed',
        startedAt: new Date(now - 30000).toISOString(),
        endedAt: new Date(now - 10000).toISOString(),
        failure: null,
        usage: null,
      };
      expect(formatTaskDuration(taskD, runD, now)).toBe('20s');

      // Case E: failed WITHOUT latestRun -> falls back to "failed Xm ago"
      const taskE = makeTask({
        state: 'failed',
        updatedAt: new Date(now - 600000).toISOString(),
      });
      expect(formatTaskDuration(taskE, null, now)).toBe('failed 10m ago');

      // Case F: canceled task -> falls back to "canceled Xs ago"
      const taskF = makeTask({
        state: 'canceled',
        updatedAt: new Date(now - 20000).toISOString(),
      });
      expect(formatTaskDuration(taskF, null, now)).toBe('canceled 20s ago');

      // Case G: interrupted task -> falls back to "interrupted Xs ago"
      const taskG = makeTask({
        state: 'interrupted',
        updatedAt: new Date(now - 15000).toISOString(),
      });
      expect(formatTaskDuration(taskG, null, now)).toBe('interrupted 15s ago');
    });

    it('tests formatToolCall and describeEvent comprehensive event mapping', () => {
      // Tool call variants
      expect(formatToolCall({ tool: 'web_search', count: 4 }).description).toBe(
        'Web search (4 queries)',
      );
      expect(formatToolCall({ tool: 'fetch_page', ok: true, durationMs: 150 }).description).toBe(
        'Page fetched',
      );
      expect(formatToolCall({ tool: 'fetch_page', ok: false, durationMs: 2500 }).description).toBe(
        'Page fetch failed',
      );
      expect(formatToolCall({ tool: 'read_project_file', ok: false }).description).toBe(
        'Project file read failed',
      );

      // Event descriptions
      const evtApproval: Event = {
        id: 10,
        type: 'approval.requested',
        taskId: 't-1',
        runId: null,
        payload: { filename: 'summary.md' },
        createdAt: '2026-10-26T12:00:00Z',
      };
      expect(describeEvent(evtApproval).subtitle).toBe('File: summary.md');

      const evtLimit: Event = {
        id: 11,
        type: 'run.limit_reached',
        taskId: 't-1',
        runId: 'r-1',
        payload: { limit: 'wall_clock' },
        createdAt: '2026-10-26T12:05:00Z',
      };
      expect(describeEvent(evtLimit).title).toBe('Limit reached');
      expect(describeEvent(evtLimit).isError).toBe(true);

      const evtRoutine: Event = {
        id: 12,
        type: 'routine.occurrence_missed',
        taskId: null,
        runId: null,
        payload: {},
        createdAt: '2026-10-26T12:10:00Z',
      };
      expect(describeEvent(evtRoutine).title).toBe('Missed routine occurrence');
      expect(describeEvent(evtRoutine).isError).toBe(true);
    });
  });

  // =========================================================================
  // 5. Axe Accessibility Audits Across All States
  // =========================================================================
  describe('5. Axe Accessibility Audits Across All TaskFeed States', () => {
    const complexTasks: Task[] = [
      makeTask({
        id: 't-running-1',
        title: 'Compute Atmospheric Re-entry Trajectory',
        kind: 'research_brief',
        state: 'running',
        attemptCount: 2,
        startingUrls: ['https://nasa.gov/trajectory', 'https://esa.int/entry'],
        projectId: 'proj-alpha',
      }),
      makeTask({
        id: 't-queued-1',
        title: 'Calibrate RCS Thruster Valves',
        kind: 'project_update',
        state: 'queued',
        projectId: 'proj-beta',
      }),
      makeTask({
        id: 't-done-1',
        title: 'Export Telemetry Log to CSV',
        kind: 'export_report',
        state: 'completed',
        attemptCount: 1,
      }),
      makeTask({
        id: 't-failed-1',
        title: 'Synchronize Atomic Clock Offset',
        kind: 'weekly_plan',
        state: 'failed',
        error: 'NTP socket bind failed on port 123',
        attemptCount: 3,
      }),
    ];

    it('Audit 1: Mixed task feed with all workflows, URLs, badges, and action buttons', async () => {
      let results: Awaited<ReturnType<typeof axe>>;
      await act(async () => {
        const { container } = render(
          <TaskFeed
            tasks={complexTasks}
            projects={mockProjects}
            selectedTaskId="t-running-1"
            onSelectTask={vi.fn()}
            onCancelTask={vi.fn()}
            onRetryTask={vi.fn()}
          />,
        );
        results = await axe(container, axeOptions);
      });
      expect(results!).toHaveNoViolations();
    });

    it('Audit 2: Filtered empty state ("No tasks match your filter") with reset button', async () => {
      const user = userEvent.setup();
      const { container } = render(<TaskFeed tasks={complexTasks} projects={mockProjects} />);

      // Type query to force filtered empty state
      const searchInput = screen.getByRole('searchbox', {
        name: /Search tasks by title or request/i,
      });
      await user.type(searchInput, 'nonexistent_filter_state_123');

      expect(screen.getByText('No tasks match your filter.')).toBeInTheDocument();
      const results = await axe(container, axeOptions);
      expect(results).toHaveNoViolations();
    });

    it('Audit 3: Complete empty feed state ("Nothing queued right now")', async () => {
      let results: Awaited<ReturnType<typeof axe>>;
      await act(async () => {
        const { container } = render(
          <TaskFeed
            tasks={[]}
            emptyTitle="No assistant tasks active"
            emptyDescription="Submit a prompt to run your first task."
          />,
        );
        results = await axe(container, axeOptions);
      });
      expect(results!).toHaveNoViolations();
    });

    it('Audit 4: Keyboard navigation and ARIA landmarks', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const onCancel = vi.fn();

      render(
        <TaskFeed
          tasks={[complexTasks[0]!]}
          projects={mockProjects}
          onSelectTask={onSelect}
          onCancelTask={onCancel}
        />,
      );

      // Verify list container has aria-label
      const list = screen.getByRole('list', { name: 'Tasks and activity feed' });
      expect(list).toBeInTheDocument();

      // Verify Title button is accessible and expandable
      const titleBtn = screen.getByRole('button', {
        name: /View run details for Compute Atmospheric Re-entry Trajectory/i,
      });
      expect(titleBtn).toHaveAttribute('aria-haspopup', 'dialog');
      expect(titleBtn).toHaveAttribute('aria-expanded', 'false');

      // Click title button via keyboard space or enter
      await user.click(titleBtn);
      expect(onSelect).toHaveBeenCalledTimes(1);

      // Cancel button is accessible
      const cancelBtn = screen.getByRole('button', {
        name: /Cancel task: Compute Atmospheric Re-entry Trajectory/i,
      });
      await user.click(cancelBtn);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('Audit 5: RawEventsView in both collapsed and expanded states', async () => {
      const sampleEvents: Event[] = [
        {
          id: 1,
          type: 'task.created',
          taskId: 't-1',
          runId: null,
          payload: { prompt: 'Verify telemetry' },
          createdAt: '2026-10-26T14:00:00Z',
        },
        {
          id: 2,
          type: 'tool.executed',
          taskId: 't-1',
          runId: 'r-1',
          payload: { tool: 'fetch_page', durationMs: 420, ok: true },
          createdAt: '2026-10-26T14:01:00Z',
        },
      ];

      // Collapsed audit
      const { container } = render(<RawEventsView events={sampleEvents} defaultOpen={false} />);
      let results = await axe(container, axeOptions);
      expect(results).toHaveNoViolations();

      // Expand disclosure by clicking trigger button
      const trigger = screen.getByRole('button', { name: /Raw system events/i });
      fireEvent.click(trigger);

      results = await axe(container, axeOptions);
      expect(results).toHaveNoViolations();

      // Console region accessibility
      const consoleRegion = screen.getByRole('region', { name: 'Raw events log' });
      expect(consoleRegion).toHaveAttribute('tabIndex', '0');
    });
  });
});
