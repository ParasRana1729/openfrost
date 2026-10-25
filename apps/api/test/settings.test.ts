import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readProviderKey } from '@openfrost/db';
import { jarHeaders, setupOwner, startApp, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
  await setupOwner(app);
});

afterAll(async () => {
  await app.close();
});

describe('settings API', () => {
  it('reports defaults with no keys initially', async () => {
    const res = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: app.cookie! },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      models: { openai: 'gpt-4.1-mini', gemini: 'gemini-3.8-flash' },
      hasProviderKey: false,
      hasOpenAIKey: false,
      hasGeminiKey: false,
    });
    expect(res.json().executionLimits).toMatchObject({ maxSteps: 12 });
  });

  it('requires authentication', async () => {
    const res = await app.built.app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects malformed keys and unknown providers', async () => {
    const short = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider-key',
      headers: jarHeaders(app),
      payload: { provider: 'openai', key: 'short' },
    });
    expect(short.statusCode).toBe(400);

    const badProvider = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider-key',
      headers: jarHeaders(app),
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
      headers: jarHeaders(app),
      payload: { provider: 'gemini', model: 'gemini-2.5-pro' },
    });
    expect(customModel.statusCode).toBe(200);

    const after = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: app.cookie! },
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
      headers: jarHeaders(app),
      payload: { provider: 'gemini', model: null },
    });
    expect(cleared.statusCode).toBe(200);
    const afterClear = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: app.cookie! },
    });
    expect(afterClear.json().model).toBe('gemini-3.8-flash');

    const back = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      headers: jarHeaders(app),
      payload: { provider: 'openai' },
    });
    expect(back.statusCode).toBe(200);
    const final = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: app.cookie! },
    });
    expect(final.json().provider).toBe('openai');
    expect(final.json().hasProviderKey).toBe(false);
  });

  it('rejects an unknown provider when switching', async () => {
    const res = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      headers: jarHeaders(app),
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

  it('stores keys per provider, never echoes them, and keeps them out of logs', async () => {
    const putOpenAI = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider-key',
      headers: jarHeaders(app),
      payload: { provider: 'openai', key: OPENAI_KEY },
    });
    expect(putOpenAI.statusCode).toBe(200);
    expect(putOpenAI.body).not.toContain(OPENAI_KEY);

    const putGemini = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider-key',
      headers: jarHeaders(app),
      payload: { provider: 'gemini', key: GEMINI_KEY },
    });
    expect(putGemini.statusCode).toBe(200);
    expect(putGemini.body).not.toContain(GEMINI_KEY);

    expect(await readProviderKey(app.home, 'openai')).toBe(OPENAI_KEY);
    expect(await readProviderKey(app.home, 'gemini')).toBe(GEMINI_KEY);
    expect(app.logs.contains(OPENAI_KEY)).toBe(false);
    expect(app.logs.contains(GEMINI_KEY)).toBe(false);

    const settings = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: app.cookie! },
    });
    expect(settings.json()).toMatchObject({
      hasOpenAIKey: true,
      hasGeminiKey: true,
      hasProviderKey: true, // active provider is openai
    });
    expect(JSON.stringify(settings.json())).not.toContain(OPENAI_KEY);
    expect(JSON.stringify(settings.json())).not.toContain(GEMINI_KEY);
  });

  it('hasProviderKey follows the active provider', async () => {
    await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      headers: jarHeaders(app),
      payload: { provider: 'gemini' },
    });
    const asGemini = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: app.cookie! },
    });
    expect(asGemini.json()).toMatchObject({ provider: 'gemini', hasProviderKey: true });
    await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider',
      headers: jarHeaders(app),
      payload: { provider: 'openai' },
    });
  });

  it('deletes keys per provider', async () => {
    const del = await app.built.app.inject({
      method: 'DELETE',
      url: '/api/settings/provider-key?provider=gemini',
      headers: jarHeaders(app),
    });
    expect(del.statusCode).toBe(204);
    const settings = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: app.cookie! },
    });
    expect(settings.json()).toMatchObject({ hasGeminiKey: false, hasOpenAIKey: true });
    await expect(readProviderKey(app.home, 'gemini')).rejects.toThrowError();
  });
});
