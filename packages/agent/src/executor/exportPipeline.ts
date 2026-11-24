import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Store } from '@openfrost/db';
import type { Approval, RunUsage, Task } from '@openfrost/domain';
import { revalidateGrantRoot } from '../tools/projectFiles.js';
import { abortError, ExecutorInternalError } from './errors.js';

/** A granted export that failed execution-time revalidation. Never silent. */
export class ExportRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportRefusedError';
  }
}

class ExportAbandonedError extends Error {
  constructor(
    message: string,
    public readonly kind: 'rejected' | 'expired' | 'canceled',
  ) {
    super(message);
    this.name = 'ExportAbandonedError';
  }
}

/** The approval pipeline never owns queue dispatch or the global run lock. */
export class ExportPipeline {
  constructor(
    private readonly store: Store,
    private readonly now: () => string,
    private readonly approvalTtlMs: number,
    private readonly approvalWaiters: Map<string, (decision: 'granted' | 'rejected') => void>,
  ) {}

  /**
   * The approval-bound export flow (spec §6): propose → await the owner →
   * revalidate everything → write once with a create-only flag. A refusal at
   * any point fails the run with `export_refused` and marks the approval
   * canceled with the reason; nothing is ever retried automatically.
   */
  async run(task: Task, runId: string, signal: AbortSignal): Promise<void> {
    const args = task.exportArgs;
    if (!args) {
      throw new ExecutorInternalError('Export task is missing its immutable export arguments.');
    }
    const requestedAt = this.now();
    const proposal = this.prepareProposal(task, runId, args, requestedAt);
    const approval = proposal.approval;
    this.store.events.append(
      'approval.requested',
      {
        taskId: task.id,
        runId,
        payload: {
          approvalId: approval.id,
          action: approval.action,
          riskTier: approval.riskTier,
          destinationPath: approval.destinationPath,
          filename: approval.filename,
          contentSha256: approval.contentSha256,
          bytes: proposal.bytes,
          expiresAt: approval.expiresAt,
        },
      },
      requestedAt,
    );
    this.store.tasks.transition(task.id, 'awaiting_approval', requestedAt);

    try {
      const decision = await this.awaitDecision(approval.id, approval.expiresAt, signal);
      // Reload the approval: it now carries the owner's decision.
      const decided = this.store.approvals.get(approval.id);
      if (!decided) {
        throw new ExecutorInternalError(`Approval ${approval.id} disappeared after decision.`);
      }
      if (decision === 'rejected') {
        throw new ExportAbandonedError(
          'The owner rejected the export. Nothing was written.',
          'rejected',
        );
      }
      // The owner decided; the run resumes (awaiting_approval → running is
      // the resumption edge in the task transition map) before the write.
      this.store.tasks.transition(task.id, 'running', this.now());
      if (decided.expiresAt <= this.now()) {
        // Granted, but the decision window closed before execution could run.
        this.store.approvals.decide(decided.id, 'expired', this.now());
        this.store.events.append(
          'approval.expired',
          { taskId: task.id, runId, payload: { approvalId: decided.id } },
          this.now(),
        );
        throw new ExportAbandonedError(
          'The approval expired before the export could execute. Nothing was written.',
          'expired',
        );
      }

      // Execution-time revalidation: nothing below trusts the proposal moment.
      const outcome = this.executeGrantedExport(decided);
      this.store.approvals.markExecuted(
        decided.id,
        outcome,
        this.now(),
      );
      this.store.events.append(
        'export.written',
        {
          taskId: task.id,
          runId,
          payload: {
            approvalId: decided.id,
            file: outcome.file,
            bytes: outcome.bytes,
          },
        },
        this.now(),
      );
      const usage: RunUsage = { steps: 1, inputChars: task.request.length, outputChars: 0, inputTokens: null, outputTokens: null };
      this.store.runs.finish(runId, 'completed', this.now(), { usage });
      this.store.tasks.transition(task.id, 'completed', this.now(), {
        resultArtifactId: decided.artifactId,
      });
      this.store.events.append('run.completed', { taskId: task.id, runId }, this.now());
      this.store.events.append(
        'task.completed',
        { taskId: task.id, runId, payload: { approvalId: decided.id, exported: outcome.file } },
        this.now(),
      );
    } catch (err) {
      if (err instanceof ExportAbandonedError) {
        if (err.kind === 'rejected') {
          // The approval is already 'rejected' in the store; finish honestly.
          const usage: RunUsage = { steps: 1, inputChars: task.request.length, outputChars: 0, inputTokens: null, outputTokens: null };
          this.store.runs.finish(runId, 'canceled', this.now(), { usage });
          this.store.tasks.transition(task.id, 'canceled', this.now(), {
            error: err.message,
          });
          this.store.events.append('task.canceled', { taskId: task.id, runId, payload: { reason: 'export_rejected' } }, this.now());
          return;
        }
        if (err.kind === 'expired') {
          // The approval is still pending in the store; expire it explicitly.
          this.store.approvals.decide(approval.id, 'expired', this.now());
          this.store.events.append(
            'approval.expired',
            { taskId: task.id, runId, payload: { approvalId: approval.id } },
            this.now(),
          );
          const usage: RunUsage = { steps: 1, inputChars: task.request.length, outputChars: 0, inputTokens: null, outputTokens: null };
          this.store.runs.finish(runId, 'canceled', this.now(), { usage });
          this.store.tasks.transition(task.id, 'canceled', this.now(), {
            error: err.message,
          });
          this.store.events.append('task.canceled', { taskId: task.id, runId, payload: { reason: 'approval_expired' } }, this.now());
          return;
        }
        // 'canceled': the owner canceled the task while it was awaiting
        // review. The abort path below finalizes the task; mark the approval.
        this.store.approvals.decide(approval.id, 'canceled', this.now());
        this.store.events.append(
          'approval.canceled',
          { taskId: task.id, runId, payload: { approvalId: approval.id } },
          this.now(),
        );
        throw abortError();
      }
      if (err instanceof ExportRefusedError) {
        this.store.approvals.markRefused(approval.id, err.message, this.now());
        throw err;
      }
      throw err;
    }
  }

