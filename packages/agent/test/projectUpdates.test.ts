import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProviderStepRequest, ProviderStepResult, ProviderUsage } from '@openfrost/domain';
import { createStore, openDatabase, type OpenDatabaseResult, type Store } from '@openfrost/db';
import { TaskExecutor, type LlmProvider } from '../src/index.js';

const T0 = Date.parse('2026-10-25T12:00:00.000Z');
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

const NO_TOKENS: ProviderUsage = { inputTokens: null, outputTokens: null };

let home: string;
let opened: OpenDatabaseResult;
let store: Store;
let notesRoot: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'openfrost-pupdates-test-'));
  opened = openDatabase(home);
  store = createStore(opened.db);
  notesRoot = mkdtempSync(join(tmpdir(), 'openfrost-pupdates-notes-'));
});

afterAll(() => {
  opened.sqlite.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(notesRoot, { recursive: true, force: true });
});

interface NotesDir {
  root: string;
  file: string;
}

function makeNotes(name: string, noteBody: string): NotesDir {
  const root = join(notesRoot, name);
  fs.mkdirSync(root, { recursive: true });
  const file = join(root, 'notes.md');
  fs.writeFileSync(file, noteBody);
  return { root: fs.realpathSync(root), file: fs.realpathSync(file) };
}

function makeExecutor(provider: LlmProvider): TaskExecutor {
  return new TaskExecutor({
    store,
    provider,
    now: () => at(0),
  });
}

function readToolCall(path: string): { id: string; name: string; argsJson: string } {
  return { id: `call-${path}`, name: 'read_project_file', argsJson: JSON.stringify({ path }) };
}

