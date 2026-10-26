'use client';

import { useEffect, useState } from 'react';
import type { AgentRun, Event, Task } from '@openfrost/domain';

/** Owner-facing timestamp: local time, or the raw value if unparseable. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * Formats duration in milliseconds into a concise, human-readable string.
 * Examples: 0s, 42s, 2m 15s, 1h 4m, 1d 2h.
 * Edge cases: clamps negative numbers and clock skew to '0s'; null/NaN to '—'.
 */
export function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || Number.isNaN(durationMs)) {
    return '—';
  }
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  if (totalSeconds < 3600) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  if (totalSeconds < 86400) {
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

/**
 * Formats subsecond or second tool duration cleanly:
 * < 1000ms -> '342ms'
 * >= 1000ms -> '1.2s'
 */
export function formatToolDuration(durationMs: number | null | undefined): string | null {
  if (durationMs === null || durationMs === undefined || Number.isNaN(durationMs)) {
    return null;
  }
  const ms = Math.max(0, Math.round(durationMs));
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Formats relative time elapsed since an ISO timestamp.
 * Examples: 'just now', '45s ago', '3m ago', '2h ago', '1d ago'.
 * Edge case: future timestamps (clock skew) clamp to 'just now'.
 */
export function formatTimeAgo(iso: string | null | undefined, now?: number): string {
  if (!iso) {
    return '—';
  }
  const time = Date.parse(iso);
  if (Number.isNaN(time)) {
    return '—';
  }
  const currentNow = now ?? Date.now();
  const diffMs = currentNow - time;

  if (diffMs < 10_000) {
    return 'just now';
  }
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) {
    return `${secs}s ago`;
  }
  const mins = Math.floor(secs / 60);
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(time).toLocaleDateString();
}

/**
 * Calculates and formats run duration based on AgentRun.
 * If running: 'running for 18s'
 * If finished: '42s' or '2m 15s'
 */
export function formatRunDuration(
  run: AgentRun | null | undefined,
  now?: number,
): string {
  if (!run || !run.startedAt) {
    return '—';
  }
  const startMs = Date.parse(run.startedAt);
  if (Number.isNaN(startMs)) {
    return '—';
  }

  if (run.state === 'running') {
    const currentNow = now ?? Date.now();
    const elapsedMs = Math.max(0, currentNow - startMs);
    return `running for ${formatDuration(elapsedMs)}`;
  }

  if (run.endedAt) {
    const endMs = Date.parse(run.endedAt);
    if (!Number.isNaN(endMs)) {
      return formatDuration(Math.max(0, endMs - startMs));
    }
  }

  return '—';
}

/**
 * Calculates formatted duration for a Task row in TaskFeed.
 * Handles queued, running, and completed states intelligently.
 */
export function formatTaskDuration(
  task: Task,
  latestRun?: AgentRun | null,
  now?: number,
): string {
  if (task.state === 'queued') {
    return `queued ${formatTimeAgo(task.createdAt, now)}`;
  }

  if (task.state === 'running') {
    if (latestRun?.startedAt) {
      const startMs = Date.parse(latestRun.startedAt);
      if (!Number.isNaN(startMs)) {
        return `running for ${formatDuration(Math.max(0, (now ?? Date.now()) - startMs))}`;
      }
    }
    const fallbackStart = Date.parse(task.updatedAt);
    if (!Number.isNaN(fallbackStart)) {
      return `running for ${formatDuration(Math.max(0, (now ?? Date.now()) - fallbackStart))}`;
    }
    return 'running';
  }

  // Terminal states (completed, failed, canceled, interrupted)
  if (latestRun?.startedAt && latestRun?.endedAt) {
    const startMs = Date.parse(latestRun.startedAt);
    const endMs = Date.parse(latestRun.endedAt);
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
      return formatDuration(Math.max(0, endMs - startMs));
    }
  }

  if (task.state === 'completed') {
    return `completed ${formatTimeAgo(task.updatedAt, now)}`;
  }

  // Fallback to relative completion time if run details are not available
  return `${task.state.replace('_', ' ')} ${formatTimeAgo(task.updatedAt, now)}`;
}

export interface FormattedToolCall {
  name: string;
  description: string;
  duration: string | null;
  ok: boolean;
  step?: number;
}

