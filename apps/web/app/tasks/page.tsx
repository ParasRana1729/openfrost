'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentRun, Event, Task } from '@openfrost/domain';
import { ApiError, getJson, mutate } from '../../lib/api';
import { formatTimestamp } from '../../lib/format';
import { useSession } from '../../lib/useSession';

interface ExecutorStatus {
  busy: boolean;
  activeTaskId: string | null;
  dispatchPaused: boolean;
}

interface TasksResponse {
  tasks: Task[];
  executor: ExecutorStatus;
}

interface TaskDetail {
  task: Task;
  runs: AgentRun[];
  events: Event[];
  artifact: { id: string; markdown: string } | null;
}

const REQUEUEABLE: ReadonlySet<string> = new Set(['failed', 'canceled', 'interrupted']);

export default function TasksPage() {
  const { session, loading, refresh } = useSession();
  const [data, setData] = useState<TasksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [request, setRequest] = useState('');
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const inFlight = useRef(false);

  const refreshTasks = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    try {
      setData(await getJson<TasksResponse>('/api/tasks'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'API unreachable');
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (session?.authenticated) {
      void refreshTasks();
    }
  }, [session?.authenticated, refreshTasks]);

  // Live updates: authenticated SSE stream with a polling safety net.
  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }
    const stream = new EventSource('/api/events/stream', {
      withCredentials: true,
    });
    stream.addEventListener('activity', () => void refreshTasks());
    const poll = setInterval(() => void refreshTasks(), 4000);
    return () => {
      stream.close();
      clearInterval(poll);
    };
  }, [session?.authenticated, refreshTasks]);

  const csrf = session?.csrfToken ?? null;

  const submitTask = async () => {
    if (!csrf || title.trim().length === 0 || request.trim().length === 0) {
      return;
    }
    try {
      await mutate({
        method: 'POST',
        path: '/api/tasks',
        body: { title: title.trim(), request: request.trim() },
        csrfToken: csrf,
      });
      setTitle('');
      setRequest('');
      await refreshTasks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create task');
    }
  };

  const cancelTask = async (taskId: string) => {
    if (!csrf) {
      return;
    }
    try {
      await mutate({ method: 'POST', path: `/api/tasks/${taskId}/cancel`, csrfToken: csrf });
      await refreshTasks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cancel failed');
    }
  };

  const retryTask = async (taskId: string) => {
    if (!csrf) {
      return;
    }
    try {
      await mutate({ method: 'POST', path: `/api/tasks/${taskId}/retry`, csrfToken: csrf });
      await refreshTasks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Retry failed');
    }
  };

  const resumeDispatch = async () => {
    if (!csrf) {
      return;
    }
    try {
      await mutate({ method: 'POST', path: '/api/dispatch/resume', csrfToken: csrf });
      await Promise.all([refreshTasks(), refresh()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Resume failed');
    }
  };

  const openDetail = async (taskId: string) => {
    try {
      setDetail(await getJson<TaskDetail>(`/api/tasks/${taskId}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load task');
    }
  };

  if (loading || !session || !session.ownerCreated || !session.authenticated) {
    return (
      <div className="panel">
        <h1>Tasks</h1>
        <p className="muted">{error ?? 'Checking local session…'}</p>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <h1>New task</h1>
        <label htmlFor="title">Title</label>
        <input
          id="title"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Compare note-taking apps for research"
        />
        <label htmlFor="request">Request</label>
        <textarea
          id="request"
          value={request}
          maxLength={20000}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="What should the assistant work on?"
        />
        <p className="muted">
          One run executes at a time; everything else queues here. Requests are
          bounded by the execution limits shown in Settings.
        </p>
        <div className="row">
          <button
            className="primary"
            disabled={!csrf || title.trim().length === 0 || request.trim().length === 0}
            onClick={() => void submitTask()}
          >
            Add to queue
          </button>
          {data?.executor.busy ? (
            <span className="muted">A run is active; new tasks will wait.</span>
          ) : null}
        </div>
      </div>

      {data?.executor.dispatchPaused ? (
        <div className="panel">
          <h2>Dispatch paused</h2>
          <p className="muted">
            Interrupted runs from a previous session need review before work
            continues. Nothing is retried automatically.
          </p>
          <button className="primary" onClick={() => void resumeDispatch()}>
            Resume dispatch
          </button>
        </div>
      ) : null}

      <div className="panel">
        <h2>Queue &amp; history</h2>
        {error ? <p className="error">{error}</p> : null}
        {(data?.tasks ?? []).length === 0 ? (
          <p className="muted">No tasks yet.</p>
        ) : (
          (data?.tasks ?? []).map((task) => (
            <div className="task" key={task.id}>
              <div className="head">
                <strong>{task.title}</strong>
                <span className={`chip ${task.state}`}>{task.state.replace('_', ' ')}</span>
              </div>
              <p className="muted">
                attempts: {task.attemptCount}
                {task.error ? ` · last error: ${task.error}` : ''}
              </p>
              <div className="actions">
                <button onClick={() => void openDetail(task.id)}>Details</button>
                {task.state === 'queued' || task.state === 'running' ? (
                  <button onClick={() => void cancelTask(task.id)}>Cancel</button>
                ) : null}
                {REQUEUEABLE.has(task.state) ? (
                  <button onClick={() => void retryTask(task.id)}>Retry</button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      {detail ? (
        <div className="panel">
          <h2>
            {detail.task.title}{' '}
            <span className={`chip ${detail.task.state}`}>
              {detail.task.state.replace('_', ' ')}
            </span>
          </h2>
          <p className="muted">{detail.task.request}</p>
          {detail.artifact ? (
            <>
              <h2>Saved report</h2>
              <pre>{detail.artifact.markdown}</pre>
            </>
          ) : null}
          <h2>Run attempts</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>State</th>
                <th>Usage</th>
                <th>Failure</th>
              </tr>
            </thead>
            <tbody>
              {detail.runs.map((run) => (
                <tr key={run.id}>
                  <td>{run.attempt}</td>
                  <td>{run.state}</td>
                  <td>
                    {run.usage
                      ? `${run.usage.steps} steps · ${run.usage.outputChars} chars out`
                      : '—'}
                  </td>
                  <td>
                    {run.failure
                      ? `${run.failure.code}${run.failure.limitHit ? ` (${run.failure.limitHit})` : ''}: ${run.failure.message}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>Activity</h2>
          {detail.events.map((event) => (
            <div className="event" key={event.id}>
              <code>{event.type}</code> {formatTimestamp(event.createdAt)}
            </div>
          ))}
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={() => setDetail(null)}>Close details</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
