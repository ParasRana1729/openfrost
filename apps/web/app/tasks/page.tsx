'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  AgentRun,
  Approval,
  Event,
  ExportDestination,
  Project,
  ProjectFolderGrant,
  Task,
  TaskKind,
} from '@openfrost/domain';
import { ApiError, getJson, mutate } from '../../lib/api';
import { estimateCost, formatCost, loadConfiguredModel } from '../../lib/pricing';
import { formatTimestamp } from '../../lib/format';
import { useSession } from '../../lib/useSession';
import { Button } from '../../components/ui/Button';
import { NewTaskDialog } from '../../components/NewTaskDialog';
import { MarkdownView } from '../../components/MarkdownView';
import { useBusyGlow } from '../../components/useBusyGlow';
import { useToast } from '../../components/ToastProvider';
import { TaskFeed } from '../../components/TaskFeed';
import { RawEventsView } from '../../components/RawEventsView';

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
  approval: Approval | null;
}

/** Suggests a safe default export filename derived from the task title. */
function suggestFilename(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 92);
  return `${base.length > 0 ? base : 'report'}.md`;
}

/** Decision states where the review panel polls so progress stays visible. */
const DECISION_STATES: ReadonlySet<string> = new Set(['pending', 'granted']);

/** Detail states where the panel polls so live progress stays visible. */
const LIVE_STATES: ReadonlySet<string> = new Set([
  'queued',
  'running',
  'awaiting_approval',
]);

const KIND_LABEL: Record<TaskKind, string> = {
  research_brief: 'Research brief',
  project_update: 'Project update',
  export_report: 'Export',
  weekly_plan: 'Weekly plan',
};

/** The projects list endpoint returns each project with its grants. */
interface ProjectOption extends Project {
  grants: ProjectFolderGrant[];
}

function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

