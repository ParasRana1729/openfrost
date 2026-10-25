import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionLimits } from '@openfrost/domain';
import { createStore, openDatabase, type Store } from '@openfrost/db';
import {
  createFetchPageTool,
  FakeProvider,
  TaskExecutor,
  type AgentMessage,
  type AgentTool,
} from '../src/index.js';

const T0 = Date.parse('2026-10-23T12:00:00.000Z');
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

const limits: ExecutionLimits = {
  maxSteps: 4,
  maxWallClockMs: 60_000,
  maxInputChars: 5_000,
  maxOutputChars: 5_000,
};

let home: string;
let opened: ReturnType<typeof openDatabase>;
let store: Store;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'openfrost-agentloop-test-'));
  opened = openDatabase(home);
  store = createStore(opened.db);
});

afterEach(() => {
  opened.sqlite.close();
  rmSync(home, { recursive: true, force: true });
});

function scriptedFetchPageTool(): AgentTool {
  return createFetchPageTool({
    resolve: async () => ['93.184.216.34'],
    fetchImpl: async () =>
      new Response('<html><head><title>Example Domain</title></head><body>Example body text</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
  });
}

describe('research-brief agent loop', () => {
  it('runs tool calls to a final brief with a retrieved-sources appendix and token usage', async () => {
    const provider = new FakeProvider([
      {
        type: 'tool_calls',
        calls: [{ name: 'fetch_page', argsJson: JSON.stringify({ url: 'https://example.com/page' }) }],
      },
      { type: 'tool_calls', calls: [{ name: 'mystery.tool', argsJson: '{}' }], searches: 2 },
      {
        type: 'final',
        text: '## Comparison\n\nA vs B.\n\n## Recommendation\n\nPick A.',
        usage: { inputTokens: 120, outputTokens: 30 },
      },
    ]);
    const executor = new TaskExecutor({
      store,
      provider,
      limits,
      now: () => at(0),
      tools: [scriptedFetchPageTool()],
    });

    const task = await executor.enqueue({ title: 'Brief', request: 'compare options' });
    await executor.whenIdle();

    expect(store.tasks.get(task.id)?.state).toBe('completed');
    const run = store.runs.listForTask(task.id)[0];
    expect(run?.state).toBe('completed');
    expect(run?.usage).toMatchObject({
      steps: 3,
      inputTokens: 120,
      outputTokens: 30,
    });
    expect(run?.usage?.inputChars).toBe(('Brief' + 'compare options').length);

    const artifact = store.artifacts.latestForTask(task.id);
    expect(artifact?.markdown).toContain('# Brief');
    expect(artifact?.markdown).toContain('Pick A.');
    expect(artifact?.markdown).toContain('## Retrieved sources');
    expect(artifact?.markdown).toMatch(
      /- https:\/\/example\.com\/page — HTTP 200, \d+ ms, \d+ chars retrieved/,
    );

    const toolEvents = store.events
      .listForTask(task.id)
      .filter((e) => e.type === 'tool.executed')
      .map((e) => e.payload);
    expect(toolEvents).toContainEqual({
      tool: 'fetch_page',
      riskTier: 'auto',
      step: 1,
      ok: true,
      durationMs: expect.any(Number),
    });
    expect(toolEvents).toContainEqual({
      tool: 'web_search',
      hosted: true,
      count: 2,
      step: 2,
      riskTier: 'auto',
    });
    expect(toolEvents).toContainEqual({
      tool: 'mystery.tool',
      riskTier: 'auto',
      step: 2,
      ok: false,
      durationMs: 0,
    });

    // The transcript the provider saw ends with tool results for both the
    // successful fetch and the failed unknown-tool call.
    const lastCall = provider.calls.at(-1);
    const transcript = lastCall?.messages ?? [];
    const fetchResult = transcript.find(
      (m): m is Extract<AgentMessage, { role: 'tool_result' }> =>
        m.role === 'tool_result' && m.name === 'fetch_page',
    );
    expect(fetchResult?.ok).toBe(true);
    expect(JSON.parse(fetchResult?.content ?? '{}')).toMatchObject({
      finalUrl: 'https://example.com/page',
      status: 200,
      title: 'Example Domain',
    });
    const unknownResult = transcript.find(
      (m): m is Extract<AgentMessage, { role: 'tool_result' }> =>
        m.role === 'tool_result' && m.name === 'mystery.tool',
    );
    expect(unknownResult?.ok).toBe(false);
    expect(unknownResult?.content).toBe('Unknown tool: mystery.tool');
  });

  it('pre-fetches starting URLs and includes constraints in the first user message', async () => {
    const provider = new FakeProvider([{ type: 'final', text: 'brief' }]);
    const executor = new TaskExecutor({
      store,
      provider,
      limits,
      now: () => at(0),
      tools: [scriptedFetchPageTool()],
    });

    const task = await executor.enqueue({
      title: 'Prefetch',
      request: 'compare things',
      constraints: 'keep it short',
      startingUrls: ['https://example.com/start'],
    });
    await executor.whenIdle();

    expect(store.tasks.get(task.id)?.state).toBe('completed');
    const firstStep = provider.calls[0];
    const userMessage = firstStep?.messages.find((m) => m.role === 'user');
    expect(userMessage?.content).toContain('Task: Prefetch');
    expect(userMessage?.content).toContain('compare things');
    expect(userMessage?.content).toContain('Owner constraints: keep it short');
    expect(userMessage?.content).toContain('Starting pages retrieved before your first step');
    expect(userMessage?.content).toContain('https://example.com/start');
    expect(userMessage?.content).toContain('Example body text');

    const toolEvents = store.events
      .listForTask(task.id)
      .filter((e) => e.type === 'tool.executed')
      .map((e) => e.payload);
    expect(toolEvents).toContainEqual({
      tool: 'fetch_page',
      riskTier: 'auto',
      step: 0,
      ok: true,
      durationMs: expect.any(Number),
    });
  });

  it('truncates oversized tool results with a visible marker', async () => {
    const bigTool: AgentTool = {
      definition: {
        name: 'big.tool',
        description: 'returns a very long string',
        parameters: { type: 'object' },
      },
      execute: async () => ({ ok: true, content: 'z'.repeat(25_000) }),
    };
    const provider = new FakeProvider([
      { type: 'tool_calls', calls: [{ name: 'big.tool', argsJson: '{}' }] },
      { type: 'final', text: 'done' },
    ]);
    const executor = new TaskExecutor({
      store,
      provider,
      limits,
      now: () => at(0),
      tools: [bigTool],
    });

    const task = await executor.enqueue({ title: 'Truncate', request: 'request' });
    await executor.whenIdle();

    expect(store.tasks.get(task.id)?.state).toBe('completed');
    const transcript = provider.calls.at(-1)?.messages ?? [];
    const toolResult = transcript.find(
      (m): m is Extract<AgentMessage, { role: 'tool_result' }> =>
        m.role === 'tool_result' && m.name === 'big.tool',
    );
    expect(toolResult?.ok).toBe(true);
    expect(toolResult?.content).toContain('[...truncated...]');
    expect(toolResult?.content.length).toBeLessThan(25_000);
  });
});
