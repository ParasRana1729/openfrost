import {
  DEFAULT_APPROVAL_TTL_MS,
  DEFAULT_EXECUTION_LIMITS,
  InvalidApprovalTransitionError,
  type AgentRun,
  type Approval,
  type Artifact,
  type CreateTaskRequest,
  type ExecutionLimits,
  type Routine,
  type RunFailure,
  type RunLimitKind,
  type RunState,
  type RunUsage,
  type Task,
  type TaskState,
} from '@openfrost/domain';
import {
  ApprovalNotFoundError,
  ArtifactNotFoundError,
  ExportDestinationNotFoundError,
  TaskNotFoundError,
  type Store,
} from '@openfrost/db';
import {
  ProviderMissingError,
  type AgentMessage,
  type LlmProvider,
  type ProviderUsage,
} from './provider.js';
import { createFetchPageTool } from './tools/fetchPage.js';
import { createProposeMemoryTool } from './tools/memory.js';
import {
  createReadProjectFileTool,
  type GrantRootView,
} from './tools/projectFiles.js';
import type { AgentTool, RunToolContext } from './tools/types.js';
import { reportMarkdown } from './executor/appendices.js';
import { abortError, ExecutorInternalError } from './executor/errors.js';
import { ExportPipeline, ExportRefusedError } from './executor/exportPipeline.js';
import { RunToolRecords } from './executor/records.js';
import { SourceUnavailableError, WorkflowContextBuilders, workflowPolicy } from './executor/workflows.js';

export { ExportRefusedError } from './executor/exportPipeline.js';
export type { UpdateConsultRecord } from './executor/records.js';
export { RECENT_UPDATES_HEADING, SourceUnavailableError } from './executor/workflows.js';

const DISPATCH_PAUSED_KEY = 'dispatch.paused';

/** Tool calls executed per provider step; extras are refused visibly. */
const MAX_TOOL_CALLS_PER_STEP = 4;
/** Tool result content handed back to the model is capped. */
const MAX_TOOL_RESULT_CHARS = 20_000;
export interface ExecutorFailureInfo {
  taskId: string;
  runId: string | null;
  code: RunFailure['code'] | 'executor';
  message: string;
  limitHit: RunLimitKind | null;
}

export interface ExecutorOptions {
  store: Store;
  /** Null runs fail honestly with provider_missing. */
  provider: LlmProvider | null;
  limits?: ExecutionLimits;
  now?: () => string;
  /** Defaults to the SSRF-guarded fetch_page tool. */
  tools?: AgentTool[];
  /** How long an undecided export approval stays valid. */
  approvalTtlMs?: number;
  /** Optional observer for failed runs (e.g., API redacted structured logging). */
  onFailure?: (failure: ExecutorFailureInfo) => void;
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
 * time; everything else stays queued. Runs a bounded tool-calling agent loop
 * (spec §6) with finite step, wall-clock, input, and output limits, honors
 * cancellation, and supports restart recovery that pauses dispatch until the
 * owner reviews it.
 */
export class TaskExecutor {
  readonly store: Store;
  readonly provider: LlmProvider | null;
  readonly limits: ExecutionLimits;
  readonly tools: AgentTool[];
  readonly approvalTtlMs: number;

  readonly #now: () => string;
  readonly #onFailure?: (failure: ExecutorFailureInfo) => void;
  readonly #toolsByName: Map<string, AgentTool>;
  readonly #workflowBuilders: WorkflowContextBuilders;
  readonly #exportPipeline: ExportPipeline;
  readonly #approvalWaiters = new Map<
    string,
    (decision: 'granted' | 'rejected') => void
  >();
  /** Serializes drain passes; also the promise whenIdle()/stop() await. */
  #drainChain: Promise<void> = Promise.resolve();
  #active: { taskId: string; runId: string; controller: AbortController } | null = null;
  #shutdown = false;

