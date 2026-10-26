'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Project,
  Routine,
  RoutineOccurrence,
  RoutineSchedule,
  Task,
} from '@openfrost/domain';
import { WEEKDAY_NAMES as WEEKDAYS } from '@openfrost/domain';
import { ApiError, getJson, mutate } from '../../lib/api';
import { formatTimestamp } from '../../lib/format';
import { useSession } from '../../lib/useSession';
import { useToast } from '../../components/ToastProvider';

interface RoutineListEntry {
  routine: Routine;
  nextOccurrenceAt: string | null;
  nextOccurrenceKey: string | null;
  missedCount: number;
  projectName: string | null;
}

interface RoutineDetail extends RoutineListEntry {
  occurrences: Array<RoutineOccurrence & { task: Task | null }>;
}

interface ProjectOption extends Project {
  grants: ProjectFolderGrantShape[];
}

interface ProjectFolderGrantShape {
  id: string;
  path: string;
}

const DEFAULT_TIMEZONE = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

function scheduleSummary(schedule: RoutineSchedule): string {
  return schedule.kind === 'weekly'
    ? `Weekly on ${WEEKDAYS[schedule.weekday]}s at ${schedule.time}`
    : `Daily at ${schedule.time}`;
}

interface FormState {
  name: string;
  projectId: string;
  timezone: string;
  cadence: 'weekly' | 'daily';
  weekday: number;
  time: string;
  title: string;
  request: string;
  constraints: string;
}

function formFromRoutine(routine: Routine, projects: ProjectOption[]): FormState {
  const project = projects.find((p) => p.id === routine.projectId);
  return {
    name: routine.name,
    projectId: project ? routine.projectId : '',
    timezone: routine.timezone,
    cadence: routine.schedule.kind,
    weekday: routine.schedule.kind === 'weekly' ? routine.schedule.weekday : 5,
    time: routine.schedule.time,
    title: routine.template.title,
    request: routine.template.request,
    constraints: routine.template.constraints ?? '',
  };
}

function emptyForm(projects: ProjectOption[]): FormState {
  return {
    name: '',
    projectId: projects[0]?.id ?? '',
    timezone: DEFAULT_TIMEZONE(),
    cadence: 'weekly',
    weekday: 5,
    time: '09:00',
    title: 'Draft next week priorities',
    request:
      'Review this project\u2019s notes and recent saved updates, then draft ' +
      'next week\u2019s priorities, unresolved questions, and suggested next steps.',
    constraints: '',
  };
}

