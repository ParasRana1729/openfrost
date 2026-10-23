import {
  ProviderError,
  type LlmProvider,
  type ProviderStepRequest,
  type ProviderStepResult,
} from './provider.js';

/**
 * Deterministic fake provider/tool for tests (backlog S01: queue ordering,
 * completion, failure, cancellation, limit exhaustion, and interruption
 * must all be verifiable without paid API calls).
 */
export type ScriptedStep =
  | { type: 'final'; text: string }
  | { type: 'continue'; delayMs?: number }
  | { type: 'error'; message: string }
  | { type: 'hang'; ms?: number };

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
  readonly toolName = 'fake.echo';
  readonly calls: ProviderStepRequest[] = [];
  abortedCalls = 0;

  #steps: ScriptedStep[];

  constructor(steps: ScriptedStep[]) {
    this.#steps = [...steps];
  }

  async generate(request: ProviderStepRequest): Promise<ProviderStepResult> {
    this.calls.push(request);
    const step = this.#steps.shift();
    if (!step) {
      throw new ProviderError('fake provider script exhausted (test setup bug)');
    }
    const delayMs =
      step.type === 'continue'
        ? (step.delayMs ?? 0)
        : step.type === 'hang'
          ? (step.ms ?? 3_600_000)
          : 0;
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
        return { kind: 'final', text: step.text };
      case 'continue':
      case 'hang':
        return { kind: 'continue' };
      case 'error':
        throw new ProviderError(step.message);
    }
  }
}
