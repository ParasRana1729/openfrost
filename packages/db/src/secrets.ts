import * as fs from 'node:fs';
import * as path from 'node:path';
import { open, seal } from './dpapi.js';
import { secretsDir } from './paths.js';

/**
 * Provider credential storage (spec §7 `%USERPROFILE%\\.openfrost\\secrets`).
 * The OpenAI key is stored only as a DPAPI-protected blob and is never
 * returned by any API, written to logs, or embedded in prompts.
 */
const PROVIDER_KEY_PURPOSE = 'provider-key';

export function providerKeyPath(home: string): string {
  return path.join(secretsDir(home), 'provider-key.bin');
}

export async function saveProviderKey(home: string, key: string): Promise<void> {
  fs.mkdirSync(secretsDir(home), { recursive: true });
  const blob = await seal(Buffer.from(key, 'utf8'), PROVIDER_KEY_PURPOSE);
  fs.writeFileSync(providerKeyPath(home), blob);
}

export function providerKeyExists(home: string): boolean {
  return fs.existsSync(providerKeyPath(home));
}

export async function readProviderKey(home: string): Promise<string> {
  const blob = fs.readFileSync(providerKeyPath(home));
  const plaintext = await open(blob, PROVIDER_KEY_PURPOSE);
  return plaintext.toString('utf8');
}

export function removeProviderKey(home: string): boolean {
  const target = providerKeyPath(home);
  if (!fs.existsSync(target)) {
    return false;
  }
  fs.unlinkSync(target);
  return true;
}

/** Non-sensitive display form; never reconstructs the raw key. */
export function maskKey(key: string): string {
  if (key.length <= 8) {
    return '••••••••';
  }
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}
