import {
  DEFAULT_EXECUTION_LIMITS,
  createTaskRequestSchema,
  type AgentRun,
  type Artifact,
  type ExecutionLimits,
  type RunFailure,
  type RunLimitKind,
  type Task,
} from '@openfrost/domain';
import { TaskNotFoundError, type Store } from '@openfrost/db';
import { ProviderMissingError, type LlmProvider } from './provider.js';

const DISPATCH_PAUSED_KEY = 'dispatch.paused';

export interface ExecutorOptions {
  store: Store;
  /** Null until the OpenAI adapter lands in S02; runs then fail honestly. */
  provider: LlmProvider | null;
  limits?: ExecutionLimits;
  now?: () => string;
}

export interface ExecutorStatus {
  busy: boolean;
  activeTaskId: string | null;
  dispatchPaused: boolean;
}

class LimitReachedError extends Error {
  constructor(
    public readonly limitHit: RunLimitKind,
    message: string,
  ) {
    super(message);
    this.name = 'LimitReachedError';
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * The one global executor (spec §5): a single agent run owns execution at a
 * time; everything else stays queued. Enforces finite step, wall-clock,
 * input, and output limits, honors cancellation, and supports restart
 * recovery that pauses dispatch until the owner reviews it.
 */
export class TaskExecutor {
  readonly store: Store;
  readonly provider: LlmProvider | null;
  readonly limits: ExecutionLimits;

  readonly #now: () => string;
  #drainPromise: Promise<void> | null = null;
  #active: { taskId: string; runId: string; controller: AbortController } | null = null;
  #shutdown = false;

  constructor(options: ExecutorOptions) {
    this.store = options.store;
    this.provider = options.provider;
    this.limits = options.limits ?? DEFAULT_EXECUTION_LIMITS;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  now(): string {
    return this.#now();
  }

  status(): ExecutorStatus {
    return {
      busy: this.#active !== null,
      activeTaskId: this.#active?.taskId ?? null,
      dispatchPaused: this.isDispatchPaused(),
    };
  }

  isDispatchPaused(): boolean {
    return this.store.state.getValue(DISPATCH_PAUSED_KEY) === 'true';
  }

  pauseDispatch(reason: string): void {
    this.store.state.setValue(DISPATCH_PAUSED_KEY, 'true');
    this.store.events.append(
      'dispatch.paused',
      { payload: { reason } },
      this.now(),
    );
  }

  resumeDispatch(): void {
    this.store.state.setValue(DISPATCH_PAUSED_KEY, 'false');
    this.store.events.append('dispatch.resumed', {}, this.now());
    void this.kick();
  }

  async enqueue(title: string, request: string): Promise<Task> {
    const input = createTaskRequestSchema.parse({ title, request });
    const task = this.store.tasks.create(input, this.now());
    this.store.events.append(
      'task.created',
      { taskId: task.id, payload: { title } },
      this.now(),
    );
    void this.kick();
    return task;
  }

  /** Owner-initiated retry: requeue a failed/canceled/interrupted task. */
  requeue(taskId: string): Task {
    const task = this.#requireTask(taskId);
    if (task.state === 'queued' || task.state === 'running') {
      return task;
    }
    const requeued = this.store.tasks.transition(taskId, 'queued', this.now(), {
      error: null,
    });
    this.store.events.append(
      'task.requeued',
      { taskId, payload: { fromState: task.state } },
      this.now(),
    );
    void this.kick();
    return requeued;
  }

  /**
   * Cancel a task. A queued task never runs; an in-flight run is aborted at
   * the provider call and finalized as canceled. Cancellation never undoes
   * work that already completed.
   */
  cancel(taskId: string): Task {
    const task = this.#requireTask(taskId);
    if (task.state === 'queued') {
      const canceled = this.store.tasks.transition(taskId, 'canceled', this.now());
      this.store.events.append(
        'task.canceled',
        { taskId, payload: { origin: 'queued' } },
        this.now(),
      );
      return canceled;
    }
    if (task.state === 'running' || task.state === 'awaiting_approval') {
      if (this.#active?.taskId === taskId) {
        this.#active.controller.abort();
        return this.#requireTask(taskId);
      }
      // No in-flight work in this process (e.g. leftover state from a
      // crashed run): finalize the recorded run directly.
      if (task.lastRunId) {
        const run = this.store.runs.get(task.lastRunId);
        if (run && run.state === 'running') {
          this.store.runs.finish(run.id, 'canceled', this.now(), {
            usage: run.usage ?? { steps: 0, inputChars: 0, outputChars: 0 },
          });
          this.store.events.append('run.canceled', { taskId, runId: run.id }, this.now());
        }
      }
      const canceled = this.store.tasks.transition(taskId, 'canceled', this.now());
      this.store.events.append(
        'task.canceled',
        { taskId, payload: { origin: task.state } },
        this.now(),
      );
      return canceled;
    }
    return task;
  }

  /**
   * Restart recovery (spec §5): mark unfinished active runs `interrupted`,
   * keep queued work, and pause dispatch until the owner reviews it.
   */
  recover(): { interruptedRuns: number; dispatchPaused: boolean } {
    const stuck = this.store.tasks.listByStates(['running', 'awaiting_approval']);
    for (const task of stuck) {
      if (task.lastRunId) {
        const run = this.store.runs.get(task.lastRunId);
        if (run && run.state === 'running') {
          this.store.runs.finish(run.id, 'interrupted', this.now());
          this.store.events.append(
            'run.interrupted',
            { taskId: task.id, runId: run.id },
            this.now(),
          );
        }
      }
      this.store.tasks.transition(task.id, 'interrupted', this.now());
      this.store.events.append('task.interrupted', { taskId: task.id }, this.now());
    }
    const paused = stuck.length > 0 || this.isDispatchPaused();
    if (stuck.length > 0) {
      this.pauseDispatch('restart recovery');
    }
    return { interruptedRuns: stuck.length, dispatchPaused: paused };
  }

  /**
   * Start processing the queue if idle, not paused, and not shut down.
   * Returns a promise that settles when the current drain cycle finishes.
   */
  kick(): Promise<void> {
    if (this.#drainPromise) {
      return this.#drainPromise;
    }
    if (this.#shutdown || this.isDispatchPaused()) {
      return Promise.resolve();
    }
    this.#drainPromise = this.#drain().finally(() => {
      this.#drainPromise = null;
    });
    return this.#drainPromise;
  }

  whenIdle(): Promise<void> {
    return this.#drainPromise ?? Promise.resolve();
  }

  /**
   * Stop the executor (runtime shutdown). In-flight runs are marked
   * `interrupted` — never silently canceled or retried — and dispatch is
   * paused for review on the next start.
   */
  async stop(): Promise<void> {
    this.#shutdown = true;
    this.#active?.controller.abort();
    await this.whenIdle();
  }

  async #drain(): Promise<void> {
    for (;;) {
      if (this.#shutdown || this.isDispatchPaused()) {
        return;
      }
      const next = this.store.tasks.listQueued()[0];
      if (!next) {
        return;
      }
      try {
        await this.#executeTask(next.id);
      } catch (err) {
        // An unexpected executor bug must not wedge the queue; record it
        // honestly and continue with the next task.
        const message = err instanceof Error ? err.message : String(err);
        this.store.events.append(
          'task.failed',
          { taskId: next.id, payload: { origin: 'executor', message } },
          this.now(),
        );
        try {
          this.store.tasks.transition(next.id, 'failed', this.now(), {
            error: `Executor error: ${message}`,
          });
        } catch {
          // Task was concurrently claimed/canceled; nothing to do.
        }
      }
    }
  }

