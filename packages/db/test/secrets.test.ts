import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DpapiUnavailableError,
  SecretFormatError,
  isDpapiAvailable,
  maskKey,
  open,
  providerKeyExists,
  providerKeyPath,
  readProviderKey,
  removeProviderKey,
  saveProviderKey,
  seal,
} from '../src/index.js';

const runsOnWindows = process.platform === 'win32';
const maybeDescribe = runsOnWindows ? describe : describe.skip;

describe('DPAPI availability', () => {
  it('reports availability consistently with the platform', () => {
    expect(isDpapiAvailable()).toBe(runsOnWindows);
  });
});

maybeDescribe('DPAPI protection (real Windows round-trip)', () => {
  it('round-trips a secret through CryptProtectData/CryptUnprotectData', async () => {
    const secret = Buffer.from('sk-test-1234567890-not-a-real-key', 'utf8');
    const blob = await seal(secret, 'provider-key');
    expect(blob.subarray(0, 4).toString('utf8')).toBe('OFDP');
    expect(blob.toString('utf8')).not.toContain('sk-test-1234567890');
    const restored = await open(blob, 'provider-key');
    expect(restored.toString('utf8')).toBe('sk-test-1234567890-not-a-real-key');
  });

  it('rejects a blob opened under a different purpose', async () => {
    const blob = await seal(Buffer.from('x'), 'purpose-a');
    await expect(open(blob, 'purpose-b')).rejects.toThrowError(SecretFormatError);
  });

  it('rejects corrupt and non-DPAPI blobs', async () => {
    await expect(open(Buffer.from('not a blob at all'), 'provider-key')).rejects.toThrowError(
      SecretFormatError,
    );
    const truncated = (await seal(Buffer.from('x'), 'provider-key')).subarray(0, 6);
    await expect(open(truncated, 'provider-key')).rejects.toThrowError(SecretFormatError);
  });
});

maybeDescribe('provider key storage', () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'openfrost-secrets-test-'));
  });

  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('stores each provider key as a DPAPI blob and reads it back for the same user', async () => {
    const openaiKey = 'sk-proj-realshape-0000000000000000';
    const geminiKey = 'AIza-realshape-0000000000000000000';
    await saveProviderKey(home, 'openai', openaiKey);
    await saveProviderKey(home, 'gemini', geminiKey);

    const stored = readFileSync(providerKeyPath(home, 'openai'));
    expect(stored.toString('binary')).not.toContain(openaiKey);
    expect(stored.subarray(0, 4).toString('utf8')).toBe('OFDP');
    expect(providerKeyExists(home, 'openai')).toBe(true);
    expect(await readProviderKey(home, 'openai')).toBe(openaiKey);
    expect(providerKeyExists(home, 'gemini')).toBe(true);
    expect(await readProviderKey(home, 'gemini')).toBe(geminiKey);
  });

  it('cannot decrypt one provider blob under another purpose', async () => {
    // Purpose-bound entropy: each provider blob carries its own label.
    await expect(readProviderKey(home, 'gemini')).resolves.toBeDefined();
    const openaiBlob = readFileSync(providerKeyPath(home, 'openai'));
    const { open } = await import('../src/index.js');
    await expect(open(openaiBlob, 'provider-key:gemini')).rejects.toThrowError(
      SecretFormatError,
    );
  });

  it('removes the stored key per provider', async () => {
    expect(removeProviderKey(home, 'openai')).toBe(true);
    expect(providerKeyExists(home, 'openai')).toBe(false);
    expect(removeProviderKey(home, 'openai')).toBe(false);
    expect(providerKeyExists(home, 'gemini')).toBe(true);
    expect(removeProviderKey(home, 'gemini')).toBe(true);
  });
});

describe('fail-closed behavior', () => {
  it('refuses to seal outside Windows (validated by mocking the platform check)', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      const { seal: sealFresh } = await import('../src/dpapi.js');
      await expect(sealFresh(Buffer.from('x'), 'p')).rejects.toThrowError(
        DpapiUnavailableError,
      );
    } finally {
      if (original) Object.defineProperty(process, 'platform', original);
    }
  });
});

describe('maskKey', () => {
  it('never reveals more than a prefix and suffix', () => {
    expect(maskKey('sk-abcdefghijklmnop')).toBe('sk-••••mnop');
    expect(maskKey('short')).toBe('••••••••');
  });
});