  constructor(options: ExecutorOptions) {
    this.store = options.store;
    this.provider = options.provider;
    this.limits = options.limits ?? DEFAULT_EXECUTION_LIMITS;
    this.tools = options.tools ?? [createFetchPageTool()];
    this.approvalTtlMs = options.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#onFailure = options.onFailure;
    this.#toolsByName = new Map(this.tools.map((tool) => [tool.definition.name, tool]));
    this.#workflowBuilders = new WorkflowContextBuilders(
      this.store,
      () => this.now(),
      this.#toolsByName,
      (tool, argsJson, ctx, signal) => this.#runTool(tool, argsJson, ctx, signal),
      (projectId) => this.#grantsForTask(projectId),
    );
    this.#exportPipeline = new ExportPipeline(
      this.store,
      () => this.now(),
      this.approvalTtlMs,
      this.#approvalWaiters,
    );
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

  /** The input is already validated by the API against createTaskRequestSchema. */
  async enqueue(input: CreateTaskRequest): Promise<Task> {
    const task = this.store.tasks.create(input, this.now());
    this.store.events.append(
      'task.created',
      { taskId: task.id, payload: { title: task.title } },
      this.now(),
    );
    void this.kick();
    return task;
  }

  /**
   * Queues an approval-bound export (spec §6). The arguments are immutable
   * from here on: artifact id, destination grant, and filename are stored on
   * the task and snapshotted again into the approval proposal. The run itself
   * performs no model work — it prepares the proposal, waits for the owner's
   * decision in the Control Center, and only then revalidates and writes.
   */
  async enqueueExport(input: {
    artifactId: string;
    destinationId: string;
    filename: string;
  }): Promise<Task> {
    if (this.store.artifacts.get(input.artifactId) === null) {
      throw new ArtifactNotFoundError(input.artifactId);
    }
    if (this.store.exportDestinations.get(input.destinationId) === null) {
      throw new ExportDestinationNotFoundError(input.destinationId);
    }
    const task = this.store.tasks.create(
      {
        title: `Export: ${input.filename}`,
        request:
          'Export the saved artifact as a new Markdown file inside the granted ' +
          'destination. The write happens only after the owner approves the exact ' +
          'proposal in the Control Center.',
        kind: 'export_report',
        exportArgs: { ...input },
      },
      this.now(),
    );
    this.store.events.append(
      'task.created',
      { taskId: task.id, payload: { title: task.title, kind: 'export_report' } },
      this.now(),
    );
    void this.kick();
    return task;
  }

  /**
   * Queues the weekly-plan task for one routine occurrence (spec §3.C). The
   * template comes from the owner-confirmed routine; nothing here is
   * self-assigned work. Occurrence identity/dedup lives in the occurrence
   * row the scheduler created — this method only dispatches the task.
   */
  async enqueueRoutineOccurrence(input: {
    routine: Routine;
    occurrenceKey: string;
    scheduledFor: string;
  }): Promise<Task> {
    const task = this.store.tasks.create(
      {
        title: `${input.routine.template.title} — ${input.occurrenceKey}`,
        request: input.routine.template.request,
        constraints: input.routine.template.constraints,
        projectId: input.routine.projectId,
        kind: 'weekly_plan',
        routineId: input.routine.id,
      },
      this.now(),
    );
    this.store.events.append(
      'task.created',
      {
        taskId: task.id,
        payload: {
          title: task.title,
          kind: 'weekly_plan',
          routineId: input.routine.id,
          occurrenceKey: input.occurrenceKey,
          scheduledFor: input.scheduledFor,
        },
      },
      this.now(),
    );
    void this.kick();
    return task;
  }

