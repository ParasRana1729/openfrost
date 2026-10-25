import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXECUTION_LIMITS,
  TASK_TRANSITIONS,
  InvalidTransitionError,
  canTransition,
  createTaskRequestSchema,
  executionLimitsSchema,
  taskSchema,
  transitionTask,
  type Task,
} from '../src/index.js';

const NOW = '2026-10-23T12:00:00.000Z';

function sampleTask(overrides: Partial<Task> = {}): Task {
  return taskSchema.parse({
    id: 'task-1',
    title: 'Compare note-taking apps',
    request: 'Compare Obsidian, Logseq, and Notion for research notes.',
    constraints: null,
    startingUrls: null,
    projectId: null,
    kind: 'research_brief',
    state: 'queued',
    attemptCount: 0,
    lastRunId: null,
    resultArtifactId: null,
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

describe('task schema', () => {
  it('accepts a valid task and produces a typed entity', () => {
    const task = sampleTask();
    expect(task.id).toBe('task-1');
    expect(task.state).toBe('queued');
  });

  it('rejects unknown fields (strict contract)', () => {
    expect(() =>
      taskSchema.parse({ ...sampleTask(), surprise: true }),
    ).toThrowError();
  });

  it('rejects an invalid state', () => {
    expect(() => sampleTask({ state: 'finished' })).toThrowError();
  });

  it('rejects a negative attempt count and empty ids', () => {
    expect(() => sampleTask({ attemptCount: -1 })).toThrowError();
    expect(() => sampleTask({ id: '' })).toThrowError();
  });

  it('rejects an empty request', () => {
    expect(() => sampleTask({ request: '' })).toThrowError();
  });
});

describe('createTaskRequest schema', () => {
  it('accepts title and request within the input bound', () => {
    expect(
      createTaskRequestSchema.parse({
        title: 'Research',
        request: 'a'.repeat(DEFAULT_EXECUTION_LIMITS.maxInputChars),
      }),
    ).toBeTruthy();
  });

  it('accepts optional constraints and http(s) starting urls', () => {
    const parsed = createTaskRequestSchema.parse({
      title: 'Research',
      request: 'Compare options',
      constraints: 'Prefer tools with local-first storage; budget under $20/month.',
      startingUrls: ['https://obsidian.md/', 'https://logseq.com/'],
    });
    expect(parsed.constraints).toContain('local-first');
    expect(parsed.startingUrls).toHaveLength(2);
  });

  it('rejects non-http(s) starting urls, bad urls, and more than five', () => {
    const base = { title: 'Research', request: 'Compare options' };
    expect(() =>
      createTaskRequestSchema.parse({ ...base, startingUrls: ['ftp://example.com/x'] }),
    ).toThrowError();
    expect(() =>
      createTaskRequestSchema.parse({ ...base, startingUrls: ['not a url'] }),
    ).toThrowError();
    expect(() =>
      createTaskRequestSchema.parse({
        ...base,
        startingUrls: [
          'https://a.com/',
          'https://b.com/',
          'https://c.com/',
          'https://d.com/',
          'https://e.com/',
          'https://f.com/',
        ],
      }),
    ).toThrowError();
    expect(() =>
      createTaskRequestSchema.parse({ ...base, constraints: 'x'.repeat(2001) }),
    ).toThrowError();
  });

  it('rejects a request larger than the input bound', () => {
    expect(() =>
      createTaskRequestSchema.parse({
        title: 'Research',
        request: 'a'.repeat(DEFAULT_EXECUTION_LIMITS.maxInputChars + 1),
      }),
    ).toThrowError();
  });

  it('rejects an empty title and unknown fields', () => {
    expect(() => createTaskRequestSchema.parse({ title: '', request: 'x' })).toThrowError();
    expect(() =>
      createTaskRequestSchema.parse({ title: 't', request: 'x', extra: 1 }),
    ).toThrowError();
  });

  it('accepts an optional project scope and task kind', () => {
    const parsed = createTaskRequestSchema.parse({
      title: 'Update',
      request: 'Prepare a progress update from my notes.',
      projectId: 'project-1',
      kind: 'project_update',
    });
    expect(parsed.projectId).toBe('project-1');
    expect(parsed.kind).toBe('project_update');
  });

  it('requires a project for project updates and defaults the kind', () => {
    expect(() =>
      createTaskRequestSchema.parse({ title: 'Update', request: 'x', kind: 'project_update' }),
    ).toThrowError();
    const plain = createTaskRequestSchema.parse({ title: 'Research', request: 'x' });
    expect(plain.kind).toBeUndefined();
    // Research briefs may be scoped to a project without becoming updates.
    expect(() =>
      createTaskRequestSchema.parse({
        title: 'Research',
        request: 'x',
        projectId: 'project-1',
      }),
    ).not.toThrowError();
  });
});

describe('execution limits schema', () => {
  it('accepts the shipped defaults', () => {
    expect(executionLimitsSchema.parse(DEFAULT_EXECUTION_LIMITS)).toEqual(
      DEFAULT_EXECUTION_LIMITS,
    );
  });

  it('rejects zero or negative bounds', () => {
    for (const key of ['maxSteps', 'maxWallClockMs', 'maxInputChars', 'maxOutputChars']) {
      expect(() =>
        executionLimitsSchema.parse({ ...DEFAULT_EXECUTION_LIMITS, [key]: 0 }),
      ).toThrowError();
    }
  });
});

describe('task state transitions', () => {
  it('allows exactly the declared edges across the full matrix', () => {
    const states = Object.keys(TASK_TRANSITIONS) as Array<keyof typeof TASK_TRANSITIONS>;
    for (const from of states) {
      for (const to of states) {
        expect(canTransition(from, to)).toBe(TASK_TRANSITIONS[from].includes(to));
      }
    }
  });

  it('never leaves a terminal state', () => {
    expect(TASK_TRANSITIONS.completed).toHaveLength(0);
  });

  it('running can finish, fail, cancel, pause for approval, or be interrupted', () => {
    expect(canTransition('running', 'completed')).toBe(true);
    expect(canTransition('running', 'failed')).toBe(true);
    expect(canTransition('running', 'canceled')).toBe(true);
    expect(canTransition('running', 'awaiting_approval')).toBe(true);
    expect(canTransition('running', 'interrupted')).toBe(true);
  });

  it('queued can only start or be canceled', () => {
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('queued', 'canceled')).toBe(true);
    expect(canTransition('queued', 'completed')).toBe(false);
  });

  it('failed/canceled/interrupted can be explicitly re-queued', () => {
    expect(canTransition('failed', 'queued')).toBe(true);
    expect(canTransition('canceled', 'queued')).toBe(true);
    expect(canTransition('interrupted', 'queued')).toBe(true);
    expect(canTransition('interrupted', 'canceled')).toBe(true);
  });

  it('transitionTask returns an updated copy without mutating the input', () => {
    const task = sampleTask();
    const next = transitionTask(task, 'running', NOW);
    expect(next.state).toBe('running');
    expect(next.updatedAt).toBe(NOW);
    expect(task.state).toBe('queued');
    expect(next).not.toBe(task);
  });

  it('transitionTask throws InvalidTransitionError on an illegal edge', () => {
    const task = sampleTask();
    expect(() => transitionTask(task, 'completed', NOW)).toThrowError(InvalidTransitionError);
  });
});
