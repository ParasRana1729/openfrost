import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Routine } from '@openfrost/domain';
import { createStore, openDatabase, type OpenDatabaseResult, type Store } from '@openfrost/db';
import {
  RECENT_UPDATES_HEADING,
  TaskExecutor,
  type LlmProvider,
  type ProviderStepRequest,
  type ProviderStepResult,
  type ProviderUsage,
} from '../src/index.js';

const T0 = Date.parse('2026-10-25T12:00:00.000Z');
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

const NO_TOKENS: ProviderUsage = { inputTokens: null, outputTokens: null };

let home: string;
let opened: OpenDatabaseResult;
let store: Store;
let notesRoot: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'openfrost-wplans-test-'));
  opened = openDatabase(home);
  store = createStore(opened.db, { home: opened.home });
  notesRoot = mkdtempSync(join(tmpdir(), 'openfrost-wplans-notes-'));
});

afterAll(() => {
  opened.sqlite.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(notesRoot, { recursive: true, force: true });
});

function makeNotes(name: string, noteBody: string): { root: string; file: string } {
  const root = join(notesRoot, name);
  fs.mkdirSync(root, { recursive: true });
  const file = join(root, 'notes.md');
  fs.writeFileSync(file, noteBody);
  return { root: fs.realpathSync(root), file: fs.realpathSync(file) };
}

function makeRoutine(projectId: string, name = 'Friday planning'): Routine {
  return store.routines.create(
    {
      name,
      projectId,
      timezone: 'UTC',
      schedule: { kind: 'weekly', weekday: 5, time: '09:00' },
      template: {
        title: 'Draft next week priorities',
        request: 'Review notes and recent updates; draft next week priorities.',
        constraints: null,
      },
    },
    at(0),
  );
}

/** Seeds one saved project-update artifact for a project. */
function seedUpdate(projectId: string, markdown: string, time: string): string {
  const task = store.tasks.create(
    {
      title: 'Project update',
      request: 'Update.',
      kind: 'project_update',
      projectId,
    },
    time,
  );
  store.tasks.transition(task.id, 'running', time);
  const artifact = store.artifacts.create(task.id, markdown, time, 'project_update');
  store.tasks.transition(task.id, 'completed', time, {
    resultArtifactId: artifact.id,
  });
  return artifact.id;
}

function scriptedProvider(
  file: string,
  calls: ProviderStepRequest[],
): LlmProvider {
  return {
    name: 'scripted',
    async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
      calls.push(request);
      if (request.step === 1) {
        return {
          kind: 'tool_calls',
          calls: [
            {
              id: 'c1',
              name: 'read_project_file',
              argsJson: JSON.stringify({ path: file }),
            },
          ],
          searches: 0,
          usage: NO_TOKENS,
        };
      }
      return {
        kind: 'final',
        text: 'Draft priorities: confirm the plan with the owner.',
        citations: [],
        usage: NO_TOKENS,
      };
    },
  };
}

function makeExecutor(provider: LlmProvider): TaskExecutor {
  return new TaskExecutor({ store, provider, now: () => at(0) });
}

/** User-message contents seen by a scripted provider, in call order. */
function providerStepUsers(calls: ProviderStepRequest[]): string[] {
  return calls
    .flatMap((call) => call.messages.filter((m) => m.role === 'user'))
    .map((m) => (m as { content: string }).content);
}

