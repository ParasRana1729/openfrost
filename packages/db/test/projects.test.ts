import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createStore,
  openDatabase,
  ProjectNotFoundError,
  type OpenDatabaseResult,
  type Store,
} from '../src/index.js';

const T0 = Date.parse('2026-10-25T12:00:00.000Z');
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

let home: string;
let opened: OpenDatabaseResult;
let store: Store;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'openfrost-projects-test-'));
  opened = openDatabase(home);
  store = createStore(opened.db, { home: opened.home });
});

afterAll(() => {
  opened.sqlite.close();
  rmSync(home, { recursive: true, force: true });
});

describe('project lifecycle through the store', () => {
  it('creates, lists, and updates projects', () => {
    const thesis = store.projects.create(
      { name: 'Thesis', instructions: 'Cite chapter files.' },
      at(0),
    );
    expect(thesis.name).toBe('Thesis');
    expect(thesis.instructions).toBe('Cite chapter files.');

    const journal = store.projects.create({ name: 'Journal' }, at(1));
    expect(journal.instructions).toBeNull();

    expect(store.projects.list().map((p) => p.id)).toEqual([thesis.id, journal.id]);

    const renamed = store.projects.update(
      thesis.id,
      { name: 'Thesis 2026', instructions: null },
      at(2),
    );
    expect(renamed.name).toBe('Thesis 2026');
    expect(renamed.instructions).toBeNull();
    expect(renamed.updatedAt).toBe(at(2));
    expect(store.projects.get(thesis.id)?.name).toBe('Thesis 2026');
  });

  it('throws ProjectNotFoundError for unknown projects', () => {
    expect(store.projects.get('missing')).toBeNull();
    expect(() => store.projects.update('missing', { name: 'x' }, at(3))).toThrowError(
      ProjectNotFoundError,
    );
  });

  it('adds, lists, and removes folder grants scoped to one project', () => {
    const project = store.projects.create({ name: 'Grants' }, at(3));
    const grantA = store.projects.addGrant(project.id, 'C:\\notes\\a', at(4));
    const grantB = store.projects.addGrant(project.id, 'C:\\notes\\b', at(5));

    expect(store.projects.listGrants(project.id).map((g) => g.path)).toEqual([
      'C:\\notes\\a',
      'C:\\notes\\b',
    ]);

    // Grants belong to their project only.
    const other = store.projects.create({ name: 'Other' }, at(6));
    expect(store.projects.listGrants(other.id)).toEqual([]);

    store.projects.removeGrant(project.id, grantA.id);
    expect(store.projects.listGrants(project.id).map((g) => g.id)).toEqual([grantB.id]);
    // Removing a grant from the wrong project is a no-op.
    store.projects.removeGrant(other.id, grantB.id);
    expect(store.projects.listGrants(project.id).map((g) => g.id)).toEqual([grantB.id]);
  });
});

describe('project-scoped tasks and conversations', () => {
  it('persists kind and projectId on tasks', () => {
    const project = store.projects.create({ name: 'Scoped' }, at(7));
    const update = store.tasks.create(
      {
        title: 'Progress update',
        request: 'Read the notes.',
        projectId: project.id,
        kind: 'project_update',
      },
      at(8),
    );
    expect(update.kind).toBe('project_update');
    expect(update.projectId).toBe(project.id);

    const fetched = store.tasks.get(update.id);
    expect(fetched?.kind).toBe('project_update');
    expect(fetched?.projectId).toBe(project.id);

    const brief = store.tasks.create({ title: 'Research', request: 'r' }, at(9));
    expect(brief.kind).toBe('research_brief');
    expect(brief.projectId).toBeNull();
  });

  it('scopes conversations to a project and never leaks across projects', () => {
    const alpha = store.projects.create({ name: 'Alpha' }, at(10));
    const beta = store.projects.create({ name: 'Beta' }, at(11));

    const alphaChat = store.conversations.create('Alpha chat', at(12), alpha.id);
    const betaChat = store.conversations.create('Beta chat', at(13), beta.id);
    const globalChat = store.conversations.create('Unscoped chat', at(14));

    const alphaList = store.conversations.listByProject(alpha.id);
    expect(alphaList.map((c) => c.id)).toEqual([alphaChat.id]);
    expect(alphaList.map((c) => c.title)).not.toContain(betaChat.title);

    const betaList = store.conversations.listByProject(beta.id);
    expect(betaList.map((c) => c.id)).toEqual([betaChat.id]);
    expect(betaList.map((c) => c.title)).not.toContain('Alpha chat');

    // Unscoped conversations are visible in the unfiltered list only.
    expect(store.conversations.list().map((c) => c.id)).toEqual([
      globalChat.id,
      betaChat.id,
      alphaChat.id,
    ]);
    expect(store.conversations.get(alphaChat.id)?.projectId).toBe(alpha.id);
  });
});
