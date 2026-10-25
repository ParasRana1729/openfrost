'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { AgentRun, Event, Project, ProjectFolderGrant, Task, TaskKind } from '@openfrost/domain';
import { ApiError, getJson, mutate } from '../../lib/api';
import { estimateCost, formatCost, loadConfiguredModel } from '../../lib/pricing';
import { formatTimestamp } from '../../lib/format';
import { useSession } from '../../lib/useSession';
import { DispatchStrip } from '../../components/DispatchStrip';
import { MarkdownView } from '../../components/MarkdownView';

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

/** Detail states where the panel polls so live progress stays visible. */
const LIVE_STATES: ReadonlySet<string> = new Set([
  'queued',
  'running',
  'awaiting_approval',
]);

const MAX_STARTING_URLS = 5;

const KIND_LABEL: Record<TaskKind, string> = {
  research_brief: 'Research brief',
  project_update: 'Project update',
};

/** The projects list endpoint returns each project with its grants. */
interface ProjectOption extends Project {
  grants: ProjectFolderGrant[];
}

interface ParsedStartingUrls {
  urls: string[];
  invalid: string[];
}

/** Client-side convenience check only; the API revalidates every field. */
function parseStartingUrls(raw: string): ParsedStartingUrls {
  const urls: string[] = [];
  const invalid: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const url = line.trim();
    if (url.length === 0) {
      continue;
    }
    if (/^https?:\/\//i.test(url)) {
      urls.push(url);
    } else {
      invalid.push(url);
    }
  }
  return { urls, invalid };
}

function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

