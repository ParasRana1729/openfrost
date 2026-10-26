'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Task, TaskKind } from '@openfrost/domain';
import { ApiError, getJson, mutate, type SessionInfo } from '../lib/api';
import { useSession } from '../lib/useSession';
import { useBusyGlow } from './useBusyGlow';
import { useToast } from './ToastProvider';
import { Button } from './ui/Button';
import { StatusBadge } from './ui/StatusBadge';

export interface ExecutorStatus {
  busy: boolean;
  activeTaskId: string | null;
  dispatchPaused: boolean;
}

export interface TasksResponse {
  tasks: Task[];
  executor: ExecutorStatus;
}

export interface StatusBarProps {
  tasks?: Task[];
  executor?: ExecutorStatus;
  session?: SessionInfo | null;
  onCancel?: (taskId: string) => Promise<void>;
  onResumeDispatch?: () => Promise<void>;
  className?: string;
}

const KIND_LABEL: Record<TaskKind, string> = {
  research_brief: 'Research brief',
  project_update: 'Project update',
  export_report: 'Export',
  weekly_plan: 'Weekly plan',
};

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM < 10 ? '0' : ''}${remM}m`;
}

export function StatusBar({
  tasks: controlledTasks,
  executor: controlledExecutor,
  session: controlledSession,
  onCancel,
  onResumeDispatch,
  className = '',
}: StatusBarProps) {
  const hookSession = useSession();
  const session = controlledSession !== undefined ? controlledSession : hookSession.session;
  const { showToast } = useToast();

  const [data, setData] = useState<TasksResponse | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const inFlight = useRef(false);

  const isControlled = controlledTasks !== undefined && controlledExecutor !== undefined;

  const refreshTasks = useCallback(async () => {
    if (isControlled || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await getJson<TasksResponse>('/api/tasks');
      setData(res);
    } catch {
      // Keep previous data on transient errors
    } finally {
      inFlight.current = false;
    }
  }, [isControlled]);

  // Initial fetch and periodic polling
  useEffect(() => {
    if (isControlled || !session?.authenticated) return;
    void refreshTasks();
    const interval = setInterval(() => void refreshTasks(), 5000);
    return () => clearInterval(interval);
  }, [isControlled, session?.authenticated, refreshTasks]);

  // SSE Stream
  useEffect(() => {
    if (isControlled || !session?.authenticated) return;
    const stream = new EventSource('/api/events/stream', { withCredentials: true });
    stream.addEventListener('activity', () => void refreshTasks());
    return () => stream.close();
  }, [isControlled, session?.authenticated, refreshTasks]);

  const tasks = useMemo(
    () => controlledTasks ?? data?.tasks ?? [],
    [controlledTasks, data?.tasks],
  );
  const executor = useMemo(
    () =>
      controlledExecutor ??
      data?.executor ?? {
        busy: false,
        activeTaskId: null,
        dispatchPaused: false,
      },
    [controlledExecutor, data?.executor],
  );

  // Global busy glow
  useBusyGlow(executor.busy);

  // Active task resolution
  const activeTask = useMemo(() => {
    if (!executor.busy) return null;
    return (
      tasks.find((t) => t.id === executor.activeTaskId) ??
      tasks.find((t) => t.state === 'running') ??
      null
    );
  }, [executor.busy, executor.activeTaskId, tasks]);

  // Queued tasks resolution (sorted FIFO)
  const queuedTasks = useMemo(() => {
    return tasks
      .filter((t) => t.state === 'queued' && t.id !== activeTask?.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [tasks, activeTask?.id]);

  // Live timer for elapsed time
  useEffect(() => {
    if (!executor.busy || !activeTask) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [executor.busy, activeTask]);

  const elapsedSeconds = useMemo(() => {
    if (!activeTask) return 0;
    const start = new Date(activeTask.updatedAt || activeTask.createdAt).getTime();
    return Math.max(0, Math.floor((nowMs - start) / 1000));
  }, [activeTask, nowMs]);

  // Handlers
  const handleCancel = async (taskId: string) => {
    if (cancelingId) return;
    setCancelingId(taskId);
    try {
      if (onCancel) {
        await onCancel(taskId);
      } else {
        const csrf = session?.csrfToken;
        if (!csrf) return;
        await mutate({ method: 'POST', path: `/api/tasks/${taskId}/cancel`, csrfToken: csrf });
        showToast('success', 'Task canceled.');
        await refreshTasks();
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Cancel failed';
      showToast('error', msg);
    } finally {
      setCancelingId(null);
    }
  };

  const handleResumeDispatch = async () => {
    if (resuming) return;
    setResuming(true);
    try {
      if (onResumeDispatch) {
        await onResumeDispatch();
      } else {
        const csrf = session?.csrfToken;
        if (!csrf) return;
        await mutate({ method: 'POST', path: '/api/dispatch/resume', csrfToken: csrf });
        showToast('success', 'Task dispatch resumed.');
        await refreshTasks();
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Resume failed';
      showToast('error', msg);
    } finally {
      setResuming(false);
    }
  };

  if (!session?.authenticated) {
    return null;
  }

  return (
    <div
      className={`status-bar-container ${className}`}
      role="region"
      aria-label="Executor status and queue"
    >
      {executor.dispatchPaused && (
        <div className="status-bar-alert" role="alert">
          <div className="status-bar-alert-content">
            <span className="dot dot-warn" aria-hidden="true" />
            <span className="status-bar-alert-title">Dispatch paused after recovery</span>
            <span className="status-bar-alert-desc">
              Unfinished runs from a previous session require review.
            </span>
          </div>
          <Button
            variant="primary"
            size="sm"
            loading={resuming}
            onClick={() => void handleResumeDispatch()}
          >
            Resume dispatch
          </Button>
        </div>
      )}

      <div className="status-bar" role="status" aria-live="polite">
        {/* Active Run Section */}
        <div className="status-bar-segment status-bar-active">
          <span className="status-bar-segment-label">Run</span>
          {executor.busy && activeTask ? (
            <div className="status-bar-task-active">
              <StatusBadge state="running" pulse size="sm" />
              <span className="status-bar-kind-tag">[{KIND_LABEL[activeTask.kind]}]</span>
              <span className="status-bar-task-title" title={activeTask.title}>
                {activeTask.title}
              </span>
              <span
                className="status-bar-elapsed"
                aria-label={`Elapsed time: ${formatElapsed(elapsedSeconds)}`}
              >
                {formatElapsed(elapsedSeconds)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="status-bar-btn-cancel"
                loading={cancelingId === activeTask.id}
                aria-label={`Cancel active task ${activeTask.title}`}
                onClick={() => void handleCancel(activeTask.id)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="status-bar-idle">
              <span className="dot dot-idle" aria-hidden="true" />
              <span>idle</span>
            </div>
          )}
        </div>

        <div className="status-bar-sep" aria-hidden="true" />

        {/* Queued Section */}
        <div className="status-bar-segment status-bar-queue">
          <span className="status-bar-segment-label">Queue</span>
          {queuedTasks.length > 0 ? (
            <div className="status-bar-queue-list">
              <span className="status-bar-queue-count">
                {queuedTasks.length} {queuedTasks.length === 1 ? 'task' : 'tasks'} waiting
              </span>
              {queuedTasks.slice(0, 2).map((task, idx) => (
                <div key={task.id} className="status-bar-queue-item">
                  <span className="queue-pos-badge" aria-label={`Queue position ${idx + 1}`}>
                    #{idx + 1}
                  </span>
                  <span className="queue-item-title" title={task.title}>
                    {task.title}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="status-bar-btn-cancel"
                    loading={cancelingId === task.id}
                    aria-label={`Cancel queued task #${idx + 1} ${task.title}`}
                    onClick={() => void handleCancel(task.id)}
                  >
                    Cancel
                  </Button>
                </div>
              ))}
              {queuedTasks.length > 2 && (
                <span className="queue-more-count">+{queuedTasks.length - 2} more</span>
              )}
            </div>
          ) : (
            <span>0 waiting</span>
          )}
        </div>

        <div className="status-bar-sep" aria-hidden="true" />

        {/* Dispatch Section */}
        <div className="status-bar-segment status-bar-dispatch">
          <span className="status-bar-segment-label">Dispatch</span>
          {executor.dispatchPaused ? (
            <span className="strip-paused">paused — review required</span>
          ) : (
            <span className="strip-ok">open</span>
          )}
        </div>
      </div>
    </div>
  );
}
