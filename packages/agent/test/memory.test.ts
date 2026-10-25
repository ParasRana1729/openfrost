import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MEMORY_MAX_PROPOSALS_PER_RUN, type Task } from '@openfrost/domain';
import {
  createStore,
  openDatabase,
  type OpenDatabaseResult,
  type Store,
} from '@openfrost/db';
import {
  FakeProvider,
  TaskExecutor,
  createProposeMemoryTool,
  type RunToolContext,
  type ScriptedStep,
} from '../src/index.js';

const T0 = Date.parse('2026-10-25T12:00:00.000Z');
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

interface Fixture {
  home: string;
  opened: OpenDatabaseResult;
  store: Store;
}

const fixtures: Fixture[] = [];

function openFixture(label: string): Fixture {
  const home = mkdtempSync(join(tmpdir(), `openfrost-agent-memory-${label}-`));
  const opened = openDatabase(home);
  const store = createStore(opened.db, { home: opened.home });
  const fixture = { home, opened, store };
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    if (!fixture) {
      continue;
    }
    fixture.opened.sqlite.close();
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

const emptyCtx: RunToolContext = {
  recordRetrieval: () => undefined,
  recordFileAccess: () => undefined,
};

function runTool(
  store: Store,
  task: Task,
  args: unknown,
  runId = 'run-memory',
): Promise<{ ok: boolean; content: string }> {
  const tool = createProposeMemoryTool({
    store,
    task,
    runId,
    now: () => at(0),
  });
  return tool.execute(JSON.stringify(args), emptyCtx, new AbortController().signal);
}

function userMessages(provider: FakeProvider): string[] {
  return provider.calls.flatMap((call) =>
    call.messages.filter((message) => message.role === 'user').map((message) => message.content),
  );
}

function makeExecutor(
  store: Store,
  steps: ScriptedStep[],
): { executor: TaskExecutor; provider: FakeProvider } {
  const provider = new FakeProvider(steps);
  const executor = new TaskExecutor({
    store,
    provider,
    now: () => at(0),
  });
  return { executor, provider };
}

async function approveMemory(
  store: Store,
  content: string,
  scope: 'global' | 'project' = 'global',
  projectId: string | null = null,
): Promise<string> {
  const proposal = store.memory.createProposal(
    {
      scope,
      projectId,
      content,
      source: {
        kind: 'task',
        taskId: 'seed-task',
        artifactId: null,
        label: 'Seed memory',
      },
      sourceRunId: null,
    },
    at(0),
  );
  const file = store.memory.readFileView(scope, projectId);
  const approved = store.memory.approveProposal(
    proposal.id,
    { expectedFileSha256: file.sha256 },
    at(1),
  );
  return approved.entry.id;
}describe('propose_memory tool', () => {
  it('creates a pending proposal and emits metadata without the proposed text', async () => {
    const { store } = openFixture('tool');
    const task = store.tasks.create(
      { title: 'Analyze sources', request: 'Analyze these sources.' },
      at(0),
    );
    const text = 'Prefer primary sources over summaries.';

    const result = await runTool(store, task, { scope: 'global', content: text });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.content) as {
      status: string;
      proposalId: string;
      scope: string;
    };
    expect(parsed).toMatchObject({ status: 'pending_owner_approval', scope: 'global' });
    expect(store.memory.getProposal(parsed.proposalId)).toMatchObject({
      state: 'pending',
      content: text,
      source: {
        kind: 'task',
        taskId: task.id,
        artifactId: null,
        label: 'Analyze sources',
      },
      sourceRunId: 'run-memory',
    });
    expect(store.memory.contextForTask(null).text).toBe('');

    const event = store.events
      .listForTask(task.id)
      .find((candidate) => candidate.type === 'memory.proposed');
    expect(event?.payload).toMatchObject({
      proposalId: parsed.proposalId,
      scope: 'global',
      projectId: null,
      contentChars: text.length,
    });
    expect(JSON.stringify(event?.payload)).not.toContain(text);
  });

  it('blocks credential material and reports only a category', async () => {
    const { store } = openFixture('tool-secret');
    const task = store.tasks.create(
      { title: 'Secret test', request: 'Request.' },
      at(0),
    );
    const key = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz'].join('-');

    const result = await runTool(store, task, {
      scope: 'global',
      content: `Remember ${key}`,
    });
    expect(result.ok).toBe(false);
    expect(result.content).toContain('credential');
    expect(result.content).not.toContain(key);
    expect(store.memory.listProposals()).toEqual([]);

    const event = store.events
      .listForTask(task.id)
      .find((candidate) => candidate.type === 'memory.proposal_blocked');
    expect(event?.payload).toMatchObject({ scope: 'global' });
    expect(String(event?.payload['reason'])).toContain('OpenAI-style');
    expect(JSON.stringify(event?.payload)).not.toContain(key);
  });

  it('refuses project memory from an unscoped task', async () => {
    const { store } = openFixture('tool-scope');
    const task = store.tasks.create(
      { title: 'Unscoped task', request: 'Request.' },
      at(0),
    );

    const result = await runTool(store, task, {
      scope: 'project',
      content: 'This project uses a March deadline.',
    });
    expect(result.ok).toBe(false);
    expect(result.content).toContain('scoped to a project');
    expect(store.memory.listProposals()).toEqual([]);
    expect(
      store.events
        .listForTask(task.id)
        .some((event) => event.type === 'memory.proposal_blocked'),
    ).toBe(true);
  });

  it('accepts at most the per-run proposal limit', async () => {
    const { store } = openFixture('tool-limit');
    const task = store.tasks.create(
      { title: 'Limit test', request: 'Request.' },
      at(0),
    );
    const tool = createProposeMemoryTool({
      store,
      task,
      runId: 'run-limit',
      now: () => at(0),
    });
    for (let index = 0; index < MEMORY_MAX_PROPOSALS_PER_RUN; index += 1) {
      const result = await tool.execute(
        JSON.stringify({ scope: 'global', content: `Durable preference ${index}.` }),
        emptyCtx,
        new AbortController().signal,
      );
      expect(result.ok).toBe(true);
    }
    const refused = await tool.execute(
      JSON.stringify({ scope: 'global', content: 'One preference too many.' }),
      emptyCtx,
      new AbortController().signal,
    );
    expect(refused.ok).toBe(false);
    expect(refused.content).toContain('already proposed');
    expect(store.memory.listProposals()).toHaveLength(MEMORY_MAX_PROPOSALS_PER_RUN);
  });
});

