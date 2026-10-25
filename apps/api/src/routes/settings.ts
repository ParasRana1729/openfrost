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
import type { ActiveProvider } from '../activeProvider.js';
import type { AppContext } from '../types.js';

const PROVIDER_KEY = 'provider.active';
const modelKey = (provider: ProviderId): string => `provider.model.${provider}`;

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
    const override = ctx.store.state.getValue(modelKey(provider));
    const fallback =
      provider === 'gemini'
        ? ctx.config.geminiModel
        : provider === 'openrouter'
          ? ctx.config.openrouterModel
          : ctx.config.openaiModel;
    return override !== null && override.length > 0 ? override : fallback;
  };

  const activeProviderFromState = (): ProviderId => {
    const value = ctx.store.state.getValue(PROVIDER_KEY);
    return value === 'gemini' || value === 'openrouter' ? value : 'openai';
  };

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
      },
      hasProviderKey: providerKeyExists(ctx.config.homeDir, active),
      hasOpenAIKey: providerKeyExists(ctx.config.homeDir, 'openai'),
      hasGeminiKey: providerKeyExists(ctx.config.homeDir, 'gemini'),
      hasOpenRouterKey: providerKeyExists(ctx.config.homeDir, 'openrouter'),
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
    ctx.store.state.setValue(PROVIDER_KEY, input.provider);
    if (input.model !== undefined) {
      if (input.model === null) {
        ctx.store.state.setValue(modelKey(input.provider), '');
      } else {
        ctx.store.state.setValue(modelKey(input.provider), input.model);
      }
    }
    ctx.store.events.append(
      'settings.provider_changed',
      { payload: { provider: input.provider, model: input.model ?? null } },
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
