import { z } from 'zod';

/**
 * Owner approval for a consequential action (spec §6). v0.1 has exactly one
 * action: exporting a saved artifact as a new Markdown file beneath an
 * explicitly granted export destination. The arguments are immutable from
 * proposal onward; every field is revalidated at execution, so a changed
 * destination, revoked grant, altered content, expiry, cancellation, or a
 * duplicate decision can never produce a second or unauthorized write.
 */

/**
 * A single safe Markdown filename (no directories). Windows-safe: no
 * separators, no trailing dot/space, reserved device names refused.
 */
export const exportFilenameSchema = z
  .string()
  .min(5)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._()-]*\.md$/, 'must be a .md filename without folders')
  .refine((name) => !name.endsWith(' ') && !name.endsWith('.'), {
    message: 'must not end with a space or dot',
  })
  .refine((name) => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name), {
    message: 'reserved Windows device name',
  });
export type ExportFilename = z.infer<typeof exportFilenameSchema>;

/** How long an undecided approval stays valid; afterwards it can only expire. */
export const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export const approvalStateSchema = z.enum([
  'pending',
  'granted',
  'rejected',
  'canceled',
  'expired',
  'executed',
]);
export type ApprovalState = z.infer<typeof approvalStateSchema>;

/** v0.1's single reviewable write. */
export const approvalActionSchema = z.enum(['export_file']);

export const approvalOutcomeSchema = z.strictObject({
  file: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  ms: z.number().int().nonnegative(),
});
export type ApprovalOutcome = z.infer<typeof approvalOutcomeSchema>;

export const approvalSchema = z.strictObject({
  id: z.string().min(1),
  taskId: z.string().min(1),
  runId: z.string().min(1),
  action: approvalActionSchema,
  /** Artifact whose exact markdown content is proposed for the write. */
  artifactId: z.string().min(1),
  /** Export destination grant; the destination path is snapshotted below. */
  destinationId: z.string().min(1),
  /** Canonical destination root as recorded at proposal time. */
  destinationPath: z.string().min(1),
  filename: exportFilenameSchema,
  /** sha256 of the artifact markdown at proposal; verified again at execution. */
  contentSha256: z.string().length(64),
  /** Standard writes carry the `telegram` identifier; v0.1 approves locally only. */
  riskTier: z.literal('telegram'),
  state: approvalStateSchema,
  requestedAt: z.string().min(1),
  expiresAt: z.string().min(1),
  decidedAt: z.string().min(1).nullable(),
  executedAt: z.string().min(1).nullable(),
  outcome: approvalOutcomeSchema.nullable(),
  /** Why a granted approval was refused at execution (revalidation failure). */
  refusalReason: z.string().nullable(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const APPROVAL_TRANSITIONS: Readonly<
  Record<ApprovalState, readonly ApprovalState[]>
> = {
  pending: ['granted', 'rejected', 'canceled', 'expired'],
  granted: ['executed', 'canceled', 'expired'],
  rejected: [],
  canceled: [],
  expired: [],
  executed: [],
};

export function canTransitionApproval(from: ApprovalState, to: ApprovalState): boolean {
  return APPROVAL_TRANSITIONS[from].includes(to);
}

export class InvalidApprovalTransitionError extends Error {
  constructor(
    public readonly from: ApprovalState,
    public readonly to: ApprovalState,
  ) {
    super(`Invalid approval state transition: ${from} -> ${to}`);
    this.name = 'InvalidApprovalTransitionError';
  }
}

/** Pure state transition; returns a copy with the new state. */
export function transitionApproval(
  approval: Approval,
  to: ApprovalState,
  now: string,
): Approval {
  if (!canTransitionApproval(approval.state, to)) {
    throw new InvalidApprovalTransitionError(approval.state, to);
  }
  const decided = to === 'granted' || to === 'rejected';
  return {
    ...approval,
    state: to,
    decidedAt: decided ? now : approval.decidedAt,
  };
}

/** Structured export arguments carried by an export task (immutable). */
export const exportArgsSchema = z.strictObject({
  artifactId: z.string().min(1),
  destinationId: z.string().min(1),
  filename: exportFilenameSchema,
});
export type ExportArgs = z.infer<typeof exportArgsSchema>;

/** API body for requesting an export. */
export const createExportRequestSchema = z.strictObject({
  artifactId: z.string().min(1),
  destinationId: z.string().min(1),
  filename: exportFilenameSchema,
});
export type CreateExportRequest = z.infer<typeof createExportRequestSchema>;

/** Owner-granted canonical folder root that exports may write into. */
export const exportDestinationSchema = z.strictObject({
  id: z.string().min(1),
  path: z.string().min(1),
  createdAt: z.string().min(1),
});
export type ExportDestination = z.infer<typeof exportDestinationSchema>;
