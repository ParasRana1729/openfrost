/**
 * Provider seam for model-backed execution. The OpenAI adapter lands with
 * the S02 research slice; S01 ships only the deterministic fake used by
 * tests, so no automated check needs a paid API call.
 */
export interface ProviderStepRequest {
  taskTitle: string;
  taskRequest: string;
  /** 1-based step number within the current run. */
  step: number;
  /** Honored by providers: resolves/rejects promptly when canceled. */
  signal: AbortSignal;
}

export type ProviderStepResult =
  | { kind: 'final'; text: string }
  | { kind: 'continue' };

export interface LlmProvider {
  readonly name: string;
  /** Identifier recorded on `tool.executed` events for each provider step. */
  readonly toolName: string;
  generate(request: ProviderStepRequest): Promise<ProviderStepResult>;
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class ProviderMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderMissingError';
  }
}
