'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  Event,
  Project,
  ProjectFolderGrant,
  Routine,
  Task,
} from '@openfrost/domain';
import { ApiError, getJson } from '../lib/api';
import { formatTimestamp } from '../lib/format';
import { useSession } from '../lib/useSession';
import { useBusyGlow } from '../components/useBusyGlow';
import { TaskComposer } from '../components/TaskComposer';

interface ProjectOption extends Project {
  grants: ProjectFolderGrant[];
}

interface RoutineSummary {
  routine: Routine;
  missedCount: number;
}

interface TasksResponse {
  tasks: Task[];
  executor: { busy: boolean; activeTaskId: string | null; dispatchPaused: boolean };
}

interface ApprovalSummary {
  id: string;
  taskId: string;
  filename: string;
  destinationPath: string;
  state: string;
  requestedAt: string;
  expiresAt: string;
}

export default function HomePage() {
  const { session, loading, error } = useSession();
  const [tasks, setTasks] = useState<TasksResponse | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalSummary[]>([]);
  const [missedRoutines, setMissedRoutines] = useState<RoutineSummary[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const inFlight = useRef(false);
  useBusyGlow(tasks?.executor.busy ?? false);

  const refreshAll = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    try {
      const [tasksResponse, eventsResponse, approvalsResponse, routinesResponse] =
        await Promise.all([
          getJson<TasksResponse>('/api/tasks'),
          getJson<{ events: Event[] }>('/api/events?limit=15'),
          getJson<{ approvals: ApprovalSummary[] }>('/api/approvals?state=pending'),
          getJson<{ routines: RoutineSummary[] }>('/api/routines').catch(() => ({
            routines: [] as RoutineSummary[],
          })),
        ]);
      setTasks(tasksResponse);
      setEvents(eventsResponse.events);
      setPendingApprovals(approvalsResponse.approvals);
      setMissedRoutines(
        routinesResponse.routines.filter((entry) => entry.missedCount > 0),
      );
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'API unreachable');
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (session?.authenticated) {
      void refreshAll();
      void getJson<{ projects: ProjectOption[] }>('/api/projects')
        .then((data) => setProjects(data.projects))
        .catch(() => setProjects([]));
    }
  }, [session?.authenticated, refreshAll]);

  // Live updates: authenticated SSE stream with a polling safety net.
  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }
    const stream = new EventSource('/api/events/stream', { withCredentials: true });
    stream.addEventListener('activity', () => void refreshAll());
    const poll = setInterval(() => void refreshAll(), 5000);
    return () => {
      stream.close();
      clearInterval(poll);
    };
  }, [session?.authenticated, refreshAll]);

  if (loading || !session || !session.ownerCreated || !session.authenticated) {
    return (
      <div className="panel">
        <h1>Assistant</h1>
        <p className="muted">{error ?? 'Checking local session…'}</p>
      </div>
    );
  }

  return (
    <>
      {pendingApprovals.length > 0 ? (
        <div className="panel">
          <h1>Approval needed</h1>
          {pendingApprovals.map((approval) => (
            <p key={approval.id} className="muted">
              Export <strong>{approval.filename}</strong> into{' '}
              <span className="mono">{approval.destinationPath}</span> — requested{' '}
              {formatTimestamp(approval.requestedAt)}. The run is holding until you
              decide.
            </p>
          ))}
          <div className="row">
            <Link href="/tasks">
              <button className="primary">Review under Tasks</button>
            </Link>
          </div>
        </div>
      ) : null}

      {missedRoutines.length > 0 ? (
        <div className="panel">
          <h1>Missed routine occurrences</h1>
          {missedRoutines.map((entry) => (
            <p key={entry.routine.id} className="muted">
              <strong>{entry.routine.name}</strong> missed{' '}
              {entry.missedCount === 1 ? 'a scheduled run' : `${entry.missedCount} scheduled runs`}
              {' '}while the runtime was unavailable. Run it once now or skip it —
              nothing replays automatically.
            </p>
          ))}
          <div className="row">
            <Link href="/routines">
              <button className="primary">Review under Routines</button>
            </Link>
          </div>
        </div>
      ) : null}

      <h1 className="hero-title">What should OpenFrost work on?</h1>
      <p className="hero-sub">
        One local assistant, one machine. It researches the public web or reads a
        project&rsquo;s granted notes, runs one task at a time, and saves what it
        made — with its sources.
      </p>

      <TaskComposer
        projects={projects}
        inline={true}
        executorBusy={tasks?.executor.busy ?? false}
        onSuccess={() => void refreshAll()}
      />

      <div className="panel">
        <h2>Recent activity</h2>
        {actionError ? <p className="error">{actionError}</p> : null}
        <div className="console" role="region" aria-label="Recent activity" tabIndex={0}>
          {events.length === 0 ? (
            <div className="console-empty">
              Quiet. Queue a task above and the runtime will report here.
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
        {(tasks?.tasks ?? []).some((task) => task.state === 'queued' || task.state === 'running') ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            Work is in flight — see it under <Link href="/tasks">Tasks</Link>.
          </p>
        ) : null}
      </div>
    </>
  );
}
