import { describe, expect, it } from 'vitest';
import {
  agentRunSchema,
  artifactSchema,
  conversationSchema,
  eventSchema,
  messageSchema,
  runUsageSchema,
  transitionRun,
  InvalidRunTransitionError,
  type AgentRun,
} from '../src/index.js';

const NOW = '2026-10-23T12:00:00.000Z';

describe('agentRun schema', () => {
  function sampleRun(overrides: Partial<AgentRun> = {}): AgentRun {
    return agentRunSchema.parse({
      id: 'run-1',
      taskId: 'task-1',
      attempt: 1,
      state: 'running',
      startedAt: NOW,
      endedAt: null,
      usage: null,
      failure: null,
      ...overrides,
    });
  }

  it('accepts a valid run', () => {
    expect(sampleRun().state).toBe('running');
  });

  it('rejects a zero attempt number and invalid state', () => {
    expect(() => sampleRun({ attempt: 0 })).toThrowError();
    expect(() => sampleRun({ state: 'queued' })).toThrowError();
  });

  it('rejects unknown fields', () => {
    expect(() => sampleRun({ retryOf: 'run-0' })).toThrowError();
  });

  it('rejects a failure without a known code', () => {
    expect(() =>
      sampleRun({
        state: 'failed',
        failure: { code: 'act_of_god', message: 'x', limitHit: null },
      }),
    ).toThrowError();
  });

  it('accepts usage counts and defaults token counts to null', () => {
    expect(
      runUsageSchema.parse({ steps: 3, inputChars: 100, outputChars: 42 }),
    ).toEqual({ steps: 3, inputChars: 100, outputChars: 42, inputTokens: null, outputTokens: null });
    expect(
      runUsageSchema.parse({
        steps: 3,
        inputChars: 100,
        outputChars: 42,
        inputTokens: 1200,
        outputTokens: 340,
      }),
    ).toEqual({ steps: 3, inputChars: 100, outputChars: 42, inputTokens: 1200, outputTokens: 340 });
    expect(() => runUsageSchema.parse({ steps: -1, inputChars: 0, outputChars: 0 })).toThrowError();
    expect(() =>
      runUsageSchema.parse({ steps: 1, inputChars: 0, outputChars: 0, inputTokens: 1.5, outputTokens: 0 }),
    ).toThrowError();
  });
});

describe('run transitions', () => {
  const run: AgentRun = agentRunSchema.parse({
    id: 'run-1',
    taskId: 'task-1',
    attempt: 1,
    state: 'running',
    startedAt: NOW,
    endedAt: null,
    usage: null,
    failure: null,
  });

  it('running reaches every terminal state', () => {
    for (const to of ['completed', 'failed', 'canceled', 'interrupted'] as const) {
      expect(transitionRun(run, to, NOW).state).toBe(to);
    }
  });

  it('terminal runs cannot transition again', () => {
    const done = transitionRun(run, 'completed', NOW);
    expect(() => transitionRun(done, 'running', NOW)).toThrowError(InvalidRunTransitionError);
  });
});

describe('conversation and message schemas', () => {
  it('accepts a valid conversation and message', () => {
    expect(conversationSchema.parse({ id: 'c1', title: 'Research chat', createdAt: NOW })).toBeTruthy();
    expect(
      messageSchema.parse({
        id: 'm1',
        conversationId: 'c1',
        role: 'user',
        content: 'hello',
        createdAt: NOW,
      }),
    ).toBeTruthy();
  });

  it('rejects an unknown role and empty content', () => {
    expect(() =>
      messageSchema.parse({
        id: 'm1',
        conversationId: 'c1',
        role: 'system',
        content: 'x',
        createdAt: NOW,
      }),
    ).toThrowError();
    expect(() =>
      messageSchema.parse({
        id: 'm1',
        conversationId: 'c1',
        role: 'user',
        content: '',
        createdAt: NOW,
      }),
    ).toThrowError();
  });
});

describe('artifact and event schemas', () => {
  it('accepts a valid report artifact', () => {
    expect(
      artifactSchema.parse({
        id: 'a1',
        taskId: 'task-1',
        kind: 'report',
        markdown: '# Report\nbody',
        createdAt: NOW,
      }),
    ).toBeTruthy();
  });

  it('rejects an unsupported artifact kind', () => {
    expect(() =>
      artifactSchema.parse({
        id: 'a1',
        taskId: null,
        kind: 'screenshot',
        markdown: 'x',
        createdAt: NOW,
      }),
    ).toThrowError();
  });

  it('accepts a valid event with payload and rejects unknown types', () => {
    expect(
      eventSchema.parse({
        id: 1,
        type: 'task.created',
        taskId: 'task-1',
        runId: null,
        payload: { title: 'Research' },
        createdAt: NOW,
      }),
    ).toBeTruthy();
    expect(() =>
      eventSchema.parse({
        id: 1,
        type: 'model.said_something_private',
        taskId: null,
        runId: null,
        payload: {},
        createdAt: NOW,
      }),
    ).toThrowError();
  });
});
