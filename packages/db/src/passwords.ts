import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Owner password hashing (spec §6: "Passwords are hashed, not reversibly
 * stored"). scrypt with per-password salt and a timing-safe comparison.
 */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(stored: string, password: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, n, r, p, saltB64, hashB64] = parts;
  if (!n || !r || !p || !saltB64 || !hashB64) {
    return false;
  }
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(
    password,
    Buffer.from(saltB64, 'base64'),
    expected.length,
    { N: Number(n), r: Number(r), p: Number(p) },
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
