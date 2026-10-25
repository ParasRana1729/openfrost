import { createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import {
  MEMORY_CONTENT_MAX_CHARS,
  MEMORY_CONTEXT_MAX_CHARS,
  MEMORY_MAX_ENTRIES_PER_FILE,
  approveMemoryProposalRequestSchema,
  deleteMemoryEntryRequestSchema,
  memorySnapshotSchema,
  updateMemoryEntryRequestSchema,
  type MemoryFileView,
} from '@openfrost/domain';
import type { AppContext } from '../types.js';

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Inspectable owner-approved memory (S05). Every response exposes both the
 * canonical Markdown file state and pending proposals; every mutation carries
 * the file hash the owner saw, and the store refuses to overwrite a file that
 * changed externally. Events carry metadata and hashes only, never memory text.
 */
export const makeMemoryRoutes = (ctx: AppContext): FastifyPluginAsync => async (app) => {
  const snapshot = () => {
    const global = ctx.store.memory.readFileView('global', null);
    const projects = ctx.store.projects.list().map((project) => {
      const view: MemoryFileView = ctx.store.memory.readFileView('project', project.id);
      return { ...view, projectId: project.id, projectName: project.name };
    });
    return memorySnapshotSchema.parse({
      global,
      projects,
      proposals: ctx.store.memory.listProposals(),
      limits: {
        contentMaxChars: MEMORY_CONTENT_MAX_CHARS,
        entriesPerFile: MEMORY_MAX_ENTRIES_PER_FILE,
        contextMaxChars: MEMORY_CONTEXT_MAX_CHARS,
      },
    });
  };

  app.get('/memory', async () => snapshot());

  app.post('/memory/proposals/:proposalId/approve', async (request) => {
    const { proposalId } = request.params as { proposalId: string };
    const input = approveMemoryProposalRequestSchema.parse(request.body);
    const decided = ctx.store.memory.approveProposal(
      proposalId,
      {
        ...(input.content !== undefined ? { content: input.content } : {}),
        expectedFileSha256: input.fileSha256,
      },
      ctx.now(),
    );
    ctx.store.events.append(
      'memory.approved',
      {
        payload: {
          proposalId,
          entryId: decided.entry.id,
          scope: decided.entry.scope,
          projectId: decided.entry.projectId,
          contentSha256: sha256(decided.entry.content),
          edited: input.content !== undefined,
        },
      },
      ctx.now(),
    );
    return { proposal: decided.proposal, entry: decided.entry, file: decided.file };
  });

  app.post('/memory/proposals/:proposalId/reject', async (request) => {
    const { proposalId } = request.params as { proposalId: string };
    const proposal = ctx.store.memory.rejectProposal(proposalId, ctx.now());
    ctx.store.events.append(
      'memory.rejected',
      {
        payload: {
          proposalId: proposal.id,
          scope: proposal.scope,
          projectId: proposal.projectId,
        },
      },
      ctx.now(),
    );
    return { proposal };
  });

  app.put('/memory/entries/:entryId', async (request) => {
    const { entryId } = request.params as { entryId: string };
    const input = updateMemoryEntryRequestSchema.parse(request.body);
    const updated = ctx.store.memory.updateEntry(
      entryId,
      {
        content: input.content,
        expectedFileSha256: input.fileSha256,
      },
      ctx.now(),
    );
    ctx.store.events.append(
      'memory.updated',
      {
        payload: {
          entryId,
          scope: updated.entry.scope,
          projectId: updated.entry.projectId,
          contentSha256: sha256(updated.entry.content),
        },
      },
      ctx.now(),
    );
    return { entry: updated.entry, file: updated.file };
  });

  app.delete('/memory/entries/:entryId', async (request) => {
    const { entryId } = request.params as { entryId: string };
    const input = deleteMemoryEntryRequestSchema.parse(request.body);
    const deleted = ctx.store.memory.deleteEntry(
      entryId,
      input.fileSha256,
      ctx.now(),
    );
    ctx.store.events.append(
      'memory.deleted',
      {
        payload: {
          entryId: deleted.entryId,
          scope: deleted.scope,
          projectId: deleted.projectId,
        },
      },
      ctx.now(),
    );
    return { ok: true, file: deleted.file };
  });

  app.post('/memory/reload', async () => {
    // Capture what changed before indexing resets the comparison, so the
    // audit event reports detected external edits rather than zero.
    const before = [
      ctx.store.memory.readFileView('global', null),
      ...ctx.store.projects
        .list()
        .map((project) => ctx.store.memory.readFileView('project', project.id)),
    ];
    const files = ctx.store.memory.reloadAll(ctx.now());
    ctx.store.events.append(
      'memory.reloaded',
      {
        payload: {
          files: files.length,
          externalChanges: before.filter((file) => file.externalChange).length,
        },
      },
      ctx.now(),
    );
    return { files };
  });
};
