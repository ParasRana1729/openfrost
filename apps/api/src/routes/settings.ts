import type { FastifyPluginAsync } from 'fastify';
import { assistantSettingsSchema, setProviderKeyRequestSchema } from '@openfrost/domain';
import {
  DpapiUnavailableError,
  providerKeyExists,
  removeProviderKey,
  saveProviderKey,
} from '@openfrost/db';
import type { AppContext } from '../types.js';

/**
 * Owner settings. The provider key is stored only as a DPAPI-protected blob
 * and is never returned or logged; the API exposes only `hasProviderKey`.
 */
export const makeSettingsRoutes = (ctx: AppContext): FastifyPluginAsync => async (app) => {
  app.get('/settings', async () => {
    return assistantSettingsSchema.parse({
      provider: 'openai',
      model: ctx.providerModel,
      hasProviderKey: providerKeyExists(ctx.config.homeDir),
      executionLimits: ctx.executor.limits,
      onboardingCompletedAt: ctx.store.state.getValue('onboarding.completedAt'),
    });
  });

  app.put('/settings/provider-key', async (request, reply) => {
    const input = setProviderKeyRequestSchema.parse(request.body);
    try {
      await saveProviderKey(ctx.config.homeDir, input.key);
    } catch (err) {
      if (err instanceof DpapiUnavailableError) {
        return reply.code(503).send({ error: err.message });
      }
      throw err;
    }
    ctx.store.events.append('settings.provider_key_set', {}, ctx.now());
    // Deliberately never echoes the key back.
    return { ok: true, hasProviderKey: true };
  });

  app.delete('/settings/provider-key', async (_request, reply) => {
    removeProviderKey(ctx.config.homeDir);
    ctx.store.events.append('settings.provider_key_removed', {}, ctx.now());
    return reply.code(204).send();
  });
};