describe('executor memory integration', () => {
  it('adds approved global and active-project memory to prompts but nothing else', async () => {
    const { store } = openFixture('executor-context');
    const alpha = store.projects.create({ name: 'Alpha' }, at(0));
    const beta = store.projects.create({ name: 'Beta' }, at(1));
    await approveMemory(store, 'Prefer concise, evidence-first briefs.');
    await approveMemory(store, 'Alpha ships on Fridays.', 'project', alpha.id);
    await approveMemory(store, 'Beta prefers blue diagrams.', 'project', beta.id);
    store.memory.createProposal(
      {
        scope: 'global',
        projectId: null,
        content: 'PENDING-MEMORY-MUST-NOT-APPEAR',
        source: {
          kind: 'task',
          taskId: 'seed-task',
          artifactId: null,
          label: 'Pending seed',
        },
        sourceRunId: null,
      },
      at(2),
    );

    const { executor, provider } = makeExecutor(store, [
      { type: 'final', text: 'Alpha brief.' },
      { type: 'final', text: 'Unscoped brief.' },
    ]);
    const alphaTask = await executor.enqueue({
      title: 'Alpha brief',
      request: 'Summarize Alpha.',
      projectId: alpha.id,
    });
    const unscopedTask = await executor.enqueue({
      title: 'General brief',
      request: 'Summarize generally.',
    });
    await executor.whenIdle();

    const prompts = userMessages(provider);
    expect(prompts[0]).toContain('Prefer concise, evidence-first briefs.');
    expect(prompts[0]).toContain('Alpha ships on Fridays.');
    expect(prompts[0]).not.toContain('Beta prefers blue diagrams.');
    expect(prompts[0]).not.toContain('PENDING-MEMORY-MUST-NOT-APPEAR');
    expect(prompts[1]).toContain('Prefer concise, evidence-first briefs.');
    expect(prompts[1]).not.toContain('Alpha ships on Fridays.');
    expect(prompts[1]).not.toContain('Beta prefers blue diagrams.');
    expect(prompts[1]).not.toContain('PENDING-MEMORY-MUST-NOT-APPEAR');

    const alphaUsed = store.events
      .listForTask(alphaTask.id)
      .find((event) => event.type === 'memory.used');
    expect(alphaUsed?.payload).toMatchObject({
      globalEntries: 1,
      projectEntries: 1,
      chars: expect.any(Number),
      truncated: false,
    });
    const unscopedUsed = store.events
      .listForTask(unscopedTask.id)
      .find((event) => event.type === 'memory.used');
    expect(unscopedUsed?.payload).toMatchObject({
      globalEntries: 1,
      projectEntries: 0,
    });
  });

  it('offers propose_memory on research and project-update runs', async () => {
    const { store } = openFixture('executor-tools');
    const project = store.projects.create({ name: 'Tools project' }, at(0));
    const grantRoot = mkdtempSync(join(tmpdir(), 'openfrost-memory-notes-'));
    try {
      writeNotes(grantRoot);
      store.projects.addGrant(project.id, grantRoot, at(1));

      const { executor, provider } = makeExecutor(store, [
        { type: 'final', text: 'Research result.' },
        { type: 'final', text: 'Update result.' },
      ]);
      await executor.enqueue({ title: 'Research', request: 'Research.' });
      await executor.enqueue({
        title: 'Update',
        request: 'Update the project.',
        kind: 'project_update',
        projectId: project.id,
      });
      await executor.whenIdle();

      const toolNames = provider.calls.map((call) => call.tools.map((tool) => tool.name));
      expect(toolNames[0]).toContain('propose_memory');
      expect(toolNames[1]).toContain('propose_memory');
      expect(toolNames[1]).toContain('read_project_file');
    } finally {
      rmSync(grantRoot, { recursive: true, force: true });
    }
  });

  it('persists a run proposal as pending, then retrieves it only after approval', async () => {
    const { store } = openFixture('executor-proposal');
    const proposalText = 'Prefer dated updates in every report.';
    const first = makeExecutor(store, [
      {
        type: 'tool_calls',
        calls: [
          {
            name: 'propose_memory',
            argsJson: JSON.stringify({ scope: 'global', content: proposalText }),
          },
        ],
      },
      { type: 'final', text: 'First result.' },
      { type: 'final', text: 'Second result.' },
    ]);
    const firstTask = await first.executor.enqueue({
      title: 'First run',
      request: 'Produce a brief.',
    });
    await first.executor.whenIdle();

    const pending = store.memory.listProposals(['pending']);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.content).toBe(proposalText);
    expect(first.provider.calls[1]?.messages.some(
      (message) => message.role === 'user' && message.content.includes(proposalText),
    )).toBe(false);
    expect(
      store.events
        .listForTask(firstTask.id)
        .some((event) => event.type === 'memory.proposed'),
    ).toBe(true);

    const pendingProposal = pending[0];
    if (!pendingProposal) {
      throw new Error('expected a pending proposal');
    }
    store.memory.approveProposal(
      pendingProposal.id,
      { expectedFileSha256: null },
      at(2),
    );

    const second = makeExecutor(store, [{ type: 'final', text: 'Second result.' }]);
    const secondTask = await second.executor.enqueue({
      title: 'Second run',
      request: 'Produce another brief.',
    });
    await second.executor.whenIdle();
    const prompt = userMessages(second.provider)[0] ?? '';
    expect(prompt).toContain(proposalText);
    expect(
      store.events
        .listForTask(secondTask.id)
        .some((event) => event.type === 'memory.used'),
    ).toBe(true);
  });
});

function writeNotes(root: string): void {
  writeFileSync(join(root, 'notes.md'), 'Notes for the memory tool test.', 'utf8');
}
