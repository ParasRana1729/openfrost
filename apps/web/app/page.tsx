'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Event, Task } from '@openfrost/domain';
import { ApiError, getJson, mutate } from '../lib/api';
import { formatTimestamp } from '../lib/format';
import { useSession } from '../lib/useSession';
import { DispatchStrip } from '../components/DispatchStrip';

interface TasksResponse {
  tasks: Task[];
  executor: { busy: boolean; activeTaskId: string | null; dispatchPaused: boolean };
}

export default function HomePage() {
  const { session, loading, error, refresh } = useSession();
  const [tasks, setTasks] = useState<TasksResponse | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      const [tasksResponse, eventsResponse] = await Promise.all([
        getJson<TasksResponse>('/api/tasks'),
        getJson<{ events: Event[] }>('/api/events?limit=15'),
      ]);
      setTasks(tasksResponse);
      setEvents(eventsResponse.events);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'API unreachable');
    }
  }, []);

  useEffect(() => {
    if (session?.authenticated) {
      void refreshAll();
    }
  }, [session?.authenticated, refreshAll]);

  const resumeDispatch = async () => {
    if (!session?.csrfToken) {
      return;
    }
    try {
      await mutate({ method: 'POST', path: '/api/dispatch/resume', csrfToken: session.csrfToken });
      await Promise.all([refreshAll(), refresh()]);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Resume failed');
    }
  };

  if (loading || !session || !session.ownerCreated || !session.authenticated) {
    return (
      <div className="panel">
        <h1>OpenFrost</h1>
        <p className="muted">{error ?? 'Checking local session…'}</p>
      </div>
    );
  }

  const queuedCount = (tasks?.tasks ?? []).filter((task) => task.state === 'queued').length;

  return (
    <>
      <DispatchStrip
        busy={tasks?.executor.busy ?? false}
        activeTaskId={tasks?.executor.activeTaskId ?? null}
        dispatchPaused={tasks?.executor.dispatchPaused ?? false}
        queuedCount={queuedCount}
      />

      {tasks?.executor.dispatchPaused ? (
        <div className="panel">
          <h2>Dispatch paused after recovery</h2>
          <p className="muted">
            Unfinished runs from a previous session were marked interrupted. Review
            them under Tasks, then resume dispatch when ready.
          </p>
          <button className="primary" onClick={() => void resumeDispatch()}>
            Resume dispatch
          </button>
        </div>
      ) : null}

      <div className="panel">
        <h1>Assistant</h1>
        <p>
          One local assistant; requests become tasks processed one at a time in the
          background. Closing this browser does not stop them.
        </p>
        <p className="note">
          Research briefs are the first supported workflow: a run performs
          public web search plus page retrieval and saves a Markdown report —
          one run at a time. The model provider (OpenAI, Gemini, or OpenRouter)
          is chosen in
          Settings; without a key configured there, tasks fail with a clear
          message instead of running.
        </p>
        <div className="row">
          <Link href="/tasks">
            <button className="primary">Go to tasks</button>
          </Link>
        </div>
      </div>

      <div className="panel">
        <h2>Runtime activity</h2>
        {actionError ? <p className="error">{actionError}</p> : null}
        <div className="console">
          {events.length === 0 ? (
            <div className="console-empty">
              No activity yet. Submit a task and the runtime will report here.
            </div>
          ) : (
            events.map((event) => (
              <div className="console-row" key={event.id}>
                <span className="console-type">{event.type}</span>
                {event.taskId ? (
                  <span className="console-ref">{event.taskId.slice(0, 8)}…</span>
                ) : null}
                <span className="console-time">{formatTimestamp(event.createdAt)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
