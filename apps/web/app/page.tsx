'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Event, Project, ProjectFolderGrant, Task, TaskKind } from '@openfrost/domain';
import { ApiError, getJson, mutate } from '../lib/api';
import { formatTimestamp } from '../lib/format';
import { useSession } from '../lib/useSession';
import { useBusyGlow } from '../components/useBusyGlow';

interface ProjectOption extends Project {
  grants: ProjectFolderGrant[];
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

const MAX_STARTING_URLS = 5;
/** The API requires a title; the composer derives one from the request. */
function deriveTitle(request: string): string {
  const firstLine = request.trim().split(/\r?\n/)[0] ?? '';
  const trimmed = firstLine.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

export default function HomePage() {
  const { session, loading, error, refresh } = useSession();
  const [tasks, setTasks] = useState<TasksResponse | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalSummary[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const [request, setRequest] = useState('');
  const [kind, setKind] = useState<TaskKind>('research_brief');
  const [projectId, setProjectId] = useState('');
  const [constraints, setConstraints] = useState('');
  const [startingUrlsText, setStartingUrlsText] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const inFlight = useRef(false);
  useBusyGlow(tasks?.executor.busy ?? false);

  const refreshAll = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    try {
      const [tasksResponse, eventsResponse, approvalsResponse] = await Promise.all([
        getJson<TasksResponse>('/api/tasks'),
        getJson<{ events: Event[] }>('/api/events?limit=15'),
        getJson<{ approvals: ApprovalSummary[] }>('/api/approvals?state=pending'),
      ]);
      setTasks(tasksResponse);
      setEvents(eventsResponse.events);
      setPendingApprovals(approvalsResponse.approvals);
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

  const csrf = session?.csrfToken ?? null;

  const parsedUrls = startingUrlsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const urlsValid =
    kind !== 'research_brief' ||
    (parsedUrls.every((url) => /^https?:\/\//i.test(url)) &&
      parsedUrls.length <= MAX_STARTING_URLS);
  const projectUpdateInvalid = kind === 'project_update' && projectId === '';
  const canSubmit =
    !!csrf && request.trim().length > 0 && !projectUpdateInvalid && urlsValid;

  const submitTask = async () => {
    if (!canSubmit) {
      return;
    }
    const body: {
      title: string;
      request: string;
      constraints?: string;
      startingUrls?: string[];
      projectId?: string;
      kind: TaskKind;
    } = { title: deriveTitle(request), request: request.trim(), kind };
    if (constraints.trim().length > 0) {
      body.constraints = constraints.trim();
    }
    if (kind === 'research_brief' && parsedUrls.length > 0) {
      body.startingUrls = parsedUrls;
    }
    if (projectId !== '') {
      body.projectId = projectId;
    }
    try {
      await mutate({ method: 'POST', path: '/api/tasks', body, csrfToken: csrf });
      setRequest('');
      setConstraints('');
      setStartingUrlsText('');
      setShowDetails(false);
      await refreshAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not create task');
    }
  };

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

      {tasks?.executor.dispatchPaused ? (
        <div className="panel">
          <h1>Dispatch paused after recovery</h1>
          <p className="muted">
            Unfinished runs from a previous session were marked interrupted. Review
            them under Tasks, then resume dispatch when ready.
          </p>
          <button className="primary" onClick={() => void resumeDispatch()}>
            Resume dispatch
          </button>
        </div>
      ) : null}

      <h1 className="hero-title">What should OpenFrost work on?</h1>
      <p className="hero-sub">
        One local assistant, one machine. It researches the public web or reads a
        project&rsquo;s granted notes, runs one task at a time, and saves what it
        made — with its sources.
      </p>

      <div className="composer">
        <label htmlFor="composer-request">Task</label>
        <textarea
          id="composer-request"
          value={request}
          maxLength={20000}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="Describe the task — a question to research, or notes to turn into a project update. It runs in the background."
        />
        <div className="composer-bar">
          <button
            type="button"
            className="chip-toggle"
            aria-pressed={kind === 'research_brief'}
            onClick={() => setKind('research_brief')}
          >
            Research brief
          </button>
          <button
            type="button"
            className="chip-toggle"
            aria-pressed={kind === 'project_update'}
            onClick={() => setKind('project_update')}
          >
            Project update
          </button>
          {kind === 'project_update' ? (
            <select
              aria-label="Project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Choose project…</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            className="chip-toggle"
            aria-pressed={showDetails}
            onClick={() => setShowDetails((value) => !value)}
          >
            Details
          </button>
          <button
            className="primary"
            disabled={!canSubmit}
            onClick={() => void submitTask()}
          >
            Queue task
          </button>
        </div>
        {showDetails ? (
          <div style={{ paddingTop: 4 }}>
            <label htmlFor="composer-constraints">Constraints (optional)</label>
            <textarea
              id="composer-constraints"
              value={constraints}
              maxLength={2000}
              onChange={(e) => setConstraints(e.target.value)}
              placeholder="Prefer local-first tools; budget under $20/month"
              style={{ minHeight: 64 }}
            />
            {kind === 'research_brief' ? (
              <>
                <label htmlFor="composer-urls">
                  Starting URLs (optional, one per line, max {MAX_STARTING_URLS})
                </label>
                <textarea
                  id="composer-urls"
                  value={startingUrlsText}
                  onChange={(e) => setStartingUrlsText(e.target.value)}
                  placeholder={'https://example.com/overview\nhttps://example.com/pricing'}
                  style={{ minHeight: 64 }}
                />
              </>
            ) : null}
          </div>
        ) : null}
        {kind === 'project_update' && projects.length === 0 ? (
          <p className="error" style={{ marginTop: 10 }}>
            A project update needs a project with a granted folder. Create one on
            the <Link href="/projects">projects page</Link> first.
          </p>
        ) : null}
        {!urlsValid ? (
          <p className="error" style={{ marginTop: 10 }}>
            Starting URLs must begin with http:// or https:// (at most{' '}
            {MAX_STARTING_URLS}).
          </p>
        ) : null}
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          One run executes at a time; everything else queues. Closing the browser
          does not stop a run.
        </p>
      </div>

      <div className="panel">
        <h2>Runtime activity</h2>
        {actionError ? <p className="error">{actionError}</p> : null}
        <div className="console">
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