export default function TasksPage() {
  const { session, loading, refresh } = useSession();
  const { showToast } = useToast();
  const [data, setData] = useState<TasksResponse | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<ExportDestination[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFilename, setExportFilename] = useState('');
  const [exportDestinationId, setExportDestinationId] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const inFlight = useRef(false);
  useBusyGlow(data?.executor.busy ?? false);

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
      void getJson<{ destinations: ExportDestination[] }>('/api/exports/destinations')
        .then((data) => setDestinations(data.destinations))
        .catch(() => setDestinations([]));
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
  const detailLive =
    detail !== null &&
    (LIVE_STATES.has(detail.task.state) ||
      (detail.approval !== null && DECISION_STATES.has(detail.approval.state)));

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



  const cancelTask = async (taskId: string) => {
    if (!csrf) {
      return;
    }
    try {
      await mutate({ method: 'POST', path: `/api/tasks/${taskId}/cancel`, csrfToken: csrf });
      showToast('success', 'Cancellation requested for this task.');
      await refreshTasks();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Cancel failed';
      setError(message);
      showToast('error', message);
    }
  };

  const retryTask = async (taskId: string) => {
    if (!csrf) {
      return;
    }
    try {
      await mutate({ method: 'POST', path: `/api/tasks/${taskId}/retry`, csrfToken: csrf });
      showToast('success', 'Task queued for another run.');
      await refreshTasks();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Retry failed';
      setError(message);
      showToast('error', message);
    }
  };

  const resumeDispatch = async () => {
    if (!csrf) {
      return;
    }
    try {
      await mutate({ method: 'POST', path: '/api/dispatch/resume', csrfToken: csrf });
      showToast('success', 'Task dispatch resumed.');
      await Promise.all([refreshTasks(), refresh()]);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Resume failed';
      setError(message);
      showToast('error', message);
    }
  };

  const openDetail = async (taskId: string) => {
    try {
      setDetail(await getJson<TaskDetail>(`/api/tasks/${taskId}`));
      setExportOpen(false);
      setExportFilename('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not load task';
      setError(message);
      showToast('error', message);
    }
  };

  const proposeExport = async () => {
    if (!csrf || !detail || exportDestinationId === '' || exportFilename.trim().length === 0) {
      return;
    }
    if (!detail.artifact) {
      return;
    }
    setExportBusy(true);
    setError(null);
    try {
      await mutate({
        method: 'POST',
        path: '/api/exports',
        body: {
          artifactId: detail.artifact.id,
          destinationId: exportDestinationId,
          filename: exportFilename.trim(),
        },
        csrfToken: csrf,
      });
      setExportOpen(false);
      showToast('success', 'Export request sent for approval.');
      setDetail(await getJson<TaskDetail>(`/api/tasks/${detail.task.id}`));
      await refreshTasks();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not propose the export';
      setError(message);
      showToast('error', message);
    } finally {
      setExportBusy(false);
    }
  };

  const decideApproval = async (approvalId: string, decision: 'granted' | 'rejected') => {
    if (!csrf || !detail) {
      return;
    }
    setExportBusy(true);
    setError(null);
    try {
      await mutate({
        method: 'POST',
        path: `/api/approvals/${approvalId}/decision`,
        body: { decision },
        csrfToken: csrf,
      });
      showToast('success', decision === 'granted' ? 'Export approved.' : 'Export rejected.');
      setDetail(await getJson<TaskDetail>(`/api/tasks/${detail.task.id}`));
      await refreshTasks();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not record the decision';
      setError(message);
      showToast('error', message);
    } finally {
      setExportBusy(false);
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0 }}>Tasks</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Queue and history of assistant runs.
            </p>
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={() => setIsNewTaskOpen(true)}
            id="new-task-trigger-btn"
          >
            New task
          </Button>
        </div>
      </div>

      <NewTaskDialog
        isOpen={isNewTaskOpen}
        onClose={() => setIsNewTaskOpen(false)}
        projects={projects}
        onSuccess={() => void refreshTasks()}
      />

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
        <TaskFeed
          tasks={data?.tasks ?? []}
          projects={projects}
          selectedTaskId={detail?.task.id ?? null}
          onSelectTask={(task) => void openDetail(task.id)}
          onCancelTask={(taskId) => void cancelTask(taskId)}
          onRetryTask={(taskId) => void retryTask(taskId)}
        />
      </div>

      {detail ? (
        <div className="panel">
          <h1>
            {detail.task.title}{' '}
            <span className={`chip ${detail.task.state}`}>
              {detail.task.state.replace('_', ' ')}
            </span>
          </h1>
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
                {detail.task.kind === 'project_update'
                  ? 'Saved update'
                  : detail.task.kind === 'weekly_plan'
                    ? 'Saved weekly plan'
                    : 'Saved report'}
              </h2>
              <MarkdownView markdown={detail.artifact.markdown} />
            </>
          ) : null}
          {detail.artifact && detail.approval === null ? (
            <div className="export-box">
              <h2>Export a copy</h2>
              <p className="muted">
                Proposes writing this artifact as a <strong>new</strong> Markdown file
                into a granted destination. The write happens only after you approve
                the exact proposal — nothing is written without your decision, and
                existing files are never overwritten.
              </p>
              {!exportOpen ? (
                <div className="row">
                  <button onClick={() => {
                    setExportFilename(suggestFilename(detail.task.title));
                    setExportOpen(true);
                  }}>
                    Propose export…
                  </button>
                </div>
              ) : (
                <>
                  <label htmlFor="export-filename">Filename (new .md file)</label>
                  <input
                    id="export-filename"
                    value={exportFilename}
                    maxLength={100}
                    onChange={(e) => setExportFilename(e.target.value)}
                    placeholder="weekly-update.md"
                  />
                  <label htmlFor="export-destination">Destination</label>
                  <select
                    id="export-destination"
                    value={exportDestinationId}
                    onChange={(e) => setExportDestinationId(e.target.value)}
                  >
                    <option value="">Choose destination…</option>
                    {destinations.map((destination) => (
                      <option key={destination.id} value={destination.id}>
                        {destination.path}
                      </option>
                    ))}
                  </select>
                  {destinations.length === 0 ? (
                    <p className="error">
                      No destination granted yet. Grant one on the{' '}
                      <Link href="/settings">settings page</Link>.
                    </p>
                  ) : null}
                  <div className="row" style={{ marginTop: 10 }}>
                    <button
                      className="primary"
                      disabled={
                        exportBusy ||
                        exportDestinationId === '' ||
                        exportFilename.trim().length === 0
                      }
                      onClick={() => void proposeExport()}
                    >
                      Propose export for review
                    </button>
                    <button disabled={exportBusy} onClick={() => setExportOpen(false)}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
          {detail.approval ? (
            <div className="export-box" data-state={detail.approval.state}>
              <h2>Export review</h2>
              <p className="muted">
                <strong>{detail.approval.filename}</strong> into{' '}
                <span className="mono">{detail.approval.destinationPath}</span> ·{' '}
                <span className="mono">
                  sha256 {detail.approval.contentSha256.slice(0, 12)}…
                </span>{' '}
                · risk tier {detail.approval.riskTier}
              </p>
              <p className="muted">
                Requested {formatTimestamp(detail.approval.requestedAt)} · expires{' '}
                {formatTimestamp(detail.approval.expiresAt)} · state{' '}
                <span className={`chip ${detail.approval.state === 'granted' ? 'running' : detail.approval.state}`}>
                  {detail.approval.state}
                </span>
              </p>
              {detail.approval.refusalReason ? (
                <p className="error">{detail.approval.refusalReason}</p>
              ) : null}
              {detail.approval.outcome ? (
                <p className="muted">
                  Written: <span className="mono">{detail.approval.outcome.file}</span> (
                  {detail.approval.outcome.bytes.toLocaleString()} bytes in{' '}
                  {detail.approval.outcome.ms} ms)
                </p>
              ) : null}
              {detail.approval.state === 'pending' ? (
                <>
                  <p className="note">
                    The run is holding until you decide. The file is written only on
                    approval, as a new file, after every check is repeated.
                  </p>
                  <div className="row">
                    <button
                      className="primary"
                      disabled={exportBusy}
                      onClick={() => void decideApproval(detail.approval!.id, 'granted')}
                    >
                      Approve export
                    </button>
                    <button
                      disabled={exportBusy}
                      onClick={() => void decideApproval(detail.approval!.id, 'rejected')}
                    >
                      Reject
                    </button>
                  </div>
                </>
              ) : null}
              {detail.approval.state === 'granted' && !detail.approval.outcome ? (
                <p className="muted">Approved — writing now…</p>
              ) : null}
            </div>
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
          <RawEventsView
            title="Raw task events"
            events={detail.events}
            defaultOpen={false}
          />
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={() => setDetail(null)}>Close details</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