  /**
   * Applies the owner's decision to a pending approval and wakes the waiting
   * run. The decision is validated against the store's transition map — a
   * decided, expired, or canceled approval cannot be decided again, so
   * duplicate requests cannot write twice.
   */
  decideApproval(approvalId: string, decision: 'granted' | 'rejected'): Approval {
    const pending = this.store.approvals.get(approvalId);
    if (!pending) {
      throw new ApprovalNotFoundError(approvalId);
    }
    if (pending.state !== 'pending') {
      throw new InvalidApprovalTransitionError(pending.state, decision);
    }
    if (pending.expiresAt <= this.now()) {
      // Race: the approval expired while the owner was deciding.
      this.store.approvals.decide(approvalId, 'expired', this.now());
      this.store.events.append(
        'approval.expired',
        { taskId: pending.taskId, runId: pending.runId, payload: { approvalId } },
        this.now(),
      );
      throw new InvalidApprovalTransitionError('pending', decision);
    }
    const decided = this.store.approvals.decide(approvalId, decision, this.now());
    this.store.events.append(
      decision === 'granted' ? 'approval.granted' : 'approval.rejected',
      {
        taskId: decided.taskId,
        runId: decided.runId,
        payload: { approvalId, action: decided.action },
      },
      this.now(),
    );
    const waiter = this.#approvalWaiters.get(approvalId);
    if (waiter) {
      this.#approvalWaiters.delete(approvalId);
      waiter(decision);
    }
    return decided;
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
            usage: run.usage ?? {
              steps: 0,
              inputChars: 0,
              outputChars: 0,
              inputTokens: null,
              outputTokens: null,
            },
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
   * keep queued work, and pause dispatch until the owner reviews it. Also
   * purges expired sessions, expires due approvals, and reconciles approvals
   * left undecided or granted-but-unconfirmed by a restart — an unknown write
   * outcome is reconciled, never replayed automatically.
   */
  recover(): { interruptedRuns: number; dispatchPaused: boolean } {
    this.store.sessions.purgeExpired(this.now());
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
    // Approvals cannot outlive their run: undecided ones are canceled, and a
    // granted-but-unconfirmed export is canceled with an honest note that the
    // file may or may not exist — the owner reconciles, the runtime never
    // replays the write.
    for (const approval of this.store.approvals.listByStates(['pending', 'granted'])) {
      const reason =
        approval.state === 'granted'
          ? 'Runtime restarted after approval but before the write was confirmed; ' +
            'the file may or may not exist. Reconcile manually — nothing was replayed.'
          : 'Runtime restarted while the export was awaiting review.';
      this.store.approvals.markRefused(approval.id, reason, this.now());
      this.store.events.append(
        'approval.canceled',
        {
          taskId: approval.taskId,
          runId: approval.runId,
          payload: { approvalId: approval.id, reason },
        },
        this.now(),
      );
    }
    this.expireDueApprovals();
    const paused = stuck.length > 0 || this.isDispatchPaused();
    if (stuck.length > 0) {
      this.pauseDispatch('restart recovery');
    }
    return { interruptedRuns: stuck.length, dispatchPaused: paused };
  }

  /** Expires pending approvals whose TTL passed; safe to call repeatedly. */
  expireDueApprovals(): number {
    const now = this.now();
    let expired = 0;
    for (const approval of this.store.approvals.listByStates(['pending'])) {
      if (approval.expiresAt > now) {
        continue;
      }
      this.store.approvals.decide(approval.id, 'expired', now);
      this.store.events.append(
        'approval.expired',
        {
          taskId: approval.taskId,
          runId: approval.runId,
          payload: { approvalId: approval.id },
        },
        now,
      );
      expired += 1;
    }
    return expired;
  }

  /**
   * Start processing the queue if idle, not paused, and not shut down.
   * Passes are serialized onto one chain: a kick that lands while a drain is
   * finishing (including its resolution microtask) still appends a fresh
   * pass, so a task enqueued in that gap can never sit queued unprocessed —
   * the previous early-return on a resolved promise allowed exactly that.
   * Returns a promise that settles when every pass so far has finished.
   */
  kick(): Promise<void> {
    if (this.#shutdown || this.isDispatchPaused()) {
      return this.#drainChain;
    }
    this.#drainChain = this.#drainChain
      .then(() => this.#drain())
      .catch(() => {
        // #drain handles its own errors; this last-resort guard only keeps
        // an unexpected rejection from crashing the runtime as unhandled.
      });
    return this.#drainChain;
  }

  whenIdle(): Promise<void> {
    return this.#drainChain;
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
        // An unexpected executor bug must not wedge the queue, leave a run
        // row stuck in `running`, or crash the runtime. Reconcile the run
        // first; if reconciliation itself fails, leave the pair untouched
        // so restart recovery (recover()) marks both interrupted and pauses
        // dispatch for owner review.
        const message = err instanceof Error ? err.message : String(err);
        let runState: RunState | 'unreconciled';
        try {
          const current = this.store.tasks.get(next.id);
          const run = current?.lastRunId
            ? this.store.runs.get(current.lastRunId)
            : null;
          if (run && run.state === 'running') {
            this.store.runs.finish(run.id, 'interrupted', this.now());
            try {
              this.store.events.append(
                'run.interrupted',
                { taskId: next.id, runId: run.id },
                this.now(),
              );
            } catch {
              // Best effort; the log gap is acceptable during a store failure.
            }
          }
          runState =
            current?.lastRunId != null
              ? (this.store.runs.get(current.lastRunId)?.state ?? 'unreconciled')
              : 'unreconciled';
        } catch {
          runState = 'unreconciled';
        }
        if (runState !== 'unreconciled') {
          const to: TaskState = runState === 'failed' ? 'failed' : 'interrupted';
          try {
            this.store.events.append(
              to === 'failed' ? 'task.failed' : 'task.interrupted',
              { taskId: next.id, payload: { origin: 'executor', message } },
              this.now(),
            );
          } catch {
            // Best effort.
          }
          try {
            this.store.tasks.transition(next.id, to, this.now(), {
              error: to === 'failed' ? `Executor error: ${message}` : null,
            });
          } catch {
            // Finalized concurrently (e.g. canceled); nothing to do.
          }
          if (to === 'failed') {
            this.#notifyFailure({
              taskId: next.id,
              runId: null,
              code: 'executor',
              message,
              limitHit: null,
            });
          }
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
    const task = claimed.task;
    const controller = new AbortController();
    this.#active = { taskId, runId: run.id, controller };

    const inputChars = task.request.length + task.title.length;
    const deadlineMs = Date.now() + this.limits.maxWallClockMs;
    // The wall clock is enforced with a real abort timer, so a single hung
    // provider call stops at the limit instead of overshooting it.
    const deadlineTimer = setTimeout(
      () => controller.abort(),
      this.limits.maxWallClockMs,
    );
    deadlineTimer.unref?.();
    let steps = 0;
    let outputChars = 0;
    const usage: ProviderUsage = { inputTokens: null, outputTokens: null };

    try {
      this.store.events.append('run.started', { taskId, runId: run.id }, this.now());

      if (task.kind === 'export_report') {
        // An export performs no model work: it prepares the immutable
        // proposal, waits for the owner, and writes only after every
        // revalidation passes. Nothing here can be prompted into existing.
        // The run's wall-clock deadline does not govern the owner's decision
        // window; the approval TTL does.
        clearTimeout(deadlineTimer);
        await this.#exportPipeline.run(task, run.id, controller.signal);
        return;
      }

      if (!this.provider) {
        throw new ProviderMissingError(
          'No model provider is configured. Store an OpenAI key in Settings to ' +
            'enable model-backed execution.',
        );
      }
      if (task.request.length > this.limits.maxInputChars) {
        throw new LimitReachedError(
          'max_input',
          `Request of ${task.request.length} characters exceeds the ` +
            `${this.limits.maxInputChars} character input limit.`,
        );
      }

      const isProjectUpdate = task.kind === 'project_update';
      const isWeeklyPlan = task.kind === 'weekly_plan';
      const toolCtx = new RunToolRecords();
      let runTools: AgentTool[];
      if (isProjectUpdate || isWeeklyPlan) {
        // The read tool re-reads the project's grants from the store at every
        // call, so revocation after enqueue (or mid-run) stops access at once.
        const fileTool = createReadProjectFileTool({
          getRoots: () => this.#grantsForTask(task.projectId),
        });
        runTools = [fileTool];
      } else {
        runTools = this.tools;
      }
      // Memory proposals are available to every model-backed run, but only
      // project-scoped tasks may propose project facts (enforced by the tool).
      const proposeMemoryTool = createProposeMemoryTool({
        store: this.store,
        task,
        runId: run.id,
        now: () => this.now(),
      });
      runTools = [
        ...runTools.filter((tool) => tool.definition.name !== proposeMemoryTool.definition.name),
        proposeMemoryTool,
      ];
      // Approved memory is loaded from Markdown at run start: pending
      // proposals are never retrieved, and another project's file is never
      // read. Context problems are disclosed rather than silently dropped.
      const memoryContext = this.store.memory.contextForTask(task.projectId);
      if (memoryContext.text.length > 0 || memoryContext.problems.length > 0) {
        this.store.events.append(
          'memory.used',
          {
            taskId,
            runId: run.id,
            payload: {
              globalEntries: memoryContext.globalEntries,
              projectEntries: memoryContext.projectEntries,
              chars: memoryContext.chars,
              truncated: memoryContext.truncated,
              entryIds: memoryContext.entryIds,
              problems: memoryContext.problems,
            },
          },
          this.now(),
        );
      }
      // Per-run dispatch map: project updates carry a tool bound to this
      // task's project, which is not part of the constructor-level tool set.
      const runToolsByName = new Map(runTools.map((tool) => [tool.definition.name, tool]));
      const messages: AgentMessage[] = [
        {
          role: 'system',
          content: workflowPolicy(task),
        },
      ];
      const userContent = isWeeklyPlan
        ? this.#workflowBuilders.buildWeeklyPlanUserContent(
            task,
            toolCtx,
            controller.signal,
            memoryContext.text,
          )
        : isProjectUpdate
          ? this.#workflowBuilders.buildProjectUpdateUserContent(
              task,
              toolCtx,
              controller.signal,
              memoryContext.text,
            )
          : await this.#workflowBuilders.buildUserContent(
              task,
              {
                taskId,
                runId: run.id,
                ctx: toolCtx,
                signal: controller.signal,
              },
              memoryContext.text,
            );
      messages.push({ role: 'user', content: userContent });

