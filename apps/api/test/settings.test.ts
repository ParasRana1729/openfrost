import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readProviderKey } from '@openfrost/db';
import { ActiveProvider } from '../src/activeProvider.js';
import { loadConfig } from '../src/config.js';
import { startApp, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
});

afterAll(async () => {
  await app.close();
});

describe('settings API', () => {
  it('reports defaults with no keys initially', async () => {
    const res = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      models: {
        openai: 'gpt-4.1-mini',
        gemini: 'gemini-3.8-flash',
        openrouter: 'openrouter/free',
        tokenfactory: 'Qwen3.8-27B',
      },
      hasProviderKey: false,
      hasOpenAIKey: false,
      hasGeminiKey: false,
      hasOpenRouterKey: false,
      hasTokenFactoryKey: false,
    });
    expect(res.json().executionLimits).toMatchObject({ maxSteps: 12 });
  });

  it('rejects malformed keys and unknown providers', async () => {
    const short = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider-key',
      payload: { provider: 'openai', key: 'short' },
    });
    expect(short.statusCode).toBe(400);

    const badProvider = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider-key',
      payload: { provider: 'anthropic', key: 'a-long-enough-key' },
    });
    expect(badProvider.statusCode).toBe(400);
  });
});

describe('provider switching', () => {
  it('switches the active provider and per-provider model', async () => {
    const customModel = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      payload: { provider: 'gemini', model: 'gemini-2.5-pro' },
    });
    expect(customModel.statusCode).toBe(200);

    const after = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
    });
    expect(after.json()).toMatchObject({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      models: { openai: 'gpt-4.1-mini', gemini: 'gemini-2.5-pro' },
      hasProviderKey: false,
      hasGeminiKey: false,
    });

    // Clearing the model override returns to the default.
    const cleared = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      payload: { provider: 'gemini', model: null },
    });
    expect(cleared.statusCode).toBe(200);
    const afterClear = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
    });
    expect(afterClear.json().model).toBe('gemini-3.8-flash');

    const back = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      payload: { provider: 'openai' },
    });
    expect(back.statusCode).toBe(200);
    const final = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
    });
    expect(final.json().provider).toBe('openai');
    expect(final.json().hasProviderKey).toBe(false);
  });

  it('switches to openrouter and applies its model override', async () => {
    const sw = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      payload: { provider: 'openrouter' },
    });
    expect(sw.statusCode).toBe(200);
    const asDefault = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
    });
    expect(asDefault.json()).toMatchObject({
      provider: 'openrouter',
      model: 'openrouter/free',
      models: { openrouter: 'openrouter/free' },
      hasOpenRouterKey: false,
    });

    const overridden = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      payload: { provider: 'openrouter', model: '  openai/gpt-4.1-mini  ' },
    });
    expect(overridden.statusCode).toBe(200);
    const after = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
    });
    expect(after.json()).toMatchObject({ provider: 'openrouter', model: 'openai/gpt-4.1-mini' });

    // Empty and whitespace-only overrides clear back to the default model.
    for (const emptyModel of ['', '   ', null]) {
      await app.built.app.inject({
        method: 'PUT',
        url: '/api/settings/provider',
        payload: { provider: 'openrouter', model: 'openai/gpt-4.1-mini' },
      });
      const cleared = await app.built.app.inject({
        method: 'PUT',
        url: '/api/settings/provider',
        payload: { provider: 'openrouter', model: emptyModel },
      });
      expect(cleared.statusCode).toBe(200);
      const res = await app.built.app.inject({
        method: 'GET',
        url: '/api/settings',
      });
      expect(res.json()).toMatchObject({
        provider: 'openrouter',
        model: 'openrouter/free',
        models: { openrouter: 'openrouter/free' },
      });
      const active = new ActiveProvider({
        config: { ...loadConfig({}), homeDir: app.home },
        store: app.store,
      });
      expect(active.current()).toEqual({ provider: 'openrouter', model: 'openrouter/free' });
    }

    // Even if whitespace/empty is stored directly in appState, reads fall back cleanly.
    app.store.state.setValue('provider.model.openrouter', '   ');
    const directActive = new ActiveProvider({
      config: { ...loadConfig({}), homeDir: app.home },
      store: app.store,
    });
    expect(directActive.current()).toEqual({ provider: 'openrouter', model: 'openrouter/free' });
    const directRes = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
    });
    expect(directRes.json()).toMatchObject({
      provider: 'openrouter',
      model: 'openrouter/free',
      models: { openrouter: 'openrouter/free' },
    });

    const back = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      payload: { provider: 'openai' },
    });
    expect(back.statusCode).toBe(200);
  });

  it('validates and clamps openrouterMaxTokens in loadConfig', () => {
    expect(loadConfig({}).openrouterMaxTokens).toBe(8192);
    expect(loadConfig({ OPENFROST_OPENROUTER_MAX_TOKENS: '16384' }).openrouterMaxTokens).toBe(16384);
    expect(loadConfig({ OPENFROST_OPENROUTER_MAX_TOKENS: '5000000' }).openrouterMaxTokens).toBe(1_000_000);
    expect(() => loadConfig({ OPENFROST_OPENROUTER_MAX_TOKENS: '0' })).toThrowError(
      /OPENFROST_OPENROUTER_MAX_TOKENS/,
    );
    expect(() => loadConfig({ OPENFROST_OPENROUTER_MAX_TOKENS: '-10' })).toThrowError(
      /OPENFROST_OPENROUTER_MAX_TOKENS/,
    );
    expect(() => loadConfig({ OPENFROST_OPENROUTER_MAX_TOKENS: 'abc' })).toThrowError(
      /OPENFROST_OPENROUTER_MAX_TOKENS/,
    );
  });

  it('switches to tokenfactory, applies model overrides, and validates tokenfactoryMaxTokens', async () => {
    const sw = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      payload: { provider: 'tokenfactory' },
    });
    expect(sw.statusCode).toBe(200);
    const asDefault = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
    });
    expect(asDefault.json()).toMatchObject({
      provider: 'tokenfactory',
      model: 'Qwen3.8-27B',
      models: { tokenfactory: 'Qwen3.8-27B' },
      hasTokenFactoryKey: false,
    });

    const overridden = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      payload: { provider: 'tokenfactory', model: '  DeepSeek-V4.1-Flash  ' },
    });
    expect(overridden.statusCode).toBe(200);
    const after = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
    });
    expect(after.json()).toMatchObject({
      provider: 'tokenfactory',
      model: 'DeepSeek-V4.1-Flash',
    });

    const cleared = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      payload: { provider: 'tokenfactory', model: null },
    });
    expect(cleared.statusCode).toBe(200);
    const active = new ActiveProvider({
      config: { ...loadConfig({}), homeDir: app.home },
      store: app.store,
    });
    expect(active.current()).toEqual({ provider: 'tokenfactory', model: 'Qwen3.8-27B' });

    expect(loadConfig({}).tokenfactoryMaxTokens).toBe(8192);
    expect(loadConfig({ OPENFROST_TOKENFACTORY_MAX_TOKENS: '16384' }).tokenfactoryMaxTokens).toBe(16384);
    expect(() => loadConfig({ OPENFROST_TOKENFACTORY_MAX_TOKENS: '0' })).toThrowError(
      /OPENFROST_TOKENFACTORY_MAX_TOKENS/,
    );

    const back = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      payload: { provider: 'openai' },
    });
    expect(back.statusCode).toBe(200);
  });

  it('rejects an unknown provider when switching', async () => {
    const res = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      payload: { provider: 'anthropic' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('events record provider changes', async () => {
    const events = app.store.events.listRecent(10);
    expect(events.some((e) => e.type === 'settings.provider_changed')).toBe(true);
  });
});

describe('provider key handling (real DPAPI)', () => {
  const OPENAI_KEY = 'sk-openfrost-test-0123456789abcdef';
  const GEMINI_KEY = 'AIza-openfrost-test-0123456789abcdefg';
  const OPENROUTER_KEY = 'sk-or-openfrost-test-0123456789abcdef';
  const TOKENFACTORY_KEY = 'rc-openfrost-test-0123456789abcdef';

  it('stores keys per provider, never echoes them, and keeps them out of logs', async () => {
    const putOpenAI = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider-key',
      payload: { provider: 'openai', key: OPENAI_KEY },
    });
    expect(putOpenAI.statusCode).toBe(200);
    expect(putOpenAI.body).not.toContain(OPENAI_KEY);

    const putGemini = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider-key',
      payload: { provider: 'gemini', key: GEMINI_KEY },
    });
    expect(putGemini.statusCode).toBe(200);
    expect(putGemini.body).not.toContain(GEMINI_KEY);

    const putOpenRouter = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider-key',
      payload: { provider: 'openrouter', key: OPENROUTER_KEY },
    });
    expect(putOpenRouter.statusCode).toBe(200);
    expect(putOpenRouter.body).not.toContain(OPENROUTER_KEY);

    const putTokenFactory = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider-key',
      payload: { provider: 'tokenfactory', key: TOKENFACTORY_KEY },
    });
    expect(putTokenFactory.statusCode).toBe(200);
    expect(putTokenFactory.body).not.toContain(TOKENFACTORY_KEY);

    expect(await readProviderKey(app.home, 'openai')).toBe(OPENAI_KEY);
    expect(await readProviderKey(app.home, 'gemini')).toBe(GEMINI_KEY);
    expect(await readProviderKey(app.home, 'openrouter')).toBe(OPENROUTER_KEY);
    expect(await readProviderKey(app.home, 'tokenfactory')).toBe(TOKENFACTORY_KEY);
    expect(app.logs.contains(OPENAI_KEY)).toBe(false);
    expect(app.logs.contains(GEMINI_KEY)).toBe(false);
    expect(app.logs.contains(OPENROUTER_KEY)).toBe(false);
    expect(app.logs.contains(TOKENFACTORY_KEY)).toBe(false);

    const settings = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
    });
    expect(settings.json()).toMatchObject({
      hasOpenAIKey: true,
      hasGeminiKey: true,
      hasOpenRouterKey: true,
      hasTokenFactoryKey: true,
      hasProviderKey: true, // active provider is openai
    });
    expect(JSON.stringify(settings.json())).not.toContain(OPENAI_KEY);
    expect(JSON.stringify(settings.json())).not.toContain(GEMINI_KEY);
    expect(JSON.stringify(settings.json())).not.toContain(OPENROUTER_KEY);
    expect(JSON.stringify(settings.json())).not.toContain(TOKENFACTORY_KEY);
  });

  it('hasProviderKey follows the active provider', async () => {
    await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      payload: { provider: 'gemini' },
    });
    const asGemini = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
    });
    expect(asGemini.json()).toMatchObject({ provider: 'gemini', hasProviderKey: true });
    await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      payload: { provider: 'openrouter' },
    });
    const asOpenRouter = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
    });
    expect(asOpenRouter.json()).toMatchObject({ provider: 'openrouter', hasProviderKey: true });
    await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      payload: { provider: 'tokenfactory' },
    });
    const asTokenFactory = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
    });
    expect(asTokenFactory.json()).toMatchObject({ provider: 'tokenfactory', hasProviderKey: true });
    await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      payload: { provider: 'openai' },
    });
  });

  it('deletes keys per provider and rejects unknown providers', async () => {
    const del = await app.built.app.inject({
      method: 'DELETE',
      url: '/api/settings/provider-key?provider=gemini',
    });
    expect(del.statusCode).toBe(204);
    const delRouter = await app.built.app.inject({
      method: 'DELETE',
      url: '/api/settings/provider-key?provider=openrouter',
    });
    expect(delRouter.statusCode).toBe(204);
    const delTokenFactory = await app.built.app.inject({
      method: 'DELETE',
      url: '/api/settings/provider-key?provider=tokenfactory',
    });
    expect(delTokenFactory.statusCode).toBe(204);
    const settings = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
    });
    expect(settings.json()).toMatchObject({
      hasGeminiKey: false,
      hasOpenRouterKey: false,
      hasTokenFactoryKey: false,
      hasOpenAIKey: true,
    });
    await expect(readProviderKey(app.home, 'gemini')).rejects.toThrowError();
    await expect(readProviderKey(app.home, 'openrouter')).rejects.toThrowError();
    await expect(readProviderKey(app.home, 'tokenfactory')).rejects.toThrowError();

    const unknown = await app.built.app.inject({
      method: 'DELETE',
      url: '/api/settings/provider-key?provider=anthropic',
    });
    expect(unknown.statusCode).toBe(400);
    // The rejected removal must not have touched the stored OpenAI key.
    expect(settings.json()).toMatchObject({ hasOpenAIKey: true });
  });
});