describe('weekly plan runs', () => {
  it('dispatches from a routine with template, project scope, and routine linkage', async () => {
    const notes = makeNotes('dispatch', 'Note.');
    const project = store.projects.create({ name: 'Dispatch' }, at(0));
    store.projects.addGrant(project.id, notes.root, at(1));
    const routine = makeRoutine(project.id);

    const executor = makeExecutor(scriptedProvider(notes.file, []));
    const task = await executor.enqueueRoutineOccurrence({
      routine,
      occurrenceKey: '2026-10-23',
      scheduledFor: '2026-10-23T09:00:00.000Z',
    });
    expect(task.kind).toBe('weekly_plan');
    expect(task.projectId).toBe(project.id);
    expect(task.routineId).toBe(routine.id);
    expect(task.title).toBe('Draft next week priorities — 2026-10-23');
    expect(task.request).toBe(routine.template.request);
    await executor.whenIdle();
    expect(store.tasks.get(task.id)?.state).toBe('completed');
  });

  it('grounds the prompt in granted files and recent same-project updates', async () => {
    const notes = makeNotes('grounded', '## Progress\n\nParser landed per notes.');
    const project = store.projects.create(
      { name: 'Grounded', instructions: 'Keep plans realistic.' },
      at(2),
    );
    store.projects.addGrant(project.id, notes.root, at(3));
    const updateId = seedUpdate(
      project.id,
      '# Update — parser\n\nThe notes state the parser shipped.',
      at(4),
    );
    // A different project's update must never enter this run's context.
    const other = store.projects.create({ name: 'Other' }, at(5));
    const otherUpdate = seedUpdate(other.id, 'OTHER-PROJECT-UPDATE-SECRET', at(6));

    const calls: ProviderStepRequest[] = [];
    const executor = makeExecutor(scriptedProvider(notes.file, calls));
    const routine = makeRoutine(project.id);
    const task = await executor.enqueueRoutineOccurrence({
      routine,
      occurrenceKey: '2026-10-23',
      scheduledFor: '2026-10-23T09:00:00.000Z',
    });
    await executor.whenIdle();

    expect(store.tasks.get(task.id)?.state).toBe('completed');
    const firstUser = providerStepUsers(calls)[0];
    const system = calls[0].messages[0]?.content ?? '';
    expect(system).toContain('Draft priorities for next week');
    expect(firstUser).toContain('Keep plans realistic.');
    expect(firstUser).toContain(RECENT_UPDATES_HEADING);
    expect(firstUser).toContain('The notes state the parser shipped.');
    expect(firstUser).toContain(notes.file);
    expect(firstUser).not.toContain('OTHER-PROJECT-UPDATE-SECRET');

    const artifact = store.artifacts.latestForTask(task.id);
    expect(artifact?.kind).toBe('weekly_plan');
    expect(artifact?.markdown).toContain('## Project files consulted');
    expect(artifact?.markdown).toContain(`${notes.file} — read,`);
    expect(artifact?.markdown).toContain('## Updates consulted');
    expect(artifact?.markdown).toContain(updateId);
    expect(artifact?.markdown).not.toContain(otherUpdate);
    // Weekly plans are internal drafts; no web retrieval appendix.
    expect(artifact?.markdown).not.toContain('## Retrieved sources');
  });

  it('truncates long updates in context and discloses it in the appendix', async () => {
    const notes = makeNotes('trunc', 'Short note.');
    const project = store.projects.create({ name: 'Trunc' }, at(7));
    store.projects.addGrant(project.id, notes.root, at(8));
    const longBody = `# Long update\n\n${'x'.repeat(6_000)}`;
    seedUpdate(project.id, longBody, at(9));

    const calls: ProviderStepRequest[] = [];
    const executor = makeExecutor(scriptedProvider(notes.file, calls));
    const task = await executor.enqueueRoutineOccurrence({
      routine: makeRoutine(project.id),
      occurrenceKey: '2026-10-23',
      scheduledFor: '2026-10-23T09:00:00.000Z',
    });
    await executor.whenIdle();

    const firstUser = providerStepUsers(calls)[0];
    expect(firstUser).toContain('[...truncated...]');
    expect(firstUser.length).toBeLessThan(6_000 + 2_000);
    const artifact = store.artifacts.latestForTask(task.id);
    expect(artifact?.markdown).toContain('chars, truncated');
  });

  it('runs with notes only when no update is on record, disclosing the gap', async () => {
    const notes = makeNotes('notes-only', 'Only notes exist.');
    const project = store.projects.create({ name: 'NotesOnly' }, at(10));
    store.projects.addGrant(project.id, notes.root, at(11));

    const calls: ProviderStepRequest[] = [];
    const executor = makeExecutor(scriptedProvider(notes.file, calls));
    const task = await executor.enqueueRoutineOccurrence({
      routine: makeRoutine(project.id),
      occurrenceKey: '2026-10-23',
      scheduledFor: '2026-10-23T09:00:00.000Z',
    });
    await executor.whenIdle();

    expect(store.tasks.get(task.id)?.state).toBe('completed');
    const firstUser = providerStepUsers(calls)[0];
    expect(firstUser).toContain(RECENT_UPDATES_HEADING);
    expect(firstUser).toContain('(no saved project updates on record yet)');
    const artifact = store.artifacts.latestForTask(task.id);
    expect(artifact?.markdown).toContain(
      'No saved project updates were on record for this run.',
    );
  });

  it('fails with source_unavailable when there are no readable files and no updates', async () => {
    const project = store.projects.create({ name: 'NothingToPlan' }, at(12));
    const calls: ProviderStepRequest[] = [];
    const provider: LlmProvider = {
      name: 'scripted',
      async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
        calls.push(request);
        throw new Error('the model must not be called');
      },
    };
    const executor = makeExecutor(provider);
    const task = await executor.enqueueRoutineOccurrence({
      routine: makeRoutine(project.id),
      occurrenceKey: '2026-10-23',
      scheduledFor: '2026-10-23T09:00:00.000Z',
    });
    await executor.whenIdle();

    const failed = store.tasks.get(task.id);
    expect(failed?.state).toBe('failed');
    const run = store.runs.get(failed?.lastRunId ?? '');
    expect(run?.failure?.code).toBe('source_unavailable');
    expect(calls).toHaveLength(0);
  });
});
