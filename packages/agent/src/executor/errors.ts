/** App-internal failure (e.g. result persistence) — not a provider problem. */
export class ExecutorInternalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutorInternalError';
  }
}

export function abortError(): Error {
  const err = new Error('run aborted');
  err.name = 'AbortError';
  return err;
}
