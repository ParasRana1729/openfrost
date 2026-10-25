import {
  ProviderError,
  type LlmProvider,
  type ProviderStepRequest,
  type ProviderStepResult,
  type ProviderUsage,
} from './provider.js';

/**
 * Deterministic fake provider for tests (S01/S02: queue ordering, tool
 * loops, completion, failure, cancellation, limit exhaustion, and
 * interruption must all be verifiable without paid API calls).
 */
export type ScriptedStep =
  | {
      type: 'final';
      text: string;
      citations?: Array<{ url: string; title?: string }>;
      usage?: ProviderUsage;
    }
  | {
      type: 'tool_calls';
      calls: Array<{ name: string; argsJson: string }>;
      searches?: number;
      usage?: ProviderUsage;
    }
  /** An empty tool_calls result, so the loop advances one step. */
  | { type: 'continue' }
  | { type: 'error'; message: string }
  /** Sleeps before returning an empty tool_calls result; abortable. */
  | { type: 'hang'; ms?: number };

const NO_TOKENS: ProviderUsage = { inputTokens: null, outputTokens: null };

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(abortError());
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(): Error {
  const err = new Error('provider step aborted');
  err.name = 'AbortError';
  return err;
}

export class FakeProvider implements LlmProvider {
  readonly name = 'fake';
  readonly calls: ProviderStepRequest[] = [];
  abortedCalls = 0;

  #steps: ScriptedStep[];
  #callCounter = 0;

  constructor(steps: ScriptedStep[]) {
    this.#steps = [...steps];
  }

  async step(request: ProviderStepRequest): Promise<ProviderStepResult> {
    this.calls.push(request);
    const step = this.#steps.shift();
    if (!step) {
      throw new ProviderError('fake provider script exhausted (test setup bug)');
    }
    const delayMs = step.type === 'hang' ? (step.ms ?? 3_600_000) : 0;
    if (delayMs > 0) {
      try {
        await abortableSleep(delayMs, request.signal);
      } catch (err) {
        this.abortedCalls += 1;
        throw err;
      }
    }
    if (request.signal.aborted) {
      this.abortedCalls += 1;
      throw abortError();
    }
    switch (step.type) {
      case 'final':
        return {
          kind: 'final',
          text: step.text,
          citations: step.citations ?? [],
          usage: step.usage ?? NO_TOKENS,
        };
      case 'tool_calls':
        return {
          kind: 'tool_calls',
          calls: step.calls.map((call) => ({
            id: `fake-call-${(this.#callCounter += 1)}`,
            name: call.name,
            argsJson: call.argsJson,
          })),
          searches: step.searches ?? 0,
          usage: step.usage ?? NO_TOKENS,
        };
      case 'continue':
      case 'hang':
        return { kind: 'tool_calls', calls: [], searches: 0, usage: NO_TOKENS };
      case 'error':
        throw new ProviderError(step.message);
    }
  }
}