  /** Builds and persists the immutable approval proposal. */
  private prepareProposal(
    task: Task,
    runId: string,
    args: NonNullable<Task['exportArgs']>,
    now: string,
  ): { approval: Approval; bytes: number } {
    const artifact = this.store.artifacts.get(args.artifactId);
    if (!artifact) {
      throw new ExportRefusedError('The artifact proposed for export no longer exists.');
    }
    const bytes = Buffer.byteLength(artifact.markdown, 'utf8');
    const destination = this.store.exportDestinations.get(args.destinationId);
    if (!destination) {
      throw new ExportRefusedError(
        'The export destination no longer exists (it may have been removed in Settings).',
      );
    }
    // The grant must still resolve to the canonical folder recorded for it.
    const rootStatus = revalidateGrantRoot(destination.path);
    if (rootStatus.status !== 'valid') {
      throw new ExportRefusedError(
        `The export destination is not accessible: ${rootStatus.reason ?? 'unknown reason'}`,
      );
    }
    const target = path.join(rootStatus.canonical, args.filename);
    if (fs.existsSync(target)) {
      throw new ExportRefusedError(
        'A file with this name already exists in the destination. Exports never overwrite.',
      );
    }
    const contentSha256 = createHash('sha256').update(artifact.markdown).digest('hex');
    const approval = this.store.approvals.create(
      {
        taskId: task.id,
        runId,
        artifactId: artifact.id,
        destinationId: destination.id,
        destinationPath: rootStatus.canonical,
        filename: args.filename,
        contentSha256,
        expiresAt: new Date(Date.parse(now) + this.approvalTtlMs).toISOString(),
      },
      now,
    );
    return { approval, bytes };
  }

