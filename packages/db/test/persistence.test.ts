import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createStore,
  openDatabase,
  type OpenDatabaseResult,
  type Store,
} from '../src/index.js';

const NOW = '2026-10-23T12:00:00.000Z';

let home: string;
let opened: OpenDatabaseResult;
let store: Store;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'openfrost-db-test-'));
  opened = openDatabase(home);
  store = createStore(opened.db);
});

afterAll(() => {
  opened.sqlite.close();
  rmSync(home, { recursive: true, force: true });
});

describe('persistence across restart', () => {
  it('retains tasks, runs, events, conversations, messages, and artifacts after reopen', () => {
    const restartHome = mkdtempSync(join(tmpdir(), 'openfrost-restart-test-'));
    const first = openDatabase(restartHome);
    const firstStore = createStore(first.db);
    try {
      const conversation = firstStore.conversations.create('Research chat', NOW);
      firstStore.messages.add(conversation.id, 'user', 'Compare options A and B', NOW);

      const task = firstStore.tasks.create(
        { title: 'Compare apps', request: 'Compare A and B for notes.' },
        NOW,
      );
      firstStore.events.append(
        'task.created',
        { taskId: task.id, payload: { title: task.title } },
        NOW,
      );

      const { run } = firstStore.tasks.startRun(task.id, NOW);
      firstStore.runs.finish(run.id, 'completed', NOW, {
        usage: { steps: 2, inputChars: 30, outputChars: 120 },
      });
      const artifact = firstStore.artifacts.create(task.id, '# Report\nDone.', NOW);
      firstStore.tasks.transition(task.id, 'completed', NOW, {
        resultArtifactId: artifact.id,
      });

      // Simulate a full restart: close the handle, reopen the same home.
      first.sqlite.close();
      const reopened = openDatabase(restartHome);
      const store2 = createStore(reopened.db);
      try {
        const taskAfter = store2.tasks.get(task.id);
        expect(taskAfter?.state).toBe('completed');
        expect(taskAfter?.attemptCount).toBe(1);
        expect(taskAfter?.resultArtifactId).toBe(artifact.id);

        const runs = store2.runs.listForTask(task.id);
        expect(runs).toHaveLength(1);
        expect(runs[0]?.usage).toEqual({
          steps: 2,
          inputChars: 30,
          outputChars: 120,
          inputTokens: null,
          outputTokens: null,
        });

        const events = store2.events.listForTask(task.id);
        expect(events.map((e) => e.type)).toContain('task.created');

        const artifactAfter = store2.artifacts.get(artifact.id);
        expect(artifactAfter?.markdown).toBe('# Report\nDone.');

        const messages = store2.messages.listForConversation(conversation.id);
        expect(messages).toHaveLength(1);
        expect(messages[0]?.content).toBe('Compare options A and B');
      } finally {
        reopened.sqlite.close();
      }
    } finally {
      rmSync(restartHome, { recursive: true, force: true });
    }
  });

  it('appends events with monotonically increasing ids', () => {
    const first = store.events.append(
      'dispatch.paused',
      { payload: { reason: 'restart' } },
      NOW,
    );
    const second = store.events.append('dispatch.resumed', {}, NOW);
    expect(second.id).toBeGreaterThan(first.id);
  });

  it('stores and reads non-secret runtime state', () => {
    store.state.setValue('dispatch.paused', 'true');
    expect(store.state.getValue('dispatch.paused')).toBe('true');
    expect(store.state.getValue('missing.key')).toBeNull();
  });
});

describe('owner accounts', () => {
  it('creates exactly one owner and verifies credentials', () => {
    const owner = store.users.createOwner('owner', 'correct horse battery staple', NOW);
    expect(owner.username).toBe('owner');

    expect(() => store.users.createOwner('owner', 'another', NOW)).toThrowError();

    expect(
      store.users.verifyOwnerCredentials('owner', 'correct horse battery staple'),
    ).toBeTruthy();
    expect(store.users.verifyOwnerCredentials('owner', 'wrong')).toBeNull();
    expect(
      store.users.verifyOwnerCredentials('intruder', 'correct horse battery staple'),
    ).toBeNull();
  });

  it('never stores the password in recoverable form', () => {
    const raw = opened.sqlite
      .prepare('SELECT password_hash FROM users')
      .all() as Array<{ password_hash: string }>;
    expect(JSON.stringify(raw)).not.toContain('correct horse battery staple');
    expect(raw[0]?.password_hash.startsWith('scrypt$')).toBe(true);
  });
});

describe('sessions', () => {
  it('creates, touches, and removes sessions', () => {
    const owner = store.users.verifyOwnerCredentials('owner', 'correct horse battery staple');
    expect(owner).not.toBeNull();
    const session = store.sessions.create({
      userId: owner!.id,
      csrfToken: 'token-1',
      expiresAt: '2026-11-23T12:00:00.000Z',
      now: NOW,
    });
    expect(store.sessions.get(session.id)?.csrfToken).toBe('token-1');
    store.sessions.touch(session.id, NOW);
    store.sessions.remove(session.id);
    expect(store.sessions.get(session.id)).toBeNull();
  });

  it('purges expired sessions only', () => {
    const owner = store.users.verifyOwnerCredentials('owner', 'correct horse battery staple');
    const expired = store.sessions.create({
      userId: owner!.id,
      csrfToken: 'expired',
      expiresAt: '2026-10-01T00:00:00.000Z',
      now: NOW,
    });
    const live = store.sessions.create({
      userId: owner!.id,
      csrfToken: 'live',
      expiresAt: '2026-11-23T12:00:00.000Z',
      now: NOW,
    });
    store.sessions.purgeExpired(NOW);
    expect(store.sessions.get(expired.id)).toBeNull();
    expect(store.sessions.get(live.id)).not.toBeNull();
    store.sessions.remove(live.id);
  });
});
