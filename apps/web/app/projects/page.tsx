'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Project, ProjectFolderGrant } from '@openfrost/domain';
import { ApiError, getJson, mutate } from '../../lib/api';
import { formatTimestamp } from '../../lib/format';
import { useSession } from '../../lib/useSession';

interface ProjectWithGrants extends Project {
  grants: ProjectFolderGrant[];
}

export default function ProjectsPage() {
  const { session, loading } = useSession();
  const [projects, setProjects] = useState<ProjectWithGrants[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newInstructions, setNewInstructions] = useState('');

  // Per-project editing state: one draft at a time.
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [grantPath, setGrantPath] = useState<{ id: string; value: string } | null>(null);

  const refreshProjects = useCallback(async () => {
    try {
      const data = await getJson<{ projects: ProjectWithGrants[] }>('/api/projects');
      setProjects(data.projects);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load projects');
    }
  }, []);

  useEffect(() => {
    if (session?.authenticated) {
      void refreshProjects();
    }
  }, [session?.authenticated, refreshProjects]);

  const csrf = session?.csrfToken ?? null;

  const run = async (action: () => Promise<string | void>) => {
    if (!csrf) {
      setError('Session is still loading — try again in a moment.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (typeof message === 'string') {
        setNotice(message);
      }
      await refreshProjects();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const createProject = () =>
    run(async () => {
      await mutate({
        method: 'POST',
        path: '/api/projects',
        body: {
          name: newName.trim(),
          ...(newInstructions.trim().length > 0
            ? { instructions: newInstructions.trim() }
            : {}),
        },
        csrfToken: csrf,
      });
      setNewName('');
      setNewInstructions('');
      return 'Project created.';
    });

  const startEdit = (project: ProjectWithGrants) => {
    setEditId(project.id);
    setEditName(project.name);
    setEditInstructions(project.instructions ?? '');
    setNotice(null);
    setError(null);
  };

  const saveEdit = (projectId: string) =>
    run(async () => {
      await mutate({
        method: 'PUT',
        path: `/api/projects/${projectId}`,
        body: {
          name: editName.trim(),
          instructions: editInstructions.trim().length > 0 ? editInstructions.trim() : null,
        },
        csrfToken: csrf,
      });
      setEditId(null);
      return 'Project saved.';
    });

  const grantFolder = (projectId: string) =>
    run(async () => {
      if (!grantPath || grantPath.id !== projectId || grantPath.value.trim().length === 0) {
        return;
      }
      const result = await mutate<{ grant: ProjectFolderGrant }>({
        method: 'POST',
        path: `/api/projects/${projectId}/grants`,
        body: { path: grantPath.value.trim() },
        csrfToken: csrf,
      });
      setGrantPath(null);
      return `Folder granted: ${result.grant.path}`;
    });

  const revokeGrant = (projectId: string, grantId: string, path: string) =>
    run(async () => {
      await mutate({
        method: 'DELETE',
        path: `/api/projects/${projectId}/grants/${grantId}`,
        csrfToken: csrf,
      });
      return `Folder access revoked: ${path}`;
    });

  if (loading || !session || !session.ownerCreated || !session.authenticated) {
    return (
      <div className="panel">
        <h1>Projects</h1>
        <p className="muted">{error ?? 'Checking local session…'}</p>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <h1>Projects</h1>
        <p>
          A project organizes context: standing instructions, granted source folders,
          and the tasks scoped to it. A project-scoped task only ever sees this
          project&apos;s material — never another project&apos;s files or chats. To use
          another project&apos;s files here, grant that folder to this project
          explicitly; nothing crosses scopes on its own.
        </p>
        <p className="note">
          File excerpts from granted folders are sent to the configured model
          provider (see Settings) so it can ground the update. Only text and
          Markdown files are read; credential stores, unsupported files, and
          anything outside a granted folder are refused, and every skipped source
          is reported in the saved update.
        </p>
      </div>

      <div className="panel">
        <h2>New project</h2>
        <label htmlFor="project-name">Name</label>
        <input
          id="project-name"
          value={newName}
          maxLength={200}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Thesis, Side project, Job search…"
        />
        <label htmlFor="project-instructions">Instructions (optional)</label>
        <textarea
          id="project-instructions"
          value={newInstructions}
          maxLength={5000}
          onChange={(e) => setNewInstructions(e.target.value)}
          placeholder="Standing instructions for tasks scoped to this project."
        />
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="primary"
            disabled={busy || !csrf || newName.trim().length === 0}
            onClick={() => void createProject()}
          >
            Create project
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}

      <div className="panel">
        <h2>Your projects</h2>
        {projects === null ? (
          <p className="muted">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="empty">
            <strong>No projects yet.</strong> Create one above, grant a folder of
            notes, then submit a project update from the{' '}
            <Link href="/tasks">tasks page</Link>.
          </p>
        ) : (
          projects.map((project) => (
            <div className="task" data-state="queued" key={project.id}>
              <div className="head">
                <strong>{project.name}</strong>
                <span className="mono muted">
                  {project.grants.length} grant{project.grants.length === 1 ? '' : 's'} ·
                  updated {formatTimestamp(project.updatedAt)}
                </span>
              </div>
              {project.instructions ? (
                <p className="muted">{project.instructions}</p>
              ) : (
                <p className="muted">No instructions set.</p>
              )}
              <h3 className="grant-heading">Granted folders</h3>
              {project.grants.length === 0 ? (
                <p className="muted">
                  No folders granted yet — project updates have nothing to read
                  until one is granted.
                </p>
              ) : (
                project.grants.map((grant) => (
                  <div className="grant-row" key={grant.id}>
                    <span className="mono">{grant.path}</span>
                    <button
                      disabled={busy}
                      onClick={() => void revokeGrant(project.id, grant.id, grant.path)}
                    >
                      Revoke
                    </button>
                  </div>
                ))
              )}
              <div className="row" style={{ marginTop: 8 }}>
                <input
                  style={{ flex: 1 }}
                  value={grantPath?.id === project.id ? grantPath.value : ''}
                  maxLength={1000}
                  onChange={(e) =>
                    setGrantPath({ id: project.id, value: e.target.value })
                  }
                  placeholder="Absolute folder path, e.g. C:\Users\you\Documents\thesis-notes"
                />
                <button
                  disabled={busy || !grantPath || grantPath.id !== project.id || grantPath.value.trim().length === 0}
                  onClick={() => void grantFolder(project.id)}
                >
                  Grant folder
                </button>
              </div>
              <p className="muted">
                The path is canonicalized on save (junctions/symlinks resolve to the
                real folder). Revoked or moved folders stop granting immediately —
                including for tasks already waiting in the queue.
              </p>
              {editId === project.id ? (
                <>
                  <label htmlFor={`edit-name-${project.id}`}>Name</label>
                  <input
                    id={`edit-name-${project.id}`}
                    value={editName}
                    maxLength={200}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                  <label htmlFor={`edit-instructions-${project.id}`}>Instructions</label>
                  <textarea
                    id={`edit-instructions-${project.id}`}
                    value={editInstructions}
                    maxLength={5000}
                    onChange={(e) => setEditInstructions(e.target.value)}
                  />
                  <div className="row" style={{ marginTop: 8 }}>
                    <button
                      className="primary"
                      disabled={busy || editName.trim().length === 0}
                      onClick={() => void saveEdit(project.id)}
                    >
                      Save
                    </button>
                    <button disabled={busy} onClick={() => setEditId(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <div className="row" style={{ marginTop: 8 }}>
                  <button disabled={busy} onClick={() => startEdit(project)}>
                    Edit
                  </button>
                  <Link href="/tasks">
                    <button>Queue a project update</button>
                  </Link>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}