      let webSearchSkippedReason: string | null = null;
      const runWarnings: string[] = [];

      for (let step = 1; step <= this.limits.maxSteps; step += 1) {
        if (Date.now() >= deadlineMs) {
          throw new LimitReachedError(
            'wall_clock',
            `Run exceeded its ${this.limits.maxWallClockMs} ms wall-clock limit.`,
          );
        }
        if (controller.signal.aborted) {
          throw this.abortOutcome(deadlineMs);
        }
        let result;
        try {
          result = await this.provider.step({
            messages,
            tools: runTools.map((tool) => tool.definition),
            step,
            signal: controller.signal,
            // Hosted web search is offered only to web-grounded workflows;
            // file-grounded runs never send (or pay for) provider searches.
            webSearch: task.kind === 'research_brief',
          });
        } catch (err) {
          if (controller.signal.aborted || isAbortError(err)) {
            throw this.abortOutcome(deadlineMs);
          }
          throw err;
        }
        this.#accumulateUsage(usage, result.usage);
        if (result.webSearchSkippedReason && webSearchSkippedReason === null) {
          webSearchSkippedReason = result.webSearchSkippedReason;
          this.store.events.append(
            'tool.executed',
            {
              taskId,
              runId: run.id,
              payload: {
                tool: 'web_search_skipped',
                hosted: true,
                ok: false,
                step,
                riskTier: 'auto',
                reason: webSearchSkippedReason,
              },
            },
            this.now(),
          );
        }
        if (result.warnings) {
          for (const warning of result.warnings) {
            if (!runWarnings.includes(warning)) {
              runWarnings.push(warning);
            }
          }
        }
        if (result.kind === 'final') {
          const extraNotes: string[] = [];
          if (webSearchSkippedReason && !result.text.includes(webSearchSkippedReason)) {
            extraNotes.push(`> [!NOTE]\n> ${webSearchSkippedReason}`);
          }
          for (const warning of runWarnings) {
            if (warning !== webSearchSkippedReason && !result.text.includes(warning)) {
              extraNotes.push(`> [!WARNING]\n> ${warning}`);
            }
          }
          const finalText =
            extraNotes.length > 0 ? `${result.text}\n\n${extraNotes.join('\n\n')}` : result.text;
          steps += 1;
          outputChars = finalText.length;
          if (outputChars > this.limits.maxOutputChars) {
            throw new LimitReachedError(
              'max_output',
              `Output of ${outputChars} characters exceeds the ` +
                `${this.limits.maxOutputChars} character limit.`,
            );
          }
          // Rows land before log events: a failed event append is recoverable
          // in the drain catch, but a task row left behind by a failed run
          // row is not. The artifact is created before the run is finalized
          // so a persistence failure still classifies as a normal run failure.
          let artifact: Artifact;
          try {
            artifact = this.reportArtifact(task, finalText, toolCtx);
          } catch (err) {
            throw new ExecutorInternalError(
              `Failed to save the result artifact: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
          this.store.runs.finish(run.id, 'completed', this.now(), {
            usage: { steps, inputChars, outputChars, ...usage },
          });
          this.store.tasks.transition(taskId, 'completed', this.now(), {
            resultArtifactId: artifact.id,
          });
          this.store.events.append(
            'run.completed',
            { taskId, runId: run.id },
            this.now(),
          );
          this.store.events.append(
            'task.completed',
            { taskId, runId: run.id, payload: { artifactId: artifact.id, steps } },
            this.now(),
          );
          return;
        }

        steps += 1;
        if (result.searches > 0) {
          this.store.events.append(
            'tool.executed',
            {
              taskId,
              runId: run.id,
              payload: { tool: 'web_search', hosted: true, count: result.searches, step, riskTier: 'auto' },
            },
            this.now(),
          );
        }
        messages.push({ role: 'tool_calls', calls: result.calls });
        await this.#executeToolCalls(taskId, run.id, step, result.calls, messages, runToolsByName, toolCtx, controller.signal);
      }
      throw new LimitReachedError(
        'max_steps',
        `Run reached its ${this.limits.maxSteps} step limit without finishing.`,
      );
    } catch (err) {
      this.finalizeFailure(
        taskId,
        run.id,
        { steps, inputChars, outputChars, ...usage },
        err,
      );
    } finally {
      clearTimeout(deadlineTimer);
      this.#active = null;
    }
  }

  async #executeToolCalls(
    taskId: string,
    runId: string,
    step: number,
    calls: Array<{ id: string; name: string; argsJson: string }>,
    messages: AgentMessage[],
    toolsByName: Map<string, AgentTool>,
    ctx: RunToolRecords,
    signal: AbortSignal,
  ): Promise<void> {
    const callable = calls.slice(0, MAX_TOOL_CALLS_PER_STEP);
    for (const call of callable) {
      const tool = toolsByName.get(call.name);
      const outcome = tool
        ? await this.#runTool(tool, call.argsJson, ctx, signal)
        : { ok: false, content: `Unknown tool: ${call.name}`, durationMs: 0 };
      this.store.events.append(
        'tool.executed',
        {
          taskId,
          runId,
          payload: {
            tool: call.name,
            riskTier: 'auto',
            step,
            durationMs: outcome.durationMs,
            ok: outcome.ok,
          },
        },
        this.now(),
      );
      let content = outcome.content;
      if (content.length > MAX_TOOL_RESULT_CHARS) {
        content = `${content.slice(0, MAX_TOOL_RESULT_CHARS)}\n[...truncated...]`;
      }
      messages.push({
        role: 'tool_result',
        callId: call.id,
        name: call.name,
        ok: outcome.ok,
        content,
      });
    }
    for (const call of calls.slice(MAX_TOOL_CALLS_PER_STEP)) {
      messages.push({
        role: 'tool_result',
        callId: call.id,
        name: call.name,
        ok: false,
        content: 'Too many tool calls in one step',
      });
    }
  }

  /** Runs one tool call, converting thrown errors into visible failures. */
  async #runTool(
    tool: AgentTool,
    argsJson: string,
    ctx: RunToolContext,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; content: string; durationMs: number }> {
    const startedAt = Date.now();
    try {
      const parsed: unknown = JSON.parse(argsJson);
      if (typeof parsed !== 'object' || parsed === null) {
        return { ok: false, content: 'Invalid arguments', durationMs: 0 };
      }
    } catch {
      return { ok: false, content: 'Invalid arguments', durationMs: 0 };
    }
    const outcome = await tool
      .execute(argsJson, ctx, signal)
      .catch((err: unknown): { ok: boolean; content: string } => ({
        ok: false,
        content: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
      }));
    return { ...outcome, durationMs: Date.now() - startedAt };
  }

  /** Sums provider token counts; stays null while the provider reports none. */
  #accumulateUsage(target: ProviderUsage, reported: ProviderUsage): void {
    if (reported.inputTokens !== null) {
      target.inputTokens = (target.inputTokens ?? 0) + reported.inputTokens;
    }
    if (reported.outputTokens !== null) {
      target.outputTokens = (target.outputTokens ?? 0) + reported.outputTokens;
    }
  }

  /**
   * Current grants for a task's project, re-read from the store on every
   * call; an empty array when the task is not project-scoped.
   */
  #grantsForTask(projectId: string | null): GrantRootView[] {
    if (!projectId) {
      return [];
    }
    return this.store.projects
      .listGrants(projectId)
      .map((grant) => ({ id: grant.id, path: grant.path }));
  }

  /** Classify an abort: shutdown → interrupted, deadline → wall-clock limit,
   * otherwise the owner canceled. The timer fires at the deadline, so the
   * same millisecond still counts as limit reached (>=, not >). */
  private abortOutcome(deadlineMs: number): Error {
    if (this.#shutdown) {
      return abortError();
    }
    if (Date.now() >= deadlineMs) {
      return new LimitReachedError(
        'wall_clock',
        `Run exceeded its ${this.limits.maxWallClockMs} ms wall-clock limit.`,
      );
    }
    return abortError();
  }

  private finishRun(
    taskId: string,
    runId: string,
    to: 'completed' | 'failed' | 'canceled' | 'interrupted',
    details: {
      usage: RunUsage;
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
    usage: RunUsage,
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
    } else if (err instanceof SourceUnavailableError) {
      failure = { code: 'source_unavailable', message: err.message, limitHit: null };
    } else if (err instanceof ExportRefusedError) {
      failure = { code: 'export_refused', message: err.message, limitHit: null };
    } else if (err instanceof ExecutorInternalError) {
      failure = { code: 'internal', message: err.message, limitHit: null };
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
    this.#notifyFailure({
      taskId,
      runId,
      code: failure.code,
      message: failure.message,
      limitHit: failure.limitHit,
    });
  }

  #notifyFailure(failure: ExecutorFailureInfo): void {
    try {
      this.#onFailure?.(failure);
    } catch {
      // Logging observers must never break run finalization.
    }
  }

  private reportArtifact(task: Task, finalText: string, records: RunToolRecords): Artifact {
    const markdown = reportMarkdown(task, finalText, records);
    const isProjectUpdate = task.kind === 'project_update';
    const isWeeklyPlan = task.kind === 'weekly_plan';
    return this.store.artifacts.create(
      task.id,
      markdown,
      this.now(),
      isWeeklyPlan ? 'weekly_plan' : isProjectUpdate ? 'project_update' : 'report',
    );
  }

  #requireTask(taskId: string): Task {
    const task = this.store.tasks.get(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }
    return task;
  }
}
