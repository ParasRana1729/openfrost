import {
  MEMORY_MAX_PROPOSALS_PER_RUN,
  findSecretMaterial,
  proposeMemoryArgsSchema,
} from '@openfrost/domain';
import {
  MemoryDuplicateError,
  MemoryLimitError,
  MemoryProjectNotFoundError,
  MemorySecretError,
  type Store,
} from '@openfrost/db';
import type { AgentTool, RunToolContext } from './types.js';

export interface ProposeMemoryToolOptions {
  store: Store;
  task: { id: string; title: string; projectId: string | null };
  runId: string;
  now?: () => string;
}

/**
 * `propose_memory` lets the assistant suggest one durable global preference or
 * project fact (S05). A proposal is not memory: it is pending until the owner
 * approves it in the web app, and pending text is never retrieved into a task.
 * The tool scans for credential material before and inside the store, refuses
 * duplicates, and accepts at most MEMORY_MAX_PROPOSALS_PER_RUN per run. Events
 * carry metadata only — never the proposed text.
 */
export function createProposeMemoryTool(options: ProposeMemoryToolOptions): AgentTool {
  const { store, task, runId } = options;
  const now = options.now ?? (() => new Date().toISOString());
  let accepted = 0;

  const blocked = (scope: string, reason: string): void => {
    store.events.append(
      'memory.proposal_blocked',
      {
        taskId: task.id,
        runId,
        payload: {
          scope,
          projectId: task.projectId,
          reason,
        },
      },
      now(),
    );
  };

  return {
    definition: {
      name: 'propose_memory',
      description:
        'Propose one durable memory for the owner to approve: a lasting global ' +
        'preference (scope "global") or a lasting fact about the current project ' +
        '(scope "project"). Proposals are not active until the owner approves ' +
        'them. Never propose credentials, secrets, or task-specific details. ' +
        `At most ${MEMORY_MAX_PROPOSALS_PER_RUN} proposals per run.`,
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['global', 'project'] },
          content: { type: 'string' },
        },
        required: ['scope', 'content'],
        additionalProperties: false,
      },
    },

    async execute(
      argsJson: string,
      _ctx: RunToolContext,
      signal: AbortSignal,
    ): Promise<{ ok: boolean; content: string }> {
      if (signal.aborted) {
        return { ok: false, content: 'Refused: the run was canceled.' };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(argsJson);
      } catch {
        return {
          ok: false,
          content: 'Invalid arguments: expected { "scope": "global"|"project", "content": string }',
        };
      }
      const args = proposeMemoryArgsSchema.safeParse(parsed);
      if (!args.success) {
        return {
          ok: false,
          content:
            'Invalid arguments: scope must be "global" or "project" and content ' +
            'must be non-empty, bounded text.',
        };
      }
      const { scope, content } = args.data;

      if (scope === 'project' && !task.projectId) {
        const reason = 'project memory requires a task scoped to a project';
        blocked(scope, reason);
        return { ok: false, content: `Refused: ${reason}.` };
      }
      if (accepted >= MEMORY_MAX_PROPOSALS_PER_RUN) {
        const reason = `this run already proposed ${MEMORY_MAX_PROPOSALS_PER_RUN} memories`;
        blocked(scope, reason);
        return { ok: false, content: `Refused: ${reason}.` };
      }
      const finding = findSecretMaterial(content);
      if (finding) {
        blocked(scope, finding.reason);
        return {
          ok: false,
          content:
            `Refused: memory cannot store credential material (${finding.reason}). ` +
            'The owner can store provider keys in Settings instead.',
        };
      }

      try {
        const projectId = scope === 'project' ? task.projectId : null;
        const proposal = store.memory.createProposal(
          {
            scope,
            projectId,
            content,
            source: {
              kind: 'task',
              taskId: task.id,
              artifactId: null,
              label: task.title,
            },
            sourceRunId: runId,
          },
          now(),
        );
        accepted += 1;
        store.events.append(
          'memory.proposed',
          {
            taskId: task.id,
            runId,
            payload: {
              proposalId: proposal.id,
              scope: proposal.scope,
              projectId: proposal.projectId,
              contentChars: content.length,
            },
          },
          now(),
        );
        return {
          ok: true,
          content: JSON.stringify({
            status: 'pending_owner_approval',
            proposalId: proposal.id,
            scope: proposal.scope,
            note:
              'The owner must approve this in the Memory page before it becomes ' +
              'available to future tasks.',
          }),
        };
      } catch (err) {
        let reason: string;
        if (err instanceof MemorySecretError) {
          reason = err.reason;
        } else if (err instanceof MemoryDuplicateError) {
          reason = 'an equivalent memory already exists or is already pending';
        } else if (err instanceof MemoryProjectNotFoundError) {
          reason = 'the project no longer exists';
        } else if (err instanceof MemoryLimitError) {
          reason = err.message;
        } else {
          reason = 'the proposal could not be stored';
        }
        blocked(scope, reason);
        return { ok: false, content: `Refused: ${reason}.` };
      }
    },
  };
}
