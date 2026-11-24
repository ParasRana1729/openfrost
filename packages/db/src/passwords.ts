import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify((
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
  callback: (error: Error | null, key: Buffer) => void,
): void => {
  scrypt(password, salt, keyLength, options, callback);
});

/**
 * Owner password hashing (spec §6: "Passwords are hashed, not reversibly
 * stored"). scrypt with per-password salt and a timing-safe comparison.
 */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, n, r, p, saltB64, hashB64] = parts;
  if (!n || !r || !p || !saltB64 || !hashB64) {
    return false;
  }
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(
    password,
    Buffer.from(saltB64, 'base64'),
    expected.length,
    { N: Number(n), r: Number(r), p: Number(p) },
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
