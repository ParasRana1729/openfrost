import { describe, expect, it } from 'vitest';
import {
  APPROVAL_TRANSITIONS,
  DEFAULT_APPROVAL_TTL_MS,
  InvalidApprovalTransitionError,
  approvalSchema,
  canTransitionApproval,
  createExportRequestSchema,
  exportFilenameSchema,
  transitionApproval,
  type Approval,
} from '../src/index.js';

const NOW = '2026-10-25T21:00:00.000Z';

function sampleApproval(overrides: Partial<Approval> = {}): Approval {
  return approvalSchema.parse({
    id: 'approval-1',
    taskId: 'task-1',
    runId: 'run-1',
    action: 'export_file',
    artifactId: 'artifact-1',
    destinationId: 'dest-1',
    destinationPath: 'C:\\Users\\owner\\Exports',
    filename: 'weekly-update.md',
    contentSha256: 'a'.repeat(64),
    riskTier: 'telegram',
    state: 'pending',
    requestedAt: NOW,
    expiresAt: '2026-10-26T21:00:00.000Z',
    decidedAt: null,
    executedAt: null,
    outcome: null,
    refusalReason: null,
    ...overrides,
  });
}

describe('approval schema', () => {
  it('accepts a valid pending export approval', () => {
    const approval = sampleApproval();
    expect(approval.state).toBe('pending');
    expect(approval.riskTier).toBe('telegram');
  });

  it('rejects unknown fields, bad hashes, unsafe filenames, and other risk tiers', () => {
    expect(() => sampleApproval({ surprise: true })).toThrowError();
    expect(() => sampleApproval({ contentSha256: 'short' })).toThrowError();
    expect(() => sampleApproval({ filename: '..\\evil.md' })).toThrowError();
    expect(() => sampleApproval({ riskTier: 'auto' as never })).toThrowError();
  });

  it('ships a 24h default TTL', () => {
    expect(DEFAULT_APPROVAL_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('approval state transitions', () => {
  it('allows exactly the declared edges across the full matrix', () => {
    const states = Object.keys(APPROVAL_TRANSITIONS) as Array<
      keyof typeof APPROVAL_TRANSITIONS
    >;
    for (const from of states) {
      for (const to of states) {
        expect(canTransitionApproval(from, to)).toBe(
          APPROVAL_TRANSITIONS[from].includes(to),
        );
      }
    }
  });

  it('pending can be decided, canceled, or expired; granted can only execute, cancel, or expire', () => {
    expect(canTransitionApproval('pending', 'granted')).toBe(true);
    expect(canTransitionApproval('pending', 'rejected')).toBe(true);
    expect(canTransitionApproval('granted', 'executed')).toBe(true);
    expect(canTransitionApproval('granted', 'rejected')).toBe(false);
    expect(canTransitionApproval('executed', 'executed')).toBe(false);
  });

  it('transitionApproval stamps decidedAt only for owner decisions', () => {
    const granted = transitionApproval(sampleApproval(), 'granted', NOW);
    expect(granted.state).toBe('granted');
    expect(granted.decidedAt).toBe(NOW);
    const expired = transitionApproval(sampleApproval(), 'expired', NOW);
    expect(expired.decidedAt).toBeNull();
    expect(() => transitionApproval(granted, 'rejected', NOW)).toThrowError(
      InvalidApprovalTransitionError,
    );
  });
});

describe('export filename schema', () => {
  it('accepts plain markdown filenames', () => {
    expect(exportFilenameSchema.parse('weekly-update.md')).toBe('weekly-update.md');
    expect(exportFilenameSchema.parse('Report (v2 final).md')).toBeTruthy();
  });

  it('rejects folders, separators, non-md, trailing dots/spaces, and reserved names', () => {
    expect(exportFilenameSchema.safeParse('sub/evil.md').success).toBe(false);
    expect(exportFilenameSchema.safeParse('..\\evil.md').success).toBe(false);
    expect(exportFilenameSchema.safeParse('evil.txt').success).toBe(false);
    expect(exportFilenameSchema.safeParse('no-extension').success).toBe(false);
    expect(exportFilenameSchema.safeParse('trailing space.md ').success).toBe(false);
    expect(exportFilenameSchema.safeParse('trailingdot.md.').success).toBe(false);
    expect(exportFilenameSchema.safeParse('con.md').success).toBe(false);
    expect(exportFilenameSchema.safeParse('LPT1.md').success).toBe(false);
    expect(exportFilenameSchema.safeParse('').success).toBe(false);
    expect(exportFilenameSchema.safeParse(`${'a'.repeat(101)}.md`).success).toBe(false);
    // Interior dots and a space before the extension are legal, safe names.
    expect(exportFilenameSchema.safeParse('bad name..md').success).toBe(true);
    expect(exportFilenameSchema.safeParse('bad name .md').success).toBe(true);
  });
});

describe('createExportRequest schema', () => {
  it('accepts artifact, destination, and a safe filename', () => {
    const parsed = createExportRequestSchema.parse({
      artifactId: 'artifact-1',
      destinationId: 'dest-1',
      filename: 'report.md',
    });
    expect(parsed.filename).toBe('report.md');
  });

  it('rejects unsafe filenames and unknown fields', () => {
    expect(() =>
      createExportRequestSchema.parse({
        artifactId: 'a',
        destinationId: 'd',
        filename: '../escape.md',
      }),
    ).toThrowError();
    expect(() =>
      createExportRequestSchema.parse({
        artifactId: 'a',
        destinationId: 'd',
        filename: 'report.md',
        extra: 1,
      }),
    ).toThrowError();
  });
});
