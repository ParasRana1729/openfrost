import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

/**
 * Windows DPAPI-backed protection (spec §6). Uses the real CryptProtectData /
 * CryptUnprotectData via PowerShell's System.Security.Cryptography.ProtectedData
 * with CurrentUser scope — no generic crypto wrapper, no custom key material.
 * Secrets encrypted here can only be decrypted by the same Windows user.
 *
 * Fails closed: on any non-Windows platform, missing PowerShell, or a corrupt
 * blob, these functions throw instead of falling back to plaintext.
 */
const MAGIC = Buffer.from('OFDP');
const FORMAT_VERSION = 1;

export class DpapiUnavailableError extends Error {
  constructor(reason: string) {
    super(`Windows DPAPI is unavailable: ${reason}`);
    this.name = 'DpapiUnavailableError';
  }
}

export class SecretFormatError extends Error {
  constructor(reason: string) {
    super(`Protected secret blob is invalid: ${reason}`);
    this.name = 'SecretFormatError';
  }
}

export function isDpapiAvailable(): boolean {
  return process.platform === 'win32';
}

/** DPAPI entropy is derived from the secret's purpose so one blob type
 * cannot be swapped for another. */
function entropyFor(purpose: string): Buffer {
  return createHash('sha256').update(`openfrost/v1:${purpose}`).digest();
}

function powershellScript(op: 'protect' | 'unprotect', entropyB64: string): string {
  const call =
    op === 'protect'
      ? '[System.Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)'
      : '[System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)';
  return [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Security',
    '$in = [Console]::In.ReadToEnd().Trim()',
    'if ([string]::IsNullOrEmpty($in)) { throw "empty input" }',
    '$bytes = [Convert]::FromBase64String($in)',
    `$entropy = [Convert]::FromBase64String("${entropyB64}")`,
    `$out = ${call}`,
    '[Console]::Out.Write([Convert]::ToBase64String($out))',
  ].join('\n');
}

/** A hung PowerShell (e.g. AV interference) must not leave API requests
 * pending forever: kill the child and fail closed. */
const POWERSHELL_TIMEOUT_MS = 15_000;

function runPowerShell(
  op: 'protect' | 'unprotect',
  purpose: string,
  data: Buffer,
): Promise<Buffer> {
  if (!isDpapiAvailable()) {
    return Promise.reject(
      new DpapiUnavailableError(
        `not supported on platform "${process.platform}"; secrets stay protected only on Windows`,
      ),
    );
  }
  const entropyB64 = entropyFor(purpose).toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', powershellScript(op, entropyB64)],
      { windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new DpapiUnavailableError(
          `PowerShell ${op} timed out after ${POWERSHELL_TIMEOUT_MS} ms`,
        ),
      );
    }, POWERSHELL_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    // Killing the child can surface EPIPE on stdin; the timeout rejection
    // already covers this case.
    child.stdin.on('error', () => {});
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new DpapiUnavailableError(err.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new DpapiUnavailableError(
            `PowerShell ${op} exited with ${code}: ${stderr.trim() || 'no stderr'}`,
          ),
        );
        return;
      }
      try {
        resolve(Buffer.from(stdout.trim(), 'base64'));
      } catch {
        reject(new DpapiUnavailableError(`PowerShell ${op} returned invalid base64`));
      }
    });
    child.stdin.write(data.toString('base64'));
    child.stdin.end();
  });
}

/** Blob layout: MAGIC | version (u8) | purpose length (u16 BE) | purpose (utf8) | DPAPI bytes. */
export async function seal(plaintext: Buffer, purpose: string): Promise<Buffer> {
  const cipher = await runPowerShell('protect', purpose, plaintext);
  const purposeBuf = Buffer.from(purpose, 'utf8');
  if (purposeBuf.length > 0xffff) {
    throw new SecretFormatError('purpose too long');
  }
  const header = Buffer.alloc(MAGIC.length + 3);
  MAGIC.copy(header, 0);
  header.writeUInt8(FORMAT_VERSION, MAGIC.length);
  header.writeUInt16BE(purposeBuf.length, MAGIC.length + 1);
  return Buffer.concat([header, purposeBuf, cipher]);
}

export async function open(blob: Buffer, purpose: string): Promise<Buffer> {
  const headerLen = MAGIC.length + 3;
  if (blob.length < headerLen || !blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new SecretFormatError('missing OFDP magic');
  }
  if (blob.readUInt8(MAGIC.length) !== FORMAT_VERSION) {
    throw new SecretFormatError('unsupported blob version');
  }
  const purposeLen = blob.readUInt16BE(MAGIC.length + 1);
  const purposeStart = headerLen;
  const purposeEnd = purposeStart + purposeLen;
  if (blob.length < purposeEnd) {
    throw new SecretFormatError('truncated purpose');
  }
  const storedPurpose = blob.subarray(purposeStart, purposeEnd).toString('utf8');
  if (storedPurpose !== purpose) {
    throw new SecretFormatError(
      `blob purpose "${storedPurpose}" does not match requested "${purpose}"`,
    );
  }
  return runPowerShell('unprotect', purpose, blob.subarray(purposeEnd));
}
