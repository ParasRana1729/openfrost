import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InvalidApprovalTransitionError } from '@openfrost/domain';
import { createStore, openDatabase, type OpenDatabaseResult, type Store } from '@openfrost/db';
import {
  ExportRefusedError,
  TaskExecutor,
} from '../src/index.js';
import type { ScriptedStep } from '../src/index.js';

/** Anchored to the real clock so approval TTL timers (which run on the real
 * event loop) fire deterministically even though executor now() is frozen. */
const T0 = Date.now() - 3_600_000;
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

let home: string;
let opened: OpenDatabaseResult;
let store: Store;
let exportsDir: string;
let canonicalDir: string;
let destinationId: string;

const ARTIFACT_BODY = '# Weekly update\n\nThe notes state progress was made.\n';

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'openfrost-s04-home-'));
  opened = openDatabase(home);
  store = createStore(opened.db);
  exportsDir = mkdtempSync(join(tmpdir(), 'openfrost-s04-dest-'));
  canonicalDir = fs.realpathSync(exportsDir);
  destinationId = store.exportDestinations.add(canonicalDir, at(0)).id;
});

afterAll(() => {
  opened.sqlite.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(exportsDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Every test starts from a clean destination folder.
  for (const entry of fs.readdirSync(canonicalDir)) {
    fs.rmSync(join(canonicalDir, entry), { recursive: true, force: true });
  }
});

/** Waits until the task reaches the given state (the drain stays busy while
 * a run parks awaiting approval, so polling is the deterministic wait). */
async function waitForState(taskId: string, state: string): Promise<void> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (store.tasks.get(taskId)?.state === state) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`task never reached ${state}`);
}

function makeExecutor(steps: ScriptedStep[] = [], approvalTtlMs = 60_000): TaskExecutor {
  return new TaskExecutor({
    store,
    // Exports never call the model; provider null also proves exports work
    // without any configured key.
    provider: null,
    now: () => at(0),
    approvalTtlMs,
  });
}

function seedArtifact(): string {
  return store.artifacts.create(null, ARTIFACT_BODY, at(1)).id;
}

