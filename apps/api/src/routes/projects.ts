import type { FastifyPluginAsync } from 'fastify';
import {
  createProjectRequestSchema,
  grantFolderRequestSchema,
  updateProjectRequestSchema,
} from '@openfrost/domain';
import { validateGrantPath } from '@openfrost/agent';
import { ProjectNotFoundError } from '@openfrost/db';
import type { AppContext } from '../types.js';

/** Windows paths are case-insensitive; POSIX paths are not. */
function samePath(a: string, b: string): boolean {
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

/**
 * Projects (S03): named context scopes with owner-granted folder roots.
 * Grant paths are canonicalized and validated at grant time; every tool
 * execution re-checks them against the store.
 */
export const makeProjectRoutes = (ctx: AppContext): FastifyPluginAsync => async (app) => {
  const projectOr404 = async (projectId: string) => {
    const project = ctx.store.projects.get(projectId);
    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }
    return project;
  };

  const withGrants = (projectId: string) => ({
    ...ctx.store.projects.get(projectId),
    grants: ctx.store.projects.listGrants(projectId),
  });

  app.get('/projects', async () => {
    return {
      projects: ctx.store.projects.list().map((project) => ({
        ...project,
        grants: ctx.store.projects.listGrants(project.id),
      })),
    };
  });

  app.post('/projects', async (request, reply) => {
    const input = createProjectRequestSchema.parse(request.body);
    const project = ctx.store.projects.create(input, ctx.now());
    ctx.store.events.append(
      'project.created',
      { payload: { projectId: project.id, name: project.name } },
      ctx.now(),
    );
    return reply.code(201).send({ project });
  });

  app.get('/projects/:projectId', async (request) => {
    const { projectId } = request.params as { projectId: string };
    await projectOr404(projectId);
    return { project: withGrants(projectId) };
  });

  app.put('/projects/:projectId', async (request) => {
    const { projectId } = request.params as { projectId: string };
    await projectOr404(projectId);
    const input = updateProjectRequestSchema.parse(request.body);
    const project = ctx.store.projects.update(projectId, input, ctx.now());
    ctx.store.events.append(
      'project.updated',
      { payload: { projectId, name: project.name } },
      ctx.now(),
    );
    return { project };
  });

  app.post('/projects/:projectId/grants', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    await projectOr404(projectId);
    const input = grantFolderRequestSchema.parse(request.body);
    // Canonicalize through realpath now: junctions/symlinks resolve to the
    // real folder, and the store records that canonical path. Tool execution
    // re-canonicalizes against it, so later moves or junction swaps fail.
    const check = validateGrantPath(input.path, { home: ctx.config.homeDir });
    if (!check.ok) {
      return reply.code(400).send({ error: `Folder not granted: ${check.reason}` });
    }
    const duplicate = ctx.store.projects
      .listGrants(projectId)
      .some((grant) => samePath(grant.path, check.canonical));
    if (duplicate) {
      return reply.code(409).send({ error: 'This folder is already granted to the project.' });
    }
    const grant = ctx.store.projects.addGrant(projectId, check.canonical, ctx.now());
    ctx.store.events.append(
      'project.grant_added',
      { payload: { projectId, grantId: grant.id, path: grant.path } },
      ctx.now(),
    );
    return reply.code(201).send({ grant });
  });

  app.delete('/projects/:projectId/grants/:grantId', async (request) => {
    const { projectId, grantId } = request.params as { projectId: string; grantId: string };
    await projectOr404(projectId);
    ctx.store.projects.removeGrant(projectId, grantId);
    ctx.store.events.append(
      'project.grant_removed',
      { payload: { projectId, grantId } },
      ctx.now(),
    );
    return { ok: true };
  });
};