export default function RoutinesPage() {
  const { session, loading } = useSession();
  const { showToast } = useToast();
  const [entries, setEntries] = useState<RoutineListEntry[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Editing target routine id; null = closed form, 'new' = create. */
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, RoutineDetail>>({});

  const refresh = useCallback(async () => {
    try {
      const [routinesRes, projectsRes] = await Promise.all([
        getJson<{ routines: RoutineListEntry[] }>('/api/routines'),
        getJson<{ projects: ProjectOption[] }>('/api/projects'),
      ]);
      setEntries(routinesRes.routines);
      setProjects(projectsRes.projects);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load routines');
    }
  }, []);

  const refreshDetail = useCallback(async (routineId: string) => {
    try {
      const detail = await getJson<RoutineDetail>(`/api/routines/${routineId}`);
      setDetails((prev) => ({ ...prev, [routineId]: detail }));
    } catch {
      // The routine may have been removed; the list refresh covers it.
    }
  }, []);

  useEffect(() => {
    if (session?.authenticated) {
      void refresh();
    }
  }, [session?.authenticated, refresh]);

  useEffect(() => {
    if (expanded !== null) {
      void refreshDetail(expanded);
    }
  }, [expanded, entries, refreshDetail]);

  const csrf = session?.csrfToken ?? null;

  const startCreate = () => {
    setError(null);
    setEditing('new');
    setForm(emptyForm(projects));
  };

  const startEdit = (routine: Routine) => {
    setError(null);
    setEditing(routine.id);
    setForm(formFromRoutine(routine, projects));
  };

  const formInvalid = useMemo(() => {
    if (form === null) {
      return true;
    }
    return (
      form.name.trim().length === 0 ||
      form.projectId === '' ||
      form.timezone.trim().length === 0 ||
      form.title.trim().length === 0 ||
      form.request.trim().length === 0
    );
  }, [form]);

  const submitForm = async () => {
    if (!csrf || form === null) {
      return;
    }
    const payload = {
      name: form.name.trim(),
      projectId: form.projectId,
      timezone: form.timezone.trim(),
      schedule:
        form.cadence === 'weekly'
          ? { kind: 'weekly', weekday: form.weekday, time: form.time }
          : { kind: 'daily', time: form.time },
      template: {
        title: form.title.trim(),
        request: form.request.trim(),
        constraints: form.constraints.trim() === '' ? null : form.constraints.trim(),
      },
    };
    setBusy(true);
    setError(null);
    try {
      if (editing === 'new') {
        await mutate({ method: 'POST', path: '/api/routines', body: payload, csrfToken: csrf });
        showToast(
          'success',
          'Routine saved as a paused draft. Review the template, scope, time zone, ' +
            'and cadence below, then enable it.',
        );
      } else {
        await mutate({
          method: 'PUT',
          path: `/api/routines/${editing}`,
          body: payload,
          csrfToken: csrf,
        });
        showToast('success', 'Routine updated. Schedule changes apply from the next tick.');
      }
      setEditing(null);
      setForm(null);
      await refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save the routine';
      setError(message);
      showToast('error', message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    if (!csrf) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fn();
      showToast('success', label);
      await refresh();
      if (expanded !== null) {
        await refreshDetail(expanded);
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Action failed';
      setError(message);
      showToast('error', message);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !session || !session.ownerCreated || !session.authenticated) {
    return (
      <div className="panel">
        <h1>Routines</h1>
        <p className="muted">{error ?? 'Checking local session…'}</p>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <h1>Routines</h1>
        <p className="muted">
          A routine drafts next week&rsquo;s priorities from one project&rsquo;s granted
          notes and its two most recent saved updates. You review the task template,
          project scope, time zone, and cadence before enabling; the runtime then runs
          each due occurrence without an open browser, through the same global queue
          and limits as manual tasks. If the PC or runtime was unavailable, one missed
          occurrence appears here for review — run it once now or skip it; nothing is
          replayed automatically.
        </p>
        <p className="muted">
          Plan contents (request, notes, and update excerpts) are sent to the
          configured model provider, like every other task.
        </p>
        {error ? <p className="error">{error}</p> : null}

        {projects.length === 0 ? (
          <p className="note">
            No projects yet — routines are project-scoped. Create a project and grant
            a notes folder first.
          </p>
        ) : null}

        {entries.length === 0 && projects.length > 0 ? (
          <p className="muted">No routines configured yet.</p>
        ) : null}

        {entries.map((entry) => {
          const routine = entry.routine;
          const detail = details[routine.id];
          const missed = (detail?.occurrences ?? []).filter(
            (occurrence) => occurrence.state === 'missed',
          );
          return (
            <div key={routine.id} className="grant-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>{routine.name}</strong>{' '}
                  <span className="muted">
                    · {entry.projectName ?? 'unknown project'} ·{' '}
                    {scheduleSummary(routine.schedule)} · {routine.timezone} ·{' '}
                    {routine.state === 'active' ? 'enabled' : 'paused'}
                  </span>
                </div>
                <div className="row">
                  {routine.state === 'paused' ? (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act('Routine enabled.', async () =>
                          mutate({
                            method: 'POST',
                            path: `/api/routines/${routine.id}/enable`,
                            csrfToken: csrf,
                          }),
                        )
                      }
                    >
                      Enable
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act('Routine paused.', async () =>
                          mutate({
                            method: 'POST',
                            path: `/api/routines/${routine.id}/pause`,
                            csrfToken: csrf,
                          }),
                        )
                      }
                    >
                      Pause
                    </button>
                  )}
                  <button disabled={busy} onClick={() => startEdit(routine)}>
                    Edit
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act('Routine removed.', async () =>
                        mutate({
                          method: 'DELETE',
                          path: `/api/routines/${routine.id}`,
                          csrfToken: csrf,
                        }),
                      )
                    }
                  >
                    Remove
                  </button>
                  <button
                    onClick={() => setExpanded(expanded === routine.id ? null : routine.id)}
                  >
                    {expanded === routine.id ? 'Hide history' : 'History'}
                  </button>
                </div>
              </div>
              <p className="muted" style={{ margin: 0 }}>
                Template: <strong>{routine.template.title}</strong> —{' '}
                {routine.template.request}
                {routine.template.constraints ? (
                  <> · Constraints: {routine.template.constraints}</>
                ) : null}
              </p>
              <p className="muted" style={{ margin: 0 }}>
                {routine.state === 'active'
                  ? `Next occurrence: ${
                      entry.nextOccurrenceAt
                        ? `${entry.nextOccurrenceKey} (${formatTimestamp(entry.nextOccurrenceAt)})`
                        : '—'
                    }`
                  : `Would next run: ${
                      entry.nextOccurrenceAt
                        ? `${entry.nextOccurrenceKey} (${formatTimestamp(entry.nextOccurrenceAt)})`
                        : '—'
                    }`}{' '}
                · Last dispatched:{' '}
                {routine.lastOccurrenceAt
                  ? `${routine.lastOccurrenceKey} (${formatTimestamp(routine.lastOccurrenceAt)})`
                  : 'never'}
              </p>

              {missed.length > 0 ? (
                <div className="export-box">
                  <h3 style={{ marginTop: 0 }}>Missed occurrences for review</h3>
                  {missed.map((occurrence) => (
                    <div key={occurrence.id} className="grant-row">
                      <span>
                        <strong className="mono">{occurrence.occurrenceKey}</strong>{' '}
                        <span className="muted">
                          scheduled {formatTimestamp(occurrence.scheduledFor)}
                        </span>
                      </span>
                      <span className="row">
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act('Running the missed occurrence once now.', async () =>
                              mutate({
                                method: 'POST',
                                path: `/api/routines/${routine.id}/occurrences/${occurrence.occurrenceKey}/run`,
                                csrfToken: csrf,
                              }),
                            )
                          }
                        >
                          Run once now
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void act('Occurrence skipped.', async () =>
                              mutate({
                                method: 'POST',
                                path: `/api/routines/${routine.id}/occurrences/${occurrence.occurrenceKey}/skip`,
                                csrfToken: csrf,
                              }),
                            )
                          }
                        >
                          Skip
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              {expanded === routine.id && detail ? (
                detail.occurrences.length === 0 ? (
                  <p className="muted">No occurrences recorded yet.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Occurrence (local date)</th>
                        <th>Scheduled</th>
                        <th>State</th>
                        <th>Task</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.occurrences.map((occurrence) => (
                        <tr key={occurrence.id}>
                          <td className="mono">{occurrence.occurrenceKey}</td>
                          <td>{formatTimestamp(occurrence.scheduledFor)}</td>
                          <td>{occurrence.state}</td>
                          <td className="mono">
                            {occurrence.task
                              ? `${occurrence.task.state}`
                              : occurrence.taskId
                                ? occurrence.taskId.slice(0, 8)
                                : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : null}
            </div>
          );
        })}

        {editing !== null && form !== null ? (
          <div className="export-box" style={{ marginTop: 16 }}>
            <h2 style={{ marginTop: 0 }}>
              {editing === 'new' ? 'New routine' : 'Edit routine'}
            </h2>
            <label htmlFor="routine-name">Name</label>
            <input
              id="routine-name"
              value={form.name}
              maxLength={200}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Friday planning"
            />
            <label htmlFor="routine-project">Project (scope for notes and updates)</label>
            <select
              id="routine-project"
              value={form.projectId}
              onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <label htmlFor="routine-timezone">Time zone (IANA)</label>
            <input
              id="routine-timezone"
              value={form.timezone}
              maxLength={100}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              placeholder="Europe/Berlin"
            />
            <p className="muted">
              Occurrences are keyed by the local date in this zone, so clock changes
              and daylight-saving transitions never duplicate or drop a run.
            </p>
            <label>Cadence</label>
            <div className="segmented" role="radiogroup" aria-label="Cadence">
              <button
                type="button"
                role="radio"
                aria-checked={form.cadence === 'weekly'}
                onClick={() => setForm({ ...form, cadence: 'weekly' })}
              >
                Weekly
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={form.cadence === 'daily'}
                onClick={() => setForm({ ...form, cadence: 'daily' })}
              >
                Daily
              </button>
            </div>
            {form.cadence === 'weekly' ? (
              <>
                <label htmlFor="routine-weekday">Day of week</label>
                <select
                  id="routine-weekday"
                  value={form.weekday}
                  onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}
                >
                  {WEEKDAYS.map((name, index) => (
                    <option key={name} value={index}>
                      {name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            <label htmlFor="routine-time">Time of day (zone local, 24h)</label>
            <input
              id="routine-time"
              type="time"
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
            />

            <h3>Task template</h3>
            <label htmlFor="routine-title">Task title</label>
            <input
              id="routine-title"
              value={form.title}
              maxLength={200}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <label htmlFor="routine-request">Request</label>
            <textarea
              id="routine-request"
              rows={4}
              value={form.request}
              maxLength={2000}
              onChange={(e) => setForm({ ...form, request: e.target.value })}
            />
            <label htmlFor="routine-constraints">Constraints (optional)</label>
            <textarea
              id="routine-constraints"
              rows={2}
              value={form.constraints}
              maxLength={2000}
              onChange={(e) => setForm({ ...form, constraints: e.target.value })}
            />
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="primary"
                disabled={busy || formInvalid}
                onClick={() => void submitForm()}
              >
                {editing === 'new' ? 'Create routine (paused draft)' : 'Save changes'}
              </button>
              <button
                onClick={() => {
                  setEditing(null);
                  setForm(null);
                }}
              >
                Cancel
              </button>
            </div>
            {editing === 'new' ? (
              <p className="muted">
                The routine is created paused. Enabling is a separate step — review
                everything here first.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="primary"
              disabled={projects.length === 0}
              onClick={startCreate}
            >
              New routine
            </button>
          </div>
        )}
      </div>
    </>
  );
}
