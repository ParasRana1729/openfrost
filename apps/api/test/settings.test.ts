import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { providerKeyPath, readProviderKey } from '@openfrost/db';
import { jarHeaders, setupOwner, startApp, type TestApp } from './helpers.js';

const runsOnWindows = process.platform === 'win32';

let app: TestApp;

beforeAll(async () => {
  app = await startApp();
  await setupOwner(app);
});

afterAll(async () => {
  await app.close();
});

describe('settings API', () => {
  it('reports settings without a key initially', async () => {
    const res = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: app.cookie! },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      provider: 'openai',
      model: 'gpt-4.1-mini',
      hasProviderKey: false,
    });
    expect(res.json().executionLimits).toMatchObject({ maxSteps: 12 });
  });

  it('requires authentication', async () => {
    const res = await app.built.app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects malformed keys', async () => {
    const res = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider-key',
      headers: jarHeaders(app),
      payload: { key: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });
});

(runsOnWindows ? describe : describe.skip)('provider key handling (real DPAPI)', () => {
  const KEY = 'sk-openfrost-test-0123456789abcdef';

  it('stores the key DPAPI-protected, never echoes it, and keeps it out of logs', async () => {
    const res = await app.built.app.inject({
      method: 'PUT',
      url: '/api/settings/provider-key',
      headers: jarHeaders(app),
      payload: { key: KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(KEY);

    // The stored blob must not contain the raw key.
    const blob = readFileSync(providerKeyPath(app.home));
    expect(blob.subarray(0, 4).toString('utf8')).toBe('OFDP');
    expect(blob.toString('utf8')).not.toContain(KEY);

    // Same user can still decrypt it (proves real DPAPI round-trip).
    expect(await readProviderKey(app.home)).toBe(KEY);

    // No log line carries the raw key or the request body.
    expect(app.logs.contains(KEY)).toBe(false);

    const settings = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: app.cookie! },
    });
    expect(settings.json().hasProviderKey).toBe(true);
    expect(JSON.stringify(settings.json())).not.toContain(KEY);
  });

  it('deletes the key on request', async () => {
    const res = await app.built.app.inject({
      method: 'DELETE',
      url: '/api/settings/provider-key',
      headers: jarHeaders(app),
    });
    expect(res.statusCode).toBe(204);
    const settings = await app.built.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: app.cookie! },
    });
    expect(settings.json().hasProviderKey).toBe(false);
    expect(() => readFileSync(join(app.home, 'secrets', 'provider-key.bin'))).toThrowError();
  });
});