  /**
   * Waits for the owner's decision, an abort, or expiry — whichever comes
   * first. The waiter is resolved by decideApproval from the API.
   */
  private awaitDecision(approvalId: string, expiresAt: string, signal: AbortSignal): Promise<'granted' | 'rejected'> {
    return new Promise<'granted' | 'rejected'>((resolve, reject) => {
      let settled = false;
      const finish = (decision: 'granted' | 'rejected'): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        this.approvalWaiters.delete(approvalId);
        resolve(decision);
      };
      const onAbort = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.approvalWaiters.delete(approvalId);
        reject(new ExportAbandonedError('Export canceled while awaiting review.', 'canceled'));
      };
      const timer = setTimeout(
        () => {
          if (settled) {
            return;
          }
          settled = true;
          this.approvalWaiters.delete(approvalId);
          reject(new ExportAbandonedError('Export approval expired.', 'expired'));
        },
        Math.max(0, Date.parse(expiresAt) - Date.now()),
      );
      timer.unref?.();
      signal.addEventListener('abort', onAbort, { once: true });
      this.approvalWaiters.set(approvalId, finish);
      if (signal.aborted) {
        onAbort();
      }
    });
  }

  /**
   * The guarded write. Every check from the proposal moment is repeated:
   * approval state, TTL, artifact content hash, destination canonicalization,
   * and create-only target absence. The write itself is `wx` — a new file or
   * nothing.
   */
  private executeGrantedExport(approval: Approval): { file: string; bytes: number; ms: number } {
    const startedAt = Date.now();
    const current = this.store.approvals.get(approval.id);
    if (!current || current.state !== 'granted') {
      throw new ExportRefusedError('The approval is no longer in the granted state.');
    }
    if (current.expiresAt <= this.now()) {
      throw new ExportRefusedError('The approval expired before execution.');
    }
    const artifact = this.store.artifacts.get(current.artifactId);
    if (!artifact) {
      throw new ExportRefusedError('The artifact to export no longer exists.');
    }
    const contentSha256 = createHash('sha256').update(artifact.markdown).digest('hex');
    if (contentSha256 !== current.contentSha256) {
      throw new ExportRefusedError(
        'The artifact content changed after the export was proposed; the approval no longer applies.',
      );
    }
    const destination = this.store.exportDestinations.get(current.destinationId);
    if (!destination) {
      throw new ExportRefusedError('The export destination was removed after approval.');
    }
    const rootStatus = revalidateGrantRoot(destination.path);
    if (rootStatus.status !== 'valid') {
      throw new ExportRefusedError(
        `The export destination is no longer accessible: ${rootStatus.reason ?? 'unknown reason'}`,
      );
    }
    if (
      pathKeyOf(rootStatus.canonical) !== pathKeyOf(current.destinationPath)
    ) {
      throw new ExportRefusedError(
        'The destination folder changed (moved or replaced by a junction/symlink) after approval.',
      );
    }
    const target = path.join(rootStatus.canonical, current.filename);
    if (fs.existsSync(target)) {
      throw new ExportRefusedError(
        'A file with this name appeared in the destination after approval. Exports never overwrite.',
      );
    }
    try {
      // 'wx': create-only. The write is synchronous, so the outcome is known
      // before this returns — either the new file exists or nothing happened.
      fs.writeFileSync(target, artifact.markdown, { flag: 'wx', encoding: 'utf8' });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'error';
      throw new ExportRefusedError(`The write failed (${code}); nothing was written.`);
    }
    return {
      file: target,
      bytes: Buffer.byteLength(artifact.markdown, 'utf8'),
      ms: Date.now() - startedAt,
    };
  }

}

/** Case-folding key so Windows path comparisons are case-insensitive. */
function pathKeyOf(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

