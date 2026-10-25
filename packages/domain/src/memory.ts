import { z } from 'zod';

/**
 * Durable memory (spec §4): owner-approved global preferences and project
 * facts. The assistant may propose an entry, but nothing becomes durable
 * context until the owner approves it. Canonical content lives in Markdown
 * (`memory/owner.md`, `projects/<id>/memory.md`); SQLite only indexes
 * metadata and pending proposals, never a second active copy.
 */

export const memoryScopeSchema = z.enum(['global', 'project']);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

/** Per-entry content bound; keeps memory readable, not a document store. */
export const MEMORY_CONTENT_MAX_CHARS = 4_000;
/** Entries per Markdown file; approval is refused past this instead of growing forever. */
export const MEMORY_MAX_ENTRIES_PER_FILE = 50;
/** Total memory text (global + active project) sent with one task. */
export const MEMORY_CONTEXT_MAX_CHARS = 6_000;
/** A memory file larger than this is treated as unreadable rather than parsed. */
export const MEMORY_FILE_MAX_BYTES = 256 * 1024;
/** Assistant proposals accepted per run; extras are refused visibly. */
export const MEMORY_MAX_PROPOSALS_PER_RUN = 3;

/**
 * Provenance for one memory. `task` memories were proposed by a run and then
 * approved by the owner; `owner` is reserved for owner-authored entries.
 * The label is a human-readable pointer (for example, the task title), not a
 * copy of the source content.
 */
export const memorySourceSchema = z.strictObject({
  kind: z.enum(['owner', 'task']),
  taskId: z.string().min(1).nullable(),
  artifactId: z.string().min(1).nullable(),
  label: z.string().min(1).max(300),
});
export type MemorySource = z.infer<typeof memorySourceSchema>;

export const memoryEntrySchema = z
  .strictObject({
    id: z.string().min(1),
    scope: memoryScopeSchema,
    projectId: z.string().min(1).nullable(),
    content: z.string().min(1).max(MEMORY_CONTENT_MAX_CHARS),
    source: memorySourceSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .superRefine((entry, ctx) => {
    if (entry.scope === 'global' && entry.projectId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'Global memory cannot carry a projectId',
      });
    }
    if (entry.scope === 'project' && entry.projectId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'Project memory requires a projectId',
      });
    }
  });
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

export const memoryProposalStateSchema = z.enum(['pending', 'approved', 'rejected']);
export type MemoryProposalState = z.infer<typeof memoryProposalStateSchema>;

/** Assistant tool arguments for proposing one durable memory. */
export const proposeMemoryArgsSchema = z.strictObject({
  scope: memoryScopeSchema,
  content: z.string().min(1).max(MEMORY_CONTENT_MAX_CHARS),
});
export type ProposeMemoryArgs = z.infer<typeof proposeMemoryArgsSchema>;

/**
 * A proposed memory awaiting the owner's decision. Pending proposals are not
 * durable context and are never retrieved into a task. Content is cleared
 * after a decision so SQLite does not retain a second copy of approved memory.
 */
export const memoryProposalSchema = z
  .strictObject({
    id: z.string().min(1),
    scope: memoryScopeSchema,
    projectId: z.string().min(1).nullable(),
    /** Present while pending; null after a decision (Markdown is canonical). */
    content: z.string().min(1).max(MEMORY_CONTENT_MAX_CHARS).nullable(),
    source: memorySourceSchema,
    sourceRunId: z.string().min(1).nullable(),
    state: memoryProposalStateSchema,
    proposedAt: z.string().min(1),
    decidedAt: z.string().min(1).nullable(),
    /** The approved memory entry, when the proposal was approved. */
    memoryEntryId: z.string().min(1).nullable(),
    /** sha256 of the proposed text at proposal time. */
    proposedContentSha256: z.string().length(64),
    /** sha256 of the text actually approved (differs when the owner edited it). */
    decidedContentSha256: z.string().length(64).nullable(),
  })
  .superRefine((proposal, ctx) => {
    if (proposal.scope === 'global' && proposal.projectId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'Global memory cannot carry a projectId',
      });
    }
    if (proposal.scope === 'project' && proposal.projectId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'Project memory requires a projectId',
      });
    }
    if (proposal.state === 'pending' && proposal.content === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'A pending proposal must carry its proposed content',
      });
    }
    if (proposal.state === 'approved' && proposal.memoryEntryId === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['memoryEntryId'],
        message: 'An approved proposal must point at the created memory entry',
      });
    }
  });
export type MemoryProposal = z.infer<typeof memoryProposalSchema>;

export const MEMORY_PROPOSAL_TRANSITIONS: Readonly<
  Record<MemoryProposalState, readonly MemoryProposalState[]>
> = {
  pending: ['approved', 'rejected'],
  approved: [],
  rejected: [],
};