export default function TasksPage() {
  const { session, loading, refresh } = useSession();
  const [data, setData] = useState<TasksResponse | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [request, setRequest] = useState('');
  const [constraints, setConstraints] = useState('');
  const [kind, setKind] = useState<TaskKind>('research_brief');
  const [projectId, setProjectId] = useState('');
  const [startingUrlsText, setStartingUrlsText] = useState('');
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [model, setModel] = useState<string | null>(null);
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
      void getJson<{ projects: ProjectOption[] }>('/api/projects')
        .then((data) => setProjects(data.projects))
        .catch(() => setProjects([]));
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

  // Cost estimates need the configured model; loaded once per session.
  useEffect(() => {
    if (!session?.authenticated) {
      return;
    }
    let canceled = false;
    void loadConfiguredModel().then((value) => {
      if (!canceled) {
        setModel(value);
      }
    });
    return () => {
      canceled = true;
    };
  }, [session?.authenticated]);

  // While the opened task is still in flight, poll its detail every 3 s so
  // progress shows without reopening. Cleanup runs on close/unmount/state change.
  const detailTaskId = detail?.task.id ?? null;
  const detailLive = detail !== null && LIVE_STATES.has(detail.task.state);

  useEffect(() => {
    if (!detailTaskId || !detailLive) {
      return;
    }
    let canceled = false;
    const poll = setInterval(() => {
      void (async () => {
        try {
          const next = await getJson<TaskDetail>(`/api/tasks/${detailTaskId}`);
          if (!canceled) {
            setDetail(next);
          }
        } catch {
          // A missed poll is harmless; the next tick retries.
        }
      })();
    }, 3000);
    return () => {
      canceled = true;
      clearInterval(poll);
    };
  }, [detailTaskId, detailLive]);

  const csrf = session?.csrfToken ?? null;

  const parsedUrls = parseStartingUrls(startingUrlsText);
  // Starting URLs apply to research briefs only; project updates read files.
  const startingUrlsInvalid =
    kind === 'research_brief' &&
    (parsedUrls.invalid.length > 0 || parsedUrls.urls.length > MAX_STARTING_URLS);
  const projectUpdateInvalid = kind === 'project_update' && projectId === '';
  const selectedProject = projects.find((project) => project.id === projectId) ?? null;

  const submitTask = async () => {
    if (!csrf || title.trim().length === 0 || request.trim().length === 0) {
      return;
    }
    if (startingUrlsInvalid || projectUpdateInvalid) {
      return;
    }
    const body: {
      title: string;
      request: string;
      constraints?: string;
      startingUrls?: string[];
      projectId?: string;
      kind: TaskKind;
    } = { title: title.trim(), request: request.trim(), kind };
    if (constraints.trim().length > 0) {
      body.constraints = constraints.trim();
    }
    if (kind === 'research_brief' && parsedUrls.urls.length > 0) {
      body.startingUrls = parsedUrls.urls;
    }
    if (projectId !== '') {
      body.projectId = projectId;
    }
    try {
      await mutate({ method: 'POST', path: '/api/tasks', body, csrfToken: csrf });
      setTitle('');
      setRequest('');
      setConstraints('');
      setStartingUrlsText('');
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
      <DispatchStrip
        busy={data?.executor.busy ?? false}
        activeTaskId={data?.executor.activeTaskId ?? null}
        dispatchPaused={data?.executor.dispatchPaused ?? false}
        queuedCount={(data?.tasks ?? []).filter((task) => task.state === 'queued').length}
      />

      <div className="panel">
        <h1>New task</h1>
        <label htmlFor="kind">Workflow</label>
        <select
          id="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as TaskKind)}
        >
          <option value="research_brief">
            Research brief — public web search and page retrieval
          </option>
          <option value="project_update">
            Project update — read a project&apos;s granted files
          </option>
        </select>
        <label htmlFor="project">Project (optional for briefs, required for updates)</label>
        <select
          id="project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        {kind === 'project_update' && projects.length === 0 ? (
          <p className="error">
            A project update needs a project with a granted folder. Create one on
            the <Link href="/projects">projects page</Link> first.
          </p>
        ) : null}
        {kind === 'project_update' && selectedProject ? (
          <p className="muted">
            Scoped to <strong>{selectedProject.name}</strong>: the run can read only
            this project&apos;s granted folders ({selectedProject.grants.length}{' '}
            granted) and only this project&apos;s instructions apply.{' '}
            {selectedProject.grants.length === 0
              ? 'It will fail honestly until a folder is granted.'
              : ''}
          </p>
        ) : null}
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
        <label htmlFor="constraints">Constraints (optional)</label>
        <textarea
          id="constraints"
          value={constraints}
          maxLength={2000}
          onChange={(e) => setConstraints(e.target.value)}
          placeholder="Prefer local-first tools; budget under $20/month"
        />
        {kind === 'research_brief' ? (
          <>
            <label htmlFor="starting-urls">
              Starting URLs (optional, one per line, max {MAX_STARTING_URLS})
            </label>
            <textarea
              id="starting-urls"
              value={startingUrlsText}
              onChange={(e) => setStartingUrlsText(e.target.value)}
              placeholder={'https://example.com/overview\nhttps://example.com/pricing'}
            />
          </>
        ) : null}
        {startingUrlsInvalid ? (
          <p className="error">
            {parsedUrls.invalid.length > 0
              ? `These lines do not start with http:// or https://: ${parsedUrls.invalid.join(', ')}. `
              : ''}
            {parsedUrls.urls.length > MAX_STARTING_URLS
              ? `At most ${MAX_STARTING_URLS} starting URLs are allowed (${parsedUrls.urls.length} given).`
              : ''}
          </p>
        ) : null}
        <p className="muted">
          One run executes at a time; everything else queues here. Requests are
          bounded by the execution limits shown in Settings.
        </p>
        <div className="row">
          <button
            className="primary"
            disabled={
              !csrf ||
              title.trim().length === 0 ||
              request.trim().length === 0 ||
              startingUrlsInvalid ||
              projectUpdateInvalid
            }
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
          <p className="empty">
            <strong>Nothing queued right now.</strong> Describe what the assistant
            should work on above, and it will run here — one task at a time.
          </p>
        ) : (
          (data?.tasks ?? []).map((task) => (
            <div className="task" data-state={task.state} key={task.id}>
              <div className="head">
                <strong>{task.title}</strong>
                <span className={`chip ${task.state}`}>{task.state.replace('_', ' ')}</span>
              </div>
              <p className="muted">
                {KIND_LABEL[task.kind] ?? task.kind}
                {task.projectId
                  ? ` · project: ${projects.find((p) => p.id === task.projectId)?.name ?? task.projectId.slice(0, 8) + '…'}`
                  : ''}
              </p>
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
          <p className="muted">
            <strong>Workflow:</strong> {KIND_LABEL[detail.task.kind] ?? detail.task.kind}
            {detail.task.projectId
              ? ` · scoped to project ${projects.find((p) => p.id === detail.task.projectId)?.name ?? detail.task.projectId.slice(0, 8) + '…'}`
              : ''}
          </p>
          {detail.task.constraints ? (
            <p className="muted">
              <strong>Constraints:</strong> {detail.task.constraints}
            </p>
          ) : null}
          {detail.task.startingUrls && detail.task.startingUrls.length > 0 ? (
            <p className="muted">
              <strong>Starting URLs:</strong>{' '}
              {detail.task.startingUrls.map((url, index) => (
                <span key={`${index}-${url}`}>
                  {index > 0 ? ' · ' : ''}
                  {isHttpUrl(url) ? (
                    <a href={url} target="_blank" rel="noopener noreferrer nofollow">
                      {url}
                    </a>
                  ) : (
                    url
                  )}
                </span>
              ))}
            </p>
          ) : null}
          {detail.artifact ? (
            <>
              <h2>
                {detail.task.kind === 'project_update' ? 'Saved update' : 'Saved report'}
              </h2>
              <MarkdownView markdown={detail.artifact.markdown} />
            </>
          ) : null}
          <h2>Run attempts</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>State</th>
                <th>Usage</th>
                <th>Tokens</th>
                <th>Failure</th>
              </tr>
            </thead>
            <tbody>
              {detail.runs.map((run) => {
                const usage = run.usage;
                const inputTokens = usage?.inputTokens ?? null;
                const outputTokens = usage?.outputTokens ?? null;
                const cost =
                  inputTokens !== null && outputTokens !== null
                    ? estimateCost(model ?? '', inputTokens, outputTokens)
                    : null;
                return (
                  <tr key={run.id}>
                    <td className="mono">#{run.attempt}</td>
                    <td className="mono">{run.state}</td>
                    <td className="mono">
                      {usage
                        ? `${usage.steps} steps · ${usage.outputChars} chars out`
                        : '—'}
                    </td>
                    <td className="mono">
                      {inputTokens !== null && outputTokens !== null ? (
                        <>
                          <div>
                            {inputTokens.toLocaleString()} in /{' '}
                            {outputTokens.toLocaleString()} out tok
                          </div>
                          {cost !== null ? (
                            <div className="muted">
                              ~{formatCost(cost)} (list-price estimate, may change)
                            </div>
                          ) : (
                            <div className="muted">
                              cost: no list price on file for this model
                            </div>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {run.failure
                        ? `${run.failure.code}${run.failure.limitHit ? ` (${run.failure.limitHit})` : ''}: ${run.failure.message}`
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h2>Activity</h2>
          <div className="console">
            {detail.events.length === 0 ? (
              <div className="console-empty">No recorded activity for this task.</div>
            ) : (
              detail.events.map((event) => (
                <div className="console-row" key={event.id}>
                  <span className="console-type">{event.type}</span>
                  <span className="console-time">{formatTimestamp(event.createdAt)}</span>
                </div>
              ))
            )}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={() => setDetail(null)}>Close details</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
