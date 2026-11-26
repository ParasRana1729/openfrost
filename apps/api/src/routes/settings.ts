import type { FastifyPluginAsync } from 'fastify';
import {
  assistantSettingsSchema,
  providerIdSchema,
  setProviderConfigRequestSchema,
  setProviderKeyRequestSchema,
  type ProviderId,
} from '@openfrost/domain';
import {
  DpapiUnavailableError,
  providerKeyExists,
  removeProviderKey,
  saveProviderKey,
} from '@openfrost/db';
import {
  ACTIVE_PROVIDER_KEY,
  defaultModelForProvider,
  parseStoredProvider,
  providerModelKey,
  type ActiveProvider,
} from '../activeProvider.js';
import type { AppContext } from '../types.js';

/**
 * Owner settings. Each provider has its own DPAPI-protected key and a
 * configurable model; the active provider is chosen here and takes effect on
 * the next run. Keys are never returned or logged — only per-provider
 * booleans reach the UI.
 */
export const makeSettingsRoutes = (
  ctx: AppContext,
  activeProvider?: ActiveProvider,
): FastifyPluginAsync => async (app) => {
  const configuredModel = (provider: ProviderId): string => {
    const override = ctx.store.state.getValue(providerModelKey(provider));
    const trimmed = override?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : defaultModelForProvider(ctx.config, provider);
  };

  const activeProviderFromState = (): ProviderId =>
    parseStoredProvider(ctx.store.state.getValue(ACTIVE_PROVIDER_KEY));

  app.get('/settings', async () => {
    const fakeHook = ctx.config.provider === 'fake';
    const active = activeProviderFromState();
    return assistantSettingsSchema.parse({
      provider: fakeHook ? 'fake' : active,
      model: fakeHook ? null : configuredModel(active),
      models: {
        openai: configuredModel('openai'),
        gemini: configuredModel('gemini'),
        openrouter: configuredModel('openrouter'),
        tokenfactory: configuredModel('tokenfactory'),
      },
      hasProviderKey: providerKeyExists(ctx.config.homeDir, active),
      hasOpenAIKey: providerKeyExists(ctx.config.homeDir, 'openai'),
      hasGeminiKey: providerKeyExists(ctx.config.homeDir, 'gemini'),
      hasOpenRouterKey: providerKeyExists(ctx.config.homeDir, 'openrouter'),
      hasTokenFactoryKey: providerKeyExists(ctx.config.homeDir, 'tokenfactory'),
      executionLimits: ctx.executor.limits,
      onboardingCompletedAt: ctx.store.state.getValue('onboarding.completedAt'),
    });
  });

  app.put('/settings/provider', async (request, reply) => {
    if (ctx.config.provider === 'fake') {
      return reply.code(409).send({
        error: 'OPENFROST_PROVIDER=fake is active; provider switching is disabled.',
      });
    }
    const input = setProviderConfigRequestSchema.parse(request.body);
    ctx.store.state.setValue(ACTIVE_PROVIDER_KEY, input.provider);
    const normalizedModel =
      input.model === undefined
        ? undefined
        : input.model === null
          ? null
          : input.model.trim().length > 0
            ? input.model.trim()
            : null;
    if (normalizedModel !== undefined) {
      ctx.store.state.setValue(providerModelKey(input.provider), normalizedModel ?? '');
    }
    ctx.store.events.append(
      'settings.provider_changed',
      { payload: { provider: input.provider, model: normalizedModel ?? null } },
      ctx.now(),
    );
    return { ok: true, provider: input.provider };
  });

  app.put('/settings/provider-key', async (request, reply) => {
    const input = setProviderKeyRequestSchema.parse(request.body);
    try {
      await saveProviderKey(ctx.config.homeDir, input.provider, input.key);
    } catch (err) {
      if (err instanceof DpapiUnavailableError) {
        return reply.code(503).send({ error: err.message });
      }
      throw err;
    }
    activeProvider?.invalidateKey(input.provider);
    ctx.store.events.append(
      'settings.provider_key_set',
      { payload: { provider: input.provider } },
      ctx.now(),
    );
    // Deliberately never echoes the key back.
    return { ok: true, provider: input.provider };
  });

  app.delete('/settings/provider-key', async (request, reply) => {
    const query = (request.query as { provider?: string }).provider;
    const parsed = providerIdSchema.safeParse(query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Unknown provider.' });
    }
    const provider = parsed.data;
    removeProviderKey(ctx.config.homeDir, provider);
    activeProvider?.invalidateKey(provider);
    ctx.store.events.append(
      'settings.provider_key_removed',
      { payload: { provider } },
      ctx.now(),
    );
    return reply.code(204).send();
  });
};
