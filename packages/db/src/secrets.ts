import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProviderId } from '@openfrost/domain';
import { open, seal } from './dpapi.js';
import { secretsDir } from './paths.js';

/**
 * Provider credential storage (spec §7 `%USERPROFILE%\\.openfrost\\secrets`).
 * Each built-in provider has its own DPAPI-protected blob with a
 * purpose-bound entropy label, so one provider's key can never be decrypted
 * as another's. Keys are never returned by any API, written to logs, or
 * embedded in prompts.
 */
function providerKeyPurpose(provider: ProviderId): string {
  return `provider-key:${provider}`;
}

export function providerKeyPath(home: string, provider: ProviderId): string {
  return path.join(secretsDir(home), `provider-${provider}-key.bin`);
}

export async function saveProviderKey(
  home: string,
  provider: ProviderId,
  key: string,
): Promise<void> {
  fs.mkdirSync(secretsDir(home), { recursive: true });
  const blob = await seal(Buffer.from(key, 'utf8'), providerKeyPurpose(provider));
  fs.writeFileSync(providerKeyPath(home, provider), blob);
}

export function providerKeyExists(home: string, provider: ProviderId): boolean {
  return fs.existsSync(providerKeyPath(home, provider));
}

export async function readProviderKey(
  home: string,
  provider: ProviderId,
): Promise<string> {
  const blob = fs.readFileSync(providerKeyPath(home, provider));
  const plaintext = await open(blob, providerKeyPurpose(provider));
  return plaintext.toString('utf8');
}

export function removeProviderKey(home: string, provider: ProviderId): boolean {
  const target = providerKeyPath(home, provider);
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
