import { scryptSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStore, openDatabase, OwnerExistsError } from '../src/index.js';
import { hashPassword, verifyPassword } from '../src/passwords.js';

const NOW = '2026-10-23T12:00:00.000Z';

// Reproduce the pre-async implementation, including its exact storage format.
function legacyHash(password: string, N = 16384, r = 8, p = 1): string {
  const salt = Buffer.from('legacy-test-salt');
  const hash = scryptSync(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

describe('async scrypt passwords', () => {
  it('preserves format, parameters and lengths and verifies new hashes', async () => {
    const pending = hashPassword('correct horse battery staple');
    expect(pending).toBeInstanceOf(Promise);
    const hash = await pending;
    const parts = hash.split('$');
    expect(parts.slice(0, 4)).toEqual(['scrypt', '16384', '8', '1']);
    expect(parts).toHaveLength(6);
    expect(Buffer.from(parts[4]!, 'base64')).toHaveLength(16);
    expect(Buffer.from(parts[5]!, 'base64')).toHaveLength(64);
    await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong')).resolves.toBe(false);
    expect(await hashPassword('correct horse battery staple')).not.toBe(hash);
  });

  it.each([[16384, 8, 1], [1024, 8, 2]])(
    'verifies synchronous legacy hashes using stored N=%i r=%i p=%i',
    async (N, r, p) => {
      const hash = legacyHash('legacy passphrase', N, r, p);
      await expect(verifyPassword(hash, 'legacy passphrase')).resolves.toBe(true);
      await expect(verifyPassword(hash, 'wrong')).resolves.toBe(false);
    },
  );

  it.each(['not-a-hash', 'other$16384$8$1$c2FsdA==$aGFzaA==', 'scrypt$16384$8$1$$aGFzaA=='])(
    'rejects malformed or unsupported stored hashes: %s',
    async (hash) => {
      await expect(verifyPassword(hash, 'password')).resolves.toBe(false);
    },
  );

  it('authenticates a legacy owner without rewriting the hash after restart', async () => {
    const home = mkdtempSync(join(tmpdir(), 'openfrost-legacy-password-'));
    const hash = legacyHash('legacy passphrase');
    const first = openDatabase(home);
    try {
      first.sqlite.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run('legacy', 'owner', hash, NOW);
    } finally {
      first.sqlite.close();
    }
    const reopened = openDatabase(home);
    try {
      const store = createStore(reopened.db, { home });
      await expect(store.users.verifyOwnerCredentials('owner', 'legacy passphrase'))
        .resolves.toEqual({ id: 'legacy', username: 'owner', createdAt: NOW });
      await expect(store.users.verifyOwnerCredentials('owner', 'wrong')).resolves.toBeNull();
      await expect(store.users.verifyOwnerCredentials('other', 'legacy passphrase')).resolves.toBeNull();
      expect(reopened.sqlite.prepare('SELECT password_hash FROM users').get())
        .toEqual({ password_hash: hash });
    } finally {
      reopened.sqlite.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('creates only one owner when different usernames race across store connections', async () => {
    const home = mkdtempSync(join(tmpdir(), 'openfrost-owner-race-'));
    const first = openDatabase(home);
    const second = openDatabase(home);
    try {
      const stores = [first, second].map(({ db }) => createStore(db, { home }));
      const results = await Promise.allSettled(stores.map((store, i) =>
        store.users.createOwner(`owner-${i}`, 'local passphrase', NOW)));
      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.reason).toBeInstanceOf(OwnerExistsError);
      expect(stores[0]!.users.count()).toBe(1);
    } finally {
      first.sqlite.close();
      second.sqlite.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