describe('project update runs', () => {
  it('enumerates granted files, reads one, and saves an update with a runtime file appendix', async () => {
    const notes = makeNotes('solo', '## Progress\n\nThe parser module passed review.');
    const project = store.projects.create(
      { name: 'Solo', instructions: 'Quote sparingly.' },
      at(0),
    );
    store.projects.addGrant(project.id, notes.root, at(1));
    fs.writeFileSync(join(notes.root, 'scratch.log'), 'not a note');

    const calls: ProviderStepRequest[] = [];
    const provider: LlmProvider = {
      name: 'scripted',
      async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
        calls.push(request);
        if (request.step === 1) {
          return {
            kind: 'tool_calls',
            calls: [readToolCall(notes.file)],
            searches: 0,
            usage: NO_TOKENS,
          };
        }
        return {
          kind: 'final',
          text: 'Update: the notes state the parser module passed review.',
          citations: [],
          usage: NO_TOKENS,
        };
      },
    };
    const executor = makeExecutor(provider);
    const task = await executor.enqueue({
      title: 'Weekly project update',
      request: 'Prepare a progress update.',
      projectId: project.id,
      kind: 'project_update',
    });
    await executor.whenIdle();

    expect(store.tasks.get(task.id)?.state).toBe('completed');
    // The first user message carries the project instructions and inventory.
    const firstUser = providerStepUsers(calls)[0];
    expect(firstUser).toContain('Quote sparingly.');
    expect(firstUser).toContain(notes.file);
    expect(firstUser).toContain('skipped: unsupported file type');

    const artifact = store.artifacts.latestForTask(task.id);
    expect(artifact?.kind).toBe('project_update');
    expect(artifact?.markdown).toContain('the notes state the parser module passed review');
    expect(artifact?.markdown).toContain('## Project files consulted');
    expect(artifact?.markdown).toContain(`${notes.file} — read,`);
    expect(artifact?.markdown).toContain('scratch.log — skipped: unsupported file type');
    // Project updates are file-grounded; no web retrieval appendix.
    expect(artifact?.markdown).not.toContain('## Retrieved sources');
  });

  it('keeps two projects isolated: chats, files, and instructions never cross scopes', async () => {
    const alpha = makeNotes('alpha', 'Alpha internal note.');
    const beta = makeNotes('beta', 'Beta internal note.');
    const projectA = store.projects.create(
      { name: 'Alpha', instructions: 'ALPHA-ONLY-INSTRUCTIONS' },
      at(2),
    );
    store.projects.addGrant(projectA.id, alpha.root, at(3));
    const projectB = store.projects.create(
      { name: 'Beta', instructions: 'BETA-ONLY-INSTRUCTIONS' },
      at(4),
    );
    store.projects.addGrant(projectB.id, beta.root, at(5));

    const calls: ProviderStepRequest[] = [];
    const provider: LlmProvider = {
      name: 'scripted',
      async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
        calls.push(request);
        if (request.step === 1) {
          // The model attempts to cross into project B's file first; the tool
          // must refuse because only project A's grants are bound to this run.
          return {
            kind: 'tool_calls',
            calls: [readToolCall(beta.file), readToolCall(alpha.file)],
            searches: 0,
            usage: NO_TOKENS,
          };
        }
        return { kind: 'final', text: 'Alpha update.', citations: [], usage: NO_TOKENS };
      },
    };
    const executor = makeExecutor(provider);
    const task = await executor.enqueue({
      title: 'Alpha update',
      request: 'Update from Alpha notes only.',
      projectId: projectA.id,
      kind: 'project_update',
    });
    await executor.whenIdle();

    expect(store.tasks.get(task.id)?.state).toBe('completed');
    const firstUser = providerStepUsers(calls)[0];
    expect(firstUser).toContain('ALPHA-ONLY-INSTRUCTIONS');
    expect(firstUser).toContain(alpha.file);
    // Project B's instructions and files never entered the context.
    expect(firstUser).not.toContain('BETA-ONLY-INSTRUCTIONS');
    expect(firstUser).not.toContain(beta.file);
    expect(firstUser).not.toContain('Beta internal note.');

    const artifact = store.artifacts.latestForTask(task.id);
    expect(artifact?.markdown).toContain(`${alpha.file} — read,`);
    expect(artifact?.markdown).toContain('FAILED');
    expect(artifact?.markdown).not.toContain(`${beta.file} — read,`);
    // The cross-project read attempt is visible in the activity log as refused.
    const refused = store.events
      .listForTask(task.id)
      .filter((e) => e.type === 'tool.executed' && e.payload['ok'] === false);
    expect(refused.length).toBeGreaterThan(0);
  });

  it('fails a queued project update with source_unavailable when grants were revoked before dispatch', async () => {
    const notes = makeNotes('revoked-early', 'Note.');
    const project = store.projects.create({ name: 'RevokedEarly' }, at(6));
    const grant = store.projects.addGrant(project.id, notes.root, at(7));

    const calls: ProviderStepRequest[] = [];
    const provider: LlmProvider = {
      name: 'scripted',
      async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
        calls.push(request);
        throw new Error('the model must not be called');
      },
    };
    const executor = makeExecutor(provider);
    executor.pauseDispatch('test: hold queue');
    const task = await executor.enqueue({
      title: 'Queued update',
      request: 'Update.',
      projectId: project.id,
      kind: 'project_update',
    });
    // The grant is revoked while the task waits in the queue.
    store.projects.removeGrant(project.id, grant.id);
    executor.resumeDispatch();
    await executor.whenIdle();

    const failed = store.tasks.get(task.id);
    expect(failed?.state).toBe('failed');
    const run = store.runs.get(failed?.lastRunId ?? '');
    expect(run?.failure?.code).toBe('source_unavailable');
    expect(run?.failure?.message).toContain('no granted folders');
    expect(calls).toHaveLength(0);
  });

  it('rechecks grants at tool execution when a grant is revoked mid-run', async () => {
    const notes = makeNotes('revoked-mid', 'First note.');
    const second = makeNotes('revoked-mid-second', 'Second note.');
    const project = store.projects.create({ name: 'RevokedMid' }, at(8));
    const grantA = store.projects.addGrant(project.id, notes.root, at(9));
    store.projects.addGrant(project.id, second.root, at(10));

    const calls: ProviderStepRequest[] = [];
    const provider: LlmProvider = {
      name: 'scripted',
      async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
        calls.push(request);
        if (request.step === 1) {
          return {
            kind: 'tool_calls',
            calls: [readToolCall(notes.file)],
            searches: 0,
            usage: NO_TOKENS,
          };
        }
        if (request.step === 2) {
          // Revoke one grant between steps; the next read must fail even
          // though it was queued as part of this same run.
          store.projects.removeGrant(project.id, grantA.id);
          return {
            kind: 'tool_calls',
            calls: [readToolCall(notes.file)],
            searches: 0,
            usage: NO_TOKENS,
          };
        }
        return { kind: 'final', text: 'Partial update with what was readable.', citations: [], usage: NO_TOKENS };
      },
    };
    const executor = makeExecutor(provider);
    const task = await executor.enqueue({
      title: 'Mid-run revocation',
      request: 'Update.',
      projectId: project.id,
      kind: 'project_update',
    });
    await executor.whenIdle();

    expect(store.tasks.get(task.id)?.state).toBe('completed');
    const artifact = store.artifacts.latestForTask(task.id);
    // The first read succeeded before revocation; the post-revocation
    // re-check refused the same file, and the appendix's most recent outcome
    // shows that honestly.
    expect(artifact?.markdown).toContain(
      `${notes.file} — FAILED: Blocked: path is outside the folders currently granted to this project`,
    );
  });

  it('gives research briefs scoped to a project its instructions but no file tools', async () => {
    const notes = makeNotes('brief-scope', 'Scoped note.');
    const project = store.projects.create(
      { name: 'BriefScope', instructions: 'BRIEF-SCOPE-INSTRUCTIONS' },
      at(11),
    );
    store.projects.addGrant(project.id, notes.root, at(12));

    const calls: ProviderStepRequest[] = [];
    let toolNames: string[] = [];
    const provider: LlmProvider = {
      name: 'scripted',
      async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
        calls.push(request);
        if (request.step === 1) {
          toolNames = request.tools.map((t) => t.name);
          return {
            kind: 'tool_calls',
            calls: [{ id: 'c1', name: 'read_project_file', argsJson: '{"path":"C:\\\\nowhere.md"}' }],
            searches: 0,
            usage: NO_TOKENS,
          };
        }
        return { kind: 'final', text: 'Brief text.', citations: [], usage: NO_TOKENS };
      },
    };
    const executor = makeExecutor(provider);
    const task = await executor.enqueue({
      title: 'Scoped brief',
      request: 'Research with project context.',
      projectId: project.id,
    });
    await executor.whenIdle();

    expect(store.tasks.get(task.id)?.state).toBe('completed');
    expect(providerStepUsers(calls)[0]).toContain('BRIEF-SCOPE-INSTRUCTIONS');
    expect(toolNames).toContain('fetch_page');
    expect(toolNames).not.toContain('read_project_file');
    // The unknown tool was refused visibly and the brief saved anyway.
    const refused = store.events
      .listForTask(task.id)
      .filter((e) => e.type === 'tool.executed' && e.payload['ok'] === false);
    expect(refused).toHaveLength(1);
    expect(store.artifacts.latestForTask(task.id)?.kind).toBe('report');
    expect(notes.file).toBeTruthy();
  });

  it('fails a project update for a project without any grants', async () => {
    const project = store.projects.create({ name: 'NoGrants' }, at(13));
    const calls: ProviderStepRequest[] = [];
    const provider: LlmProvider = {
      name: 'scripted',
      async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
        calls.push(request);
        throw new Error('the model must not be called');
      },
    };
    const executor = makeExecutor(provider);
    const task = await executor.enqueue({
      title: 'Empty project update',
      request: 'Update.',
      projectId: project.id,
      kind: 'project_update',
    });
    await executor.whenIdle();

    const failed = store.tasks.get(task.id);
    expect(failed?.state).toBe('failed');
    expect(store.runs.get(failed?.lastRunId ?? '')?.failure?.code).toBe('source_unavailable');
    expect(calls).toHaveLength(0);
  });
});

/** User-message contents seen by a scripted provider, in call order. */
function providerStepUsers(calls: ProviderStepRequest[]): string[] {
  return calls
    .flatMap((call) => call.messages.filter((m) => m.role === 'user'))
    .map((m) => (m as { content: string }).content);
}