/**
 * Parses and formats a tool.executed payload into a clean, human-readable structure.
 */
export function formatToolCall(payload: Record<string, unknown>): FormattedToolCall {
  const tool = typeof payload.tool === 'string' ? payload.tool : 'tool';
  const durationMs = typeof payload.durationMs === 'number' ? payload.durationMs : null;
  const ok = payload.ok !== false;
  const step = typeof payload.step === 'number' ? payload.step : undefined;
  const formattedDuration = formatToolDuration(durationMs);

  switch (tool) {
    case 'web_search': {
      const count = typeof payload.count === 'number' ? payload.count : 1;
      return {
        name: 'Web search',
        description: count > 1 ? `Web search (${count} queries)` : 'Web search executed',
        duration: null,
        ok,
        step,
      };
    }
    case 'fetch_page': {
      return {
        name: 'Page fetch',
        description: ok ? 'Page fetched' : 'Page fetch failed',
        duration: formattedDuration,
        ok,
        step,
      };
    }
    case 'read_project_file': {
      return {
        name: 'Project read',
        description: ok ? 'Project file read' : 'Project file read failed',
        duration: formattedDuration,
        ok,
        step,
      };
    }
    case 'propose_memory': {
      return {
        name: 'Memory proposal',
        description: 'Memory note proposed',
        duration: formattedDuration,
        ok,
        step,
      };
    }
    default: {
      const cleanName = tool
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        name: cleanName,
        description: `${cleanName} executed`,
        duration: formattedDuration,
        ok,
        step,
      };
    }
  }
}

export interface EventDescription {
  title: string;
  subtitle?: string;
  category:
    | 'task'
    | 'run'
    | 'tool'
    | 'approval'
    | 'export'
    | 'memory'
    | 'routine'
    | 'dispatch'
    | 'auth'
    | 'settings'
    | 'project'
    | 'system';
  isError: boolean;
  duration?: string;
  step?: number;
  timestamp: string;
}

/**
 * Maps raw domain events to clear, non-technical descriptions.
 */
