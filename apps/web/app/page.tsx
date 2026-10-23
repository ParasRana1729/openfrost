'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Event, Task } from '@openfrost/domain';
import { ApiError, getJson, mutate } from '../lib/api';
import { useSession } from '../lib/useSession';

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

  const counts = (tasks?.tasks ?? []).reduce<Record<string, number>>((acc, task) => {
    acc[task.state] = (acc[task.state] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
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
          Model-backed execution arrives with the S02 research slice. Until a
          provider is wired, submitted tasks fail with a clear &ldquo;no provider
          configured&rdquo; message — the queue, limits, cancellation, and recovery
          machinery is live.
        </p>
        <div className="row">
          <Link href="/tasks">
            <button className="primary">Go to tasks</button>
          </Link>
          <span className="muted">
            {counts['queued'] ?? 0} queued · {counts['running'] ?? 0} running ·{' '}
            {counts['completed'] ?? 0} completed
          </span>
        </div>
      </div>

      <div className="panel">
        <h2>Recent activity</h2>
        {actionError ? <p className="error">{actionError}</p> : null}
        {events.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          events.map((event) => (
            <div className="event" key={event.id}>
              <code>{event.type}</code> {event.createdAt}
              {event.taskId ? ` · task ${event.taskId.slice(0, 8)}…` : ''}
            </div>
          ))
        )}
      </div>
    </>
  );
}