describe('approval-bound export flow', () => {
  it('proposes, parks the task, executes on approval, and records the outcome', async () => {
    const artifactId = seedArtifact();
    const executor = makeExecutor();
    const task = await executor.enqueueExport({
      artifactId,
      destinationId,
      filename: 'weekly-update.md',
    });
    await waitForState(task.id, 'awaiting_approval');

    // The run parks in awaiting_approval while the approval is pending.
    const parked = store.tasks.get(task.id);
    expect(parked?.state).toBe('awaiting_approval');
    const approval = store.approvals.getForTask(task.id);
    expect(approval?.state).toBe('pending');
    expect(approval?.filename).toBe('weekly-update.md');
    expect(approval?.destinationPath).toBe(canonicalDir);
    expect(approval?.riskTier).toBe('telegram');
    expect(fs.existsSync(join(canonicalDir, 'weekly-update.md'))).toBe(false);

    // The owner grants; the write happens and every record reflects it.
    const decided = executor.decideApproval(approval!.id, 'granted');
    expect(decided.state).toBe('granted');
    await executor.whenIdle();

    const written = join(canonicalDir, 'weekly-update.md');
    expect(fs.readFileSync(written, 'utf8')).toBe(ARTIFACT_BODY);
    const executed = store.approvals.get(approval!.id);
    expect(executed?.state).toBe('executed');
    expect(executed?.outcome?.file).toBe(written);
    expect(executed?.outcome?.bytes).toBe(Buffer.byteLength(ARTIFACT_BODY, 'utf8'));
    const finished = store.tasks.get(task.id);
    expect(finished?.state).toBe('completed');
    expect(finished?.resultArtifactId).toBe(artifactId);
    const events = store.events.listForTask(task.id).map((e) => e.type);
    expect(events).toContain('approval.requested');
    expect(events).toContain('approval.granted');
    expect(events).toContain('export.written');
    expect(store.runs.get(finished!.lastRunId!)?.state).toBe('completed');
  });

  it('rejecting prevents execution and cancels the task without writing', async () => {
    const artifactId = seedArtifact();
    const executor = makeExecutor();
    const task = await executor.enqueueExport({
      artifactId,
      destinationId,
      filename: 'rejected.md',
    });
    await waitForState(task.id, 'awaiting_approval');
    const approval = store.approvals.getForTask(task.id)!;

    executor.decideApproval(approval.id, 'rejected');
    await executor.whenIdle();

    expect(fs.existsSync(join(canonicalDir, 'rejected.md'))).toBe(false);
    const rejected = store.approvals.get(approval.id);
    expect(rejected?.state).toBe('rejected');
    expect(rejected?.outcome).toBeNull();
    expect(store.tasks.get(task.id)?.state).toBe('canceled');
  });

  it('refuses a second decision on an already-decided approval', async () => {
    const artifactId = seedArtifact();
    const executor = makeExecutor();
    const task = await executor.enqueueExport({
      artifactId,
      destinationId,
      filename: 'duplicate.md',
    });
    await waitForState(task.id, 'awaiting_approval');
    const approval = store.approvals.getForTask(task.id)!;
    executor.decideApproval(approval.id, 'granted');
    await executor.whenIdle();
    expect(store.tasks.get(task.id)?.state).toBe('completed');

    expect(() => executor.decideApproval(approval.id, 'granted')).toThrowError(
      InvalidApprovalTransitionError,
    );
    expect(() => executor.decideApproval(approval.id, 'rejected')).toThrowError(
      InvalidApprovalTransitionError,
    );
    // Exactly one file exists — the duplicate decision wrote nothing.
    expect(fs.readdirSync(canonicalDir)).toEqual(['duplicate.md']);
  });

  it('expires an approval nobody decided and writes nothing', async () => {
    const artifactId = seedArtifact();
    const executor = makeExecutor([], 30);
    const task = await executor.enqueueExport({
      artifactId,
      destinationId,
      filename: 'expired.md',
    });
    // The 30 ms TTL fires while the owner never decides.
    await waitForState(task.id, 'canceled');
    const approval = store.approvals.getForTask(task.id)!;
    expect(approval.state).toBe('expired');
    expect(fs.existsSync(join(canonicalDir, 'expired.md'))).toBe(false);
  });

  it('fails with export_refused when the destination was removed after enqueue', async () => {
    const artifactId = seedArtifact();
    const tempDestination = store.exportDestinations.add(
      fs.realpathSync(mkdtempSync(join(tmpdir(), 'openfrost-s04-temp-'))),
      at(2),
    ).id;
    const executor = makeExecutor();
    // Hold the queue so the removal happens before the run proposes.
    executor.pauseDispatch('test: hold queue');
    const task = await executor.enqueueExport({
      artifactId,
      destinationId: tempDestination,
      filename: 'gone.md',
    });
    store.exportDestinations.remove(tempDestination);
    executor.resumeDispatch();
    await executor.whenIdle();

    const failed = store.tasks.get(task.id)!;
    expect(failed.state).toBe('failed');
    const run = store.runs.get(failed.lastRunId!);
    expect(run?.failure?.code).toBe('export_refused');
    // The refusal happened at proposal time, so no approval row exists yet.
    expect(store.approvals.getForTask(task.id)).toBeNull();
  });

  it('refuses to overwrite when the target appears after the proposal', async () => {
    const artifactId = seedArtifact();
    const executor = makeExecutor();
    const task = await executor.enqueueExport({
      artifactId,
      destinationId,
      filename: 'appears.md',
    });
    await waitForState(task.id, 'awaiting_approval');
    const approval = store.approvals.getForTask(task.id)!;
    // The file appears while the owner is deciding.
    fs.writeFileSync(join(canonicalDir, 'appears.md'), 'mine first');
    executor.decideApproval(approval.id, 'granted');
    await executor.whenIdle();

    expect(fs.readFileSync(join(canonicalDir, 'appears.md'), 'utf8')).toBe('mine first');
    const failed = store.tasks.get(task.id)!;
    expect(failed.state).toBe('failed');
    expect(store.runs.get(failed.lastRunId!)?.failure?.code).toBe('export_refused');
    expect(store.approvals.get(approval.id)?.refusalReason).toContain('never overwrite');
  });

  it('refuses when the artifact content changed after the proposal', async () => {
    const artifactId = seedArtifact();
    const executor = makeExecutor();
    const task = await executor.enqueueExport({
      artifactId,
      destinationId,
      filename: 'tampered.md',
    });
    await waitForState(task.id, 'awaiting_approval');
    const approval = store.approvals.getForTask(task.id)!;
    opened.sqlite
      .prepare('UPDATE artifacts SET markdown = ? WHERE id = ?')
      .run('# Tampered\n', artifactId);
    executor.decideApproval(approval.id, 'granted');
    await executor.whenIdle();

    expect(fs.existsSync(join(canonicalDir, 'tampered.md'))).toBe(false);
    expect(store.tasks.get(task.id)?.state).toBe('failed');
    expect(store.approvals.get(approval.id)?.refusalReason).toContain('changed');
  });

  it('refuses when the destination folder moved after approval', async () => {
    const artifactId = seedArtifact();
    const executor = makeExecutor();
    const task = await executor.enqueueExport({
      artifactId,
      destinationId,
      filename: 'moved.md',
    });
    await waitForState(task.id, 'awaiting_approval');
    const approval = store.approvals.getForTask(task.id)!;
    // Move the destination away; the grant no longer resolves.
    const movedTo = join(tmpdir(), `openfrost-s04-moved-${Date.now()}`);
    fs.renameSync(canonicalDir, movedTo);
    try {
      executor.decideApproval(approval.id, 'granted');
      await executor.whenIdle();
      expect(store.tasks.get(task.id)?.state).toBe('failed');
      expect(store.approvals.get(approval.id)?.refusalReason).toContain('no longer accessible');
      expect(fs.existsSync(join(movedTo, 'moved.md'))).toBe(false);
    } finally {
      fs.renameSync(movedTo, canonicalDir);
    }
  });

  it('canceling the awaiting task cancels the approval and writes nothing', async () => {
    const artifactId = seedArtifact();
    const executor = makeExecutor();
    const task = await executor.enqueueExport({
      artifactId,
      destinationId,
      filename: 'canceled.md',
    });
    await waitForState(task.id, 'awaiting_approval');
    const approval = store.approvals.getForTask(task.id)!;
    executor.cancel(task.id);
    await executor.whenIdle();

    expect(store.tasks.get(task.id)?.state).toBe('canceled');
    const after = store.approvals.get(approval.id);
    expect(after?.state).toBe('canceled');
    expect(fs.existsSync(join(canonicalDir, 'canceled.md'))).toBe(false);
  });

  it('recovery cancels undecided and granted-but-unconfirmed approvals without replaying', async () => {
    // A run crashed while its export was awaiting review.
    const pendingArtifact = seedArtifact();
    const pendingTask = store.tasks.create(
      {
        title: 'Crashed pending',
        request: 'x',
        kind: 'export_report',
        exportArgs: { artifactId: pendingArtifact, destinationId, filename: 'crash-pending.md' },
      },
      at(3),
    );
    const pendingRun = store.tasks.startRun(pendingTask.id, at(3)).run;
    const pendingApproval = store.approvals.create(
      {
        taskId: pendingTask.id,
        runId: pendingRun.id,
        artifactId: pendingArtifact,
        destinationId,
        destinationPath: canonicalDir,
        filename: 'crash-pending.md',
        contentSha256: 'b'.repeat(64),
        expiresAt: at(3_600_000),
      },
      at(3),
    );
    // A run crashed after approval but before the outcome was confirmed.
    const grantedArtifact = seedArtifact();
    const grantedTask = store.tasks.create(
      {
        title: 'Crashed granted',
        request: 'x',
        kind: 'export_report',
        exportArgs: { artifactId: grantedArtifact, destinationId, filename: 'crash-granted.md' },
      },
      at(4),
    );
    const grantedRun = store.tasks.startRun(grantedTask.id, at(4)).run;
    const grantedApproval = store.approvals.create(
      {
        taskId: grantedTask.id,
        runId: grantedRun.id,
        artifactId: grantedArtifact,
        destinationId,
        destinationPath: canonicalDir,
        filename: 'crash-granted.md',
        contentSha256: 'c'.repeat(64),
        expiresAt: at(3_600_000),
      },
      at(4),
    );
    store.approvals.decide(grantedApproval.id, 'granted', at(5));

    const executor = makeExecutor();
    const recovery = executor.recover();
    expect(recovery.dispatchPaused).toBe(true);

    const pendingAfter = store.approvals.get(pendingApproval.id)!;
    expect(pendingAfter.state).toBe('canceled');
    expect(pendingAfter.refusalReason).toContain('awaiting review');
    const grantedAfter = store.approvals.get(grantedApproval.id)!;
    expect(grantedAfter.state).toBe('canceled');
    expect(grantedAfter.refusalReason).toContain('may or may not exist');
    // Nothing was written by recovery.
    expect(fs.existsSync(join(canonicalDir, 'crash-pending.md'))).toBe(false);
    expect(fs.existsSync(join(canonicalDir, 'crash-granted.md'))).toBe(false);
    expect(store.tasks.get(pendingTask.id)?.state).toBe('interrupted');
    expect(store.tasks.get(grantedTask.id)?.state).toBe('interrupted');
    // Recovery paused dispatch globally; resume so later tests drain.
    executor.resumeDispatch();
  });

  it('re-running a completed export refuses instead of overwriting', async () => {
    const artifactId = seedArtifact();
    const executor = makeExecutor();
    const task = await executor.enqueueExport({
      artifactId,
      destinationId,
      filename: 'once.md',
    });
    await waitForState(task.id, 'awaiting_approval');
    executor.decideApproval(store.approvals.getForTask(task.id)!.id, 'granted');
    await executor.whenIdle();
    expect(store.tasks.get(task.id)?.state).toBe('completed');

    const second = await executor.enqueueExport({
      artifactId,
      destinationId,
      filename: 'once.md',
    });
    await executor.whenIdle();
    const failed = store.tasks.get(second.id)!;
    expect(failed.state).toBe('failed');
    expect(store.runs.get(failed.lastRunId!)?.failure?.code).toBe('export_refused');
    expect(fs.readFileSync(join(canonicalDir, 'once.md'), 'utf8')).toBe(ARTIFACT_BODY);
  });

  it('aborts cleanly when the abort signal fires before the decision', async () => {
    const artifactId = seedArtifact();
    const executor = makeExecutor();
    const task = await executor.enqueueExport({
      artifactId,
      destinationId,
      filename: 'abort.md',
    });
    await waitForState(task.id, 'awaiting_approval');
    const approval = store.approvals.getForTask(task.id)!;
    // Cancel through the executor (the normal owner path) while parked.
    executor.cancel(task.id);
    await executor.whenIdle();
    expect(store.tasks.get(task.id)?.state).toBe('canceled');
    expect(store.approvals.get(approval.id)?.state).toBe('canceled');
  });
});