export function describeEvent(event: Event): EventDescription {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const timestamp = formatTimestamp(event.createdAt);

  switch (event.type) {
    case 'task.created':
      return { title: 'Task queued', subtitle: 'Task created by owner', category: 'task', isError: false, timestamp };
    case 'task.requeued':
      return { title: 'Task requeued', subtitle: 'Queued for retry', category: 'task', isError: false, timestamp };
    case 'task.completed': {
      const steps = typeof payload.steps === 'number' ? `${payload.steps} steps` : undefined;
      return {
        title: 'Task completed',
        subtitle: payload.artifactId ? `Artifact saved${steps ? ` (${steps})` : ''}` : steps,
        category: 'task',
        isError: false,
        timestamp,
      };
    }
    case 'task.failed':
      return {
        title: 'Task failed',
        subtitle: typeof payload.error === 'string' ? payload.error : undefined,
        category: 'task',
        isError: true,
        timestamp,
      };
    case 'task.canceled':
      return { title: 'Task canceled', subtitle: 'Canceled by owner', category: 'task', isError: false, timestamp };
    case 'task.interrupted':
      return { title: 'Task interrupted', subtitle: 'Execution interrupted', category: 'task', isError: true, timestamp };

    case 'run.started': {
      const attempt = payload.attempt ? `Attempt #${payload.attempt}` : undefined;
      return { title: 'Run started', subtitle: attempt, category: 'run', isError: false, timestamp };
    }
    case 'run.completed': {
      const steps = typeof payload.steps === 'number' ? `Completed in ${payload.steps} steps` : undefined;
      return { title: 'Run completed', subtitle: steps, category: 'run', isError: false, timestamp };
    }
    case 'run.failed': {
      const failure = payload.failure as { message?: string } | undefined;
      return {
        title: 'Run failed',
        subtitle: failure?.message ?? 'Execution error occurred',
        category: 'run',
        isError: true,
        timestamp,
      };
    }
    case 'run.canceled':
      return { title: 'Run canceled', category: 'run', isError: false, timestamp };
    case 'run.interrupted':
      return { title: 'Run interrupted', category: 'run', isError: true, timestamp };
    case 'run.limit_reached': {
      const limit = typeof payload.limit === 'string' ? payload.limit : 'Execution';
      return {
        title: 'Limit reached',
        subtitle: `Run stopped after hitting ${limit} limit`,
        category: 'run',
        isError: true,
        timestamp,
      };
    }

    case 'tool.executed': {
      const toolCall = formatToolCall(payload);
      return {
        title: toolCall.description,
        subtitle: toolCall.duration ? `Duration: ${toolCall.duration}` : undefined,
        category: 'tool',
        isError: !toolCall.ok,
        duration: toolCall.duration ?? undefined,
        step: toolCall.step,
        timestamp,
      };
    }

    case 'approval.requested':
      return {
        title: 'Export approval requested',
        subtitle: typeof payload.filename === 'string' ? `File: ${payload.filename}` : undefined,
        category: 'approval',
        isError: false,
        timestamp,
      };
    case 'approval.granted':
      return { title: 'Export approved', category: 'approval', isError: false, timestamp };
    case 'approval.rejected':
      return { title: 'Export rejected', category: 'approval', isError: false, timestamp };
    case 'approval.canceled':
      return { title: 'Export canceled', category: 'approval', isError: false, timestamp };
    case 'approval.expired':
      return { title: 'Export approval expired', category: 'approval', isError: true, timestamp };
    case 'export.written':
      return {
        title: 'Export file written',
        subtitle: typeof payload.file === 'string' ? payload.file : undefined,
        category: 'export',
        isError: false,
        timestamp,
      };

    case 'dispatch.paused':
      return { title: 'Dispatch paused', subtitle: 'Pending operator review', category: 'dispatch', isError: false, timestamp };
    case 'dispatch.resumed':
      return { title: 'Dispatch resumed', category: 'dispatch', isError: false, timestamp };

    case 'memory.proposed':
      return { title: 'Memory note proposed', category: 'memory', isError: false, timestamp };
    case 'memory.approved':
      return { title: 'Memory note approved', category: 'memory', isError: false, timestamp };
    case 'memory.rejected':
      return { title: 'Memory note rejected', category: 'memory', isError: false, timestamp };
    case 'memory.updated':
      return { title: 'Memory note updated', category: 'memory', isError: false, timestamp };
    case 'memory.deleted':
      return { title: 'Memory note deleted', category: 'memory', isError: false, timestamp };
    case 'memory.used':
      return { title: 'Memory notes loaded into context', category: 'memory', isError: false, timestamp };

    case 'routine.occurrence_scheduled':
      return { title: 'Routine scheduled', category: 'routine', isError: false, timestamp };
    case 'routine.occurrence_missed':
      return { title: 'Missed routine occurrence', category: 'routine', isError: true, timestamp };
    case 'routine.occurrence_run_now':
      return { title: 'Routine run manually', category: 'routine', isError: false, timestamp };
    case 'routine.occurrence_skipped':
      return { title: 'Routine skipped', category: 'routine', isError: false, timestamp };

    default: {
      const cleanTitle = event.type
        .replace(/\./g, ' — ')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        title: cleanTitle,
        category: 'system',
        isError: event.type.includes('fail') || event.type.includes('error'),
        timestamp,
      };
    }
  }
}

/**
 * Returns a live-ticking elapsed time string (e.g. '18s', '2m 15s')
 * for an active task or run.
 * Interval ticks every 1,000ms and cleans up on unmount or when active becomes false.
 */
export function useElapsedTimer(
  startedAt: string | null | undefined,
  active: boolean = true,
): string {
  const [elapsed, setElapsed] = useState<string>(() => {
    if (!active || !startedAt) return '0s';
    const startMs = Date.parse(startedAt);
    if (Number.isNaN(startMs)) return '—';
    return formatDuration(Math.max(0, Date.now() - startMs));
  });

  useEffect(() => {
    if (!active || !startedAt) {
      return;
    }
    const startMs = Date.parse(startedAt);
    if (Number.isNaN(startMs)) {
      return;
    }

    const update = () => {
      setElapsed(formatDuration(Math.max(0, Date.now() - startMs)));
    };

    update();
    const timerId = setInterval(update, 1000);
    return () => clearInterval(timerId);
  }, [startedAt, active]);

  return elapsed;
}