  async #executeTask(taskId: string): Promise<void> {
    let claimed: { task: Task; run: AgentRun };
    try {
      claimed = this.store.tasks.startRun(taskId, this.now());
    } catch {
      return; // no longer queued (canceled/requeued race); drain moves on
    }
    const run = claimed.run;
    const controller = new AbortController();
    this.#active = { taskId, runId: run.id, controller };

    const inputChars = claimed.task.request.length + claimed.task.title.length;
    const deadlineMs = Date.now() + this.limits.maxWallClockMs;
    let steps = 0;
    let outputChars = 0;

    try {
      this.store.events.append('run.started', { taskId, runId: run.id }, this.now());

      if (!this.provider) {
        throw new ProviderMissingError(
          'No model provider is configured yet. Store an OpenAI key in Settings; ' +
            'model-backed execution arrives with the S02 research slice.',
        );
      }
      if (claimed.task.request.length > this.limits.maxInputChars) {
        throw new LimitReachedError(
          'max_input',
          `Request of ${claimed.task.request.length} characters exceeds the ` +
            `${this.limits.maxInputChars} character input limit.`,
        );
      }

      for (let step = 1; step <= this.limits.maxSteps; step += 1) {
        if (controller.signal.aborted) {
          throw abortError();
        }
        if (Date.now() > deadlineMs) {
          throw new LimitReachedError(
            'wall_clock',
            `Run exceeded its ${this.limits.maxWallClockMs} ms wall-clock limit.`,
          );
        }
        let result;
        try {
          result = await this.provider.generate({
            taskTitle: claimed.task.title,
            taskRequest: claimed.task.request,
            step,
            signal: controller.signal,
          });
        } catch (err) {
          if (controller.signal.aborted || isAbortError(err)) {
            throw abortError();
          }
          throw err;
        }
        steps += 1;
        this.store.events.append(
          'tool.executed',
          {
            taskId,
            runId: run.id,
            payload: { tool: this.provider.toolName, riskTier: 'auto', step },
          },
          this.now(),
        );
        if (result.kind === 'final') {
          outputChars = result.text.length;
          if (outputChars > this.limits.maxOutputChars) {
            throw new LimitReachedError(
              'max_output',
              `Output of ${outputChars} characters exceeds the ` +
                `${this.limits.maxOutputChars} character limit.`,
            );
          }
          this.finishRun(taskId, run.id, 'completed', {
            usage: { steps, inputChars, outputChars },
          });
          const artifact = this.reportArtifact(taskId, claimed.task, result.text);
          this.store.tasks.transition(taskId, 'completed', this.now(), {
            resultArtifactId: artifact.id,
          });
          this.store.events.append(
            'task.completed',
            { taskId, runId: run.id, payload: { artifactId: artifact.id, steps } },
            this.now(),
          );
          return;
        }
      }
      throw new LimitReachedError(
        'max_steps',
        `Run reached its ${this.limits.maxSteps} step limit without finishing.`,
      );
    } catch (err) {
      this.finalizeFailure(taskId, run.id, { steps, inputChars, outputChars }, err);
    } finally {
      this.#active = null;
    }
  }

  private finishRun(
    taskId: string,
    runId: string,
    to: 'completed' | 'failed' | 'canceled' | 'interrupted',
    details: {
      usage: { steps: number; inputChars: number; outputChars: number };
      failure?: RunFailure | null;
    },
  ): void {
    this.store.runs.finish(runId, to, this.now(), {
      usage: details.usage,
      failure: details.failure ?? null,
    });
    const eventByState: Record<string, 'run.completed' | 'run.failed' | 'run.canceled' | 'run.interrupted'> = {
      completed: 'run.completed',
      failed: 'run.failed',
      canceled: 'run.canceled',
      interrupted: 'run.interrupted',
    };
    this.store.events.append(eventByState[to] ?? 'run.failed', { taskId, runId }, this.now());
  }

  private finalizeFailure(
    taskId: string,
    runId: string,
    usage: { steps: number; inputChars: number; outputChars: number },
    err: unknown,
  ): void {
    // Runtime shutdown mid-run: interrupted + dispatch paused for review.
    if (this.#shutdown && isAbortError(err)) {
      this.finishRun(taskId, runId, 'interrupted', { usage });
      this.store.tasks.transition(taskId, 'interrupted', this.now());
      this.store.events.append('task.interrupted', { taskId, runId }, this.now());
      this.pauseDispatch('runtime shutdown with an active run');
      return;
    }
    if (isAbortError(err)) {
      this.finishRun(taskId, runId, 'canceled', { usage });
      this.store.tasks.transition(taskId, 'canceled', this.now());
      this.store.events.append('task.canceled', { taskId, runId }, this.now());
      return;
    }
    let failure: RunFailure;
    if (err instanceof LimitReachedError) {
      failure = {
        code: 'limit_reached',
        message: err.message,
        limitHit: err.limitHit,
      };
    } else if (err instanceof ProviderMissingError) {
      failure = { code: 'provider_missing', message: err.message, limitHit: null };
    } else {
      const message = err instanceof Error ? err.message : String(err);
      failure = { code: 'provider_error', message, limitHit: null };
    }
    this.finishRun(taskId, runId, 'failed', { usage, failure });
    this.store.tasks.transition(taskId, 'failed', this.now(), {
      error: failure.message,
    });
    if (failure.code === 'limit_reached') {
      this.store.events.append(
        'run.limit_reached',
        { taskId, runId, payload: { limitHit: failure.limitHit } },
        this.now(),
      );
    }
    this.store.events.append(
      'task.failed',
      { taskId, runId, payload: { code: failure.code, message: failure.message } },
      this.now(),
    );
  }

  private reportArtifact(taskId: string, task: Task, finalText: string): Artifact {
    const markdown = `# ${task.title}\n\n${finalText}\n`;
    return this.store.artifacts.create(taskId, markdown, this.now());
  }

  #requireTask(taskId: string): Task {
    const task = this.store.tasks.get(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }
    return task;
  }
}

function abortError(): Error {
  const err = new Error('run aborted');
  err.name = 'AbortError';
  return err;
}
