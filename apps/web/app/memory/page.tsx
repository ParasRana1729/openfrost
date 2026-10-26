'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  MemoryEntry,
  MemoryFileView,
  MemoryProposal,
  MemorySnapshot,
} from '@openfrost/domain';
import { ApiError, getJson, mutate } from '../../lib/api';
import { formatTimestamp } from '../../lib/format';
import { useSession } from '../../lib/useSession';
import { useToast } from '../../components/ToastProvider';

function scopeLabel(
  scope: 'global' | 'project',
  projectName: string | null,
): string {
  return scope === 'global' ? 'Global preference' : `Project fact · ${projectName ?? 'missing project'}`;
}

function sourceLabel(source: MemoryEntry['source']): string {
  const task = source.taskId ? ` · task ${source.taskId.slice(0, 8)}` : '';
  return `${source.label}${task}`;
}

export default function MemoryPage() {
  const { session, loading } = useSession();
  const { showToast } = useToast();
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposalDrafts, setProposalDrafts] = useState<Record<string, string>>({});
  const [entryDrafts, setEntryDrafts] = useState<Record<string, string>>({});
  const [editingEntry, setEditingEntry] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getJson<MemorySnapshot>('/api/memory');
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load memory');
    }
  }, []);

  useEffect(() => {
    if (session?.authenticated) {
      void refresh();
    }
  }, [session?.authenticated, refresh]);

  const csrf = session?.csrfToken ?? null;

  const run = async (action: () => Promise<string | void>) => {
    if (!csrf) {
      const message = 'Session is still loading — try again in a moment.';
      setError(message);
      showToast('error', message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const message = await action();
      if (typeof message === 'string') {
        showToast('success', message);
      }
      await refresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Request failed';
      setError(message);
      showToast('error', message);
    } finally {
      setBusy(false);
    }
  };

  const fileFor = (
    scope: 'global' | 'project',
    projectId: string | null,
  ): MemoryFileView | null => {
    if (!snapshot) {
      return null;
    }
    if (scope === 'global') {
      return snapshot.global;
    }
    return (
      snapshot.projects.find((project) => project.projectId === projectId) ?? null
    );
  };

  const projectName = (projectId: string | null): string | null =>
    snapshot?.projects.find((project) => project.projectId === projectId)?.projectName ??
    null;

  const approve = (proposal: MemoryProposal) =>
    run(async () => {
      const file = fileFor(proposal.scope, proposal.projectId);
      if (!file) {
        throw new Error('This proposal points at a project that no longer exists.');
      }
      const draft = proposalDrafts[proposal.id];
      const content = (draft ?? proposal.content ?? '').trim();
      if (content.length === 0) {
        throw new Error('A memory cannot be empty.');
      }
      await mutate({
        method: 'POST',
        path: `/api/memory/proposals/${proposal.id}/approve`,
        body: {
          ...(draft !== undefined ? { content: draft } : {}),
          fileSha256: file.sha256,
        },
        csrfToken: csrf,
      });
      setProposalDrafts((current) => {
        const next = { ...current };
        delete next[proposal.id];
        return next;
      });
      return 'Memory approved. Future tasks can use it until you delete or edit it.';
    });

  const reject = (proposal: MemoryProposal) =>
    run(async () => {
      await mutate({
        method: 'POST',
        path: `/api/memory/proposals/${proposal.id}/reject`,
        csrfToken: csrf,
      });
      setProposalDrafts((current) => {
        const next = { ...current };
        delete next[proposal.id];
        return next;
      });
      return 'Proposal rejected. It was never used as memory.';
    });

  const saveEntry = (entry: MemoryEntry) =>
    run(async () => {
      const file = fileFor(entry.scope, entry.projectId);
      if (!file) {
        throw new Error('This memory file is no longer available.');
      }
      const content = (entryDrafts[entry.id] ?? entry.content).trim();
      if (content.length === 0) {
        throw new Error('A memory cannot be empty.');
      }
      await mutate({
        method: 'PUT',
        path: `/api/memory/entries/${entry.id}`,
        body: { content, fileSha256: file.sha256 },
        csrfToken: csrf,
      });
      setEditingEntry(null);
      setEntryDrafts((current) => {
        const next = { ...current };
        delete next[entry.id];
        return next;
      });
      return 'Memory updated.';
    });

  const deleteEntry = (entry: MemoryEntry) => {
    const confirmed = window.confirm(
      'Delete this memory from future retrieval? The source task and history stay intact.',
    );
    if (!confirmed) {
      return;
    }
    void run(async () => {
      const file = fileFor(entry.scope, entry.projectId);
      if (!file) {
        throw new Error('This memory file is no longer available.');
      }
      await mutate({
        method: 'DELETE',
        path: `/api/memory/entries/${entry.id}`,
        body: { fileSha256: file.sha256 },
        csrfToken: csrf,
      });
      setEditingEntry(null);
      return 'Memory deleted from future retrieval. Source history was kept.';
    });
  };

  const reloadFromDisk = () =>
    run(async () => {
      await mutate({
        method: 'POST',
        path: '/api/memory/reload',
        csrfToken: csrf,
      });
      return 'Memory reloaded from the canonical Markdown files.';
    });

  if (loading || !session || !session.ownerCreated || !session.authenticated) {
    return (
      <div className="panel">
        <h1>Memory</h1>
        <p className="muted">{error ?? 'Checking local session…'}</p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="panel">
        <h1>Memory</h1>
        <p className="muted">{error ?? 'Loading memory…'}</p>
      </div>
    );
  }

  const pending = snapshot.proposals.filter((proposal) => proposal.state === 'pending');
  const history = snapshot.proposals.filter((proposal) => proposal.state !== 'pending');
  const allFiles: MemoryFileView[] = [snapshot.global, ...snapshot.projects];
  const externalChanges = allFiles.filter((file) => file.externalChange);
  const problemLines = allFiles.flatMap((file) =>
    file.problems.map((problem) => `${file.path}: ${problem}`),
  );

  const renderEntry = (entry: MemoryEntry) => (
    <div className="task" data-state="completed" key={entry.id}>
      <div className="head">
        <strong>{scopeLabel(entry.scope, projectName(entry.projectId))}</strong>
        <span className="mono muted">
          {formatTimestamp(entry.updatedAt)}
        </span>
      </div>
      {editingEntry === entry.id ? (
        <>
          <textarea
            value={entryDrafts[entry.id] ?? entry.content}
            maxLength={snapshot.limits.contentMaxChars}
            onChange={(event) =>
              setEntryDrafts((current) => ({
                ...current,
                [entry.id]: event.target.value,
              }))
            }
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void saveEntry(entry)}
            >
              Save
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setEditingEntry(null);
                setEntryDrafts((current) => {
                  const next = { ...current };
                  delete next[entry.id];
                  return next;
                });
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ whiteSpace: 'pre-wrap' }}>{entry.content}</p>
          <p className="muted">
            Source: {sourceLabel(entry.source)} · approved{' '}
            {formatTimestamp(entry.createdAt)}
          </p>
          <div className="row">
            <button
              disabled={busy}
              onClick={() => {
                setEditingEntry(entry.id);
                setEntryDrafts((current) => ({
                  ...current,
                  [entry.id]: entry.content,
                }));
              }}
            >
              Edit
            </button>
            <button disabled={busy} onClick={() => deleteEntry(entry)}>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <div className="panel">
        <h1>Memory</h1>
        <p>
          Memory is durable context the assistant may propose but never grants
          itself. Only entries you approve here enter future task context:
          global preferences for every task, plus the active project&apos;s facts
          for tasks scoped to that project. Nothing else crosses project lines.
        </p>
        <p className="muted">
          Approved memory is sent to the configured model provider along with the
          task (see Settings). The canonical content lives in Markdown; SQLite
          keeps only proposal review text and a rebuildable metadata index.
          Credentials are refused before they can become memory.
        </p>
        <div className="row" style={{ marginTop: 10 }}>
          <button disabled={busy || !csrf} onClick={() => void reloadFromDisk()}>
            Reload from disk
          </button>
          <span className="muted">
            Use this after editing a memory file outside OpenFrost.
          </span>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {externalChanges.length > 0 || problemLines.length > 0 ? (
        <div className="panel">
          <h2>File state needs review</h2>
          {externalChanges.map((file) => (
            <p className="note" key={file.path}>
              <strong>External edit detected:</strong> {file.path} changed on
              disk after OpenFrost last indexed it. Review the entries below,
              then reload before editing or approving so nothing is overwritten.
            </p>
          ))}
          {problemLines.map((line) => (
            <p className="error" key={line}>
              {line}
            </p>
          ))}
        </div>
      ) : null}

      <div className="panel">
        <h2>Pending proposals</h2>
        {pending.length === 0 ? (
          <p className="empty">
            <strong>No pending proposals.</strong> The assistant can suggest a
            memory during a task; it appears here for your decision and is never
            used before you approve it.
          </p>
        ) : (
          pending.map((proposal) => {
            const content = proposalDrafts[proposal.id] ?? proposal.content ?? '';
            const project = projectName(proposal.projectId);
            return (
              <div className="task" data-state="queued" key={proposal.id}>
                <div className="head">
                  <strong>{scopeLabel(proposal.scope, project)}</strong>
                  <span className="mono muted">
                    proposed {formatTimestamp(proposal.proposedAt)}
                  </span>
                </div>
                <p className="muted">
                  Source: {sourceLabel(proposal.source)}
                  {proposal.sourceRunId
                    ? ` · run ${proposal.sourceRunId.slice(0, 8)}`
                    : ''}
                </p>
                <label htmlFor={`proposal-${proposal.id}`}>
                  Proposed memory (edit before approving if needed)
                </label>
                <textarea
                  id={`proposal-${proposal.id}`}
                  value={content}
                  maxLength={snapshot.limits.contentMaxChars}
                  onChange={(event) =>
                    setProposalDrafts((current) => ({
                      ...current,
                      [proposal.id]: event.target.value,
                    }))
                  }
                />
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !csrf ||
                      content.trim().length === 0 ||
                      (proposal.scope === 'project' && project === null)
                    }
                    onClick={() => void approve(proposal)}
                  >
                    Approve memory
                  </button>
                  <button disabled={busy || !csrf} onClick={() => void reject(proposal)}>
                    Reject
                  </button>
                  {proposal.scope === 'project' && project === null ? (
                    <span className="error">
                      This project no longer exists, so its proposal cannot be
                      approved.
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="panel">
        <h2>Global preferences</h2>
        <p className="mono muted">{snapshot.global.path}</p>
        {snapshot.global.entries.length === 0 ? (
          <p className="empty">
            <strong>No approved global preferences.</strong> Approve a proposal
            above to add durable guidance for every task.
          </p>
        ) : (
          snapshot.global.entries.map(renderEntry)
        )}
      </div>

      <div className="panel">
        <h2>Project facts</h2>
        {snapshot.projects.length === 0 ? (
          <p className="empty">
            <strong>No projects yet.</strong> Create one on the{' '}
            <Link href="/projects">projects page</Link>; project-approved facts
            stay isolated to that project.
          </p>
        ) : (
          snapshot.projects.map((project) => (
            <div key={project.projectId} style={{ marginBottom: 18 }}>
              <h3>{project.projectName}</h3>
              <p className="mono muted">{project.path}</p>
              {project.entries.length === 0 ? (
                <p className="muted">
                  No approved facts for this project. Its tasks see global
                  preferences only until you approve a project memory.
                </p>
              ) : (
                project.entries.map(renderEntry)
              )}
            </div>
          ))
        )}
      </div>

      <div className="panel">
        <h2>Decision history</h2>
        {history.length === 0 ? (
          <p className="muted">
            No decisions yet. Approved and rejected proposals keep their scope,
            source, dates, and content hashes here; proposal text is cleared
            after a decision because the Markdown entry is canonical.
          </p>
        ) : (
          <>
            <p className="muted">
              Source history is retained even after a memory is deleted. Proposal
              text is not re-displayed after a decision; inspect the Markdown
              entry above instead.
            </p>
            {history.map((proposal) => (
              <div className="task" data-state={proposal.state === 'approved' ? 'completed' : 'failed'} key={proposal.id}>
                <div className="head">
                  <strong>
                    {proposal.state === 'approved' ? 'Approved' : 'Rejected'} ·{' '}
                    {scopeLabel(proposal.scope, projectName(proposal.projectId))}
                  </strong>
                  <span className="mono muted">
                    decided{' '}
                    {proposal.decidedAt ? formatTimestamp(proposal.decidedAt) : 'unknown'}
                  </span>
                </div>
                <p className="muted">
                  Source: {sourceLabel(proposal.source)} · proposed{' '}
                  {formatTimestamp(proposal.proposedAt)}
                  {proposal.sourceRunId
                    ? ` · run ${proposal.sourceRunId.slice(0, 8)}`
                    : ''}
                </p>
                {proposal.memoryEntryId ? (
                  <p className="mono muted">
                    entry {proposal.memoryEntryId.slice(0, 8)} · content hash{' '}
                    {proposal.decidedContentSha256?.slice(0, 12) ?? 'not approved'}
                  </p>
                ) : null}
                {proposal.state === 'rejected' ? (
                  <p className="muted">Rejected proposals never became memory.</p>
                ) : null}
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