export function canTransitionMemoryProposal(
  from: MemoryProposalState,
  to: MemoryProposalState,
): boolean {
  return MEMORY_PROPOSAL_TRANSITIONS[from].includes(to);
}

export class InvalidMemoryProposalTransitionError extends Error {
  constructor(
    public readonly from: MemoryProposalState,
    public readonly to: MemoryProposalState,
  ) {
    super(`Invalid memory proposal transition: ${from} -> ${to}`);
    this.name = 'InvalidMemoryProposalTransitionError';
  }
}

/** One canonical Markdown memory file as the owner should see it. */
export const memoryFileViewSchema = z.strictObject({
  scope: memoryScopeSchema,
  projectId: z.string().min(1).nullable(),
  /** Absolute path of the canonical Markdown file. */
  path: z.string().min(1),
  exists: z.boolean(),
  /** sha256 of the current file bytes, or null when the file does not exist. */
  sha256: z.string().length(64).nullable(),
  entries: z.array(memoryEntrySchema),
  /** Parse or repair problems; a non-empty list means the file needs attention. */
  problems: z.array(z.string().min(1)),
  /** True when the file on disk differs from the last indexed copy. */
  externalChange: z.boolean(),
});
export type MemoryFileView = z.infer<typeof memoryFileViewSchema>;

export const projectMemoryViewSchema = memoryFileViewSchema
  .omit({ projectId: true })
  .extend({
    projectId: z.string().min(1),
    projectName: z.string().min(1).max(200),
  });
export type ProjectMemoryView = z.infer<typeof projectMemoryViewSchema>;

export const memorySnapshotSchema = z.strictObject({
  global: memoryFileViewSchema,
  projects: z.array(projectMemoryViewSchema),
  proposals: z.array(memoryProposalSchema),
  limits: z.strictObject({
    contentMaxChars: z.number().int().positive(),
    entriesPerFile: z.number().int().positive(),
    contextMaxChars: z.number().int().positive(),
  }),
});
export type MemorySnapshot = z.infer<typeof memorySnapshotSchema>;

/** Owner approval of a proposal, optionally editing the proposed text first. */
export const approveMemoryProposalRequestSchema = z.strictObject({
  content: z.string().max(MEMORY_CONTENT_MAX_CHARS).optional(),
  /**
   * The file version the owner saw. The approval is refused if the Markdown
   * changed externally in the meantime; null means the file did not exist.
   */
  fileSha256: z.string().length(64).nullable(),
});
export type ApproveMemoryProposalRequest = z.infer<
  typeof approveMemoryProposalRequestSchema
>;

export const updateMemoryEntryRequestSchema = z.strictObject({
  content: z.string().min(1).max(MEMORY_CONTENT_MAX_CHARS),
  fileSha256: z.string().length(64),
});
export type UpdateMemoryEntryRequest = z.infer<
  typeof updateMemoryEntryRequestSchema
>;

export const deleteMemoryEntryRequestSchema = z.strictObject({
  fileSha256: z.string().length(64),
});
export type DeleteMemoryEntryRequest = z.infer<
  typeof deleteMemoryEntryRequestSchema
>;

/**
 * Boundary defensive check shared by proposals, approvals, and edits: memory
 * must never become a credential store. It deliberately reports only a
 * category, never the matched value, so errors and logs cannot echo a secret.
 */
const SECRET_PATTERNS: ReadonlyArray<{ category: string; pattern: RegExp }> = [
  { category: 'an OpenAI-style API key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { category: 'a Google API key', pattern: /\bAIza[0-9A-Za-z_-]{20,}/ },
  { category: 'a GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { category: 'an AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    category: 'a private key block',
    pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/,
  },
  {
    category: 'a bearer token',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/i,
  },
  {
    category: 'a credential assignment',
    pattern:
      /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}/i,
  },
];

export interface SecretMaterialFinding {
  /** Human-readable category; never contains the matched secret. */
  reason: string;
}

/**
 * Returns a finding when text looks like it contains credential material.
 * `knownSecrets` lets a caller add exact values (for example the active
 * provider key) without teaching this package about DPAPI or Settings.
 */
export function findSecretMaterial(
  text: string,
  knownSecrets: readonly string[] = [],
): SecretMaterialFinding | null {
  for (const secret of knownSecrets) {
    const trimmed = secret.trim();
    if (trimmed.length >= 8 && text.includes(trimmed)) {
      return { reason: 'it contains a configured provider credential' };
    }
  }
  for (const { category, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      return { reason: `it looks like ${category}` };
    }
  }
  return null;
}

/** Canonicalize whitespace for storage and comparison. */
export function normalizeMemoryContent(content: string): string {
  return content.replace(/\r\n?/g, '\n').split('\u0000').join('').trim();
}

/** Duplicate detection is case- and whitespace-insensitive. */
export function memoryContentKey(content: string): string {
  return normalizeMemoryContent(content).replace(/\s+/g, ' ').toLowerCase();
}
