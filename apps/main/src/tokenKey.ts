import { safeStorage } from 'electron';
import { randomBytes } from 'crypto';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';

// The server encrypts ~/.dash/*_tokens.json with this key (env DASH_TOKEN_KEY).
// The key itself is stored encrypted with safeStorage next to the tokens, so both
// survive a reinstall together.

let cached: Promise<string | null> | null = null;

function keyFile(): string {
  return path.join(os.homedir(), '.dash', '.token-key');
}

function isValidKey(b64: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(b64) && Buffer.from(b64, 'base64').length === 32;
}

/** Electron types decryptStringAsync as `{ result, shouldReEncrypt }`; accept a bare string too. */
function decryptedText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'result' in value) {
    const result = (value as { result: unknown }).result;
    return typeof result === 'string' ? result : null;
  }
  return null;
}

async function load(): Promise<string | null> {
  try {
    const file = keyFile();
    let existing: Buffer | null = null;
    try {
      existing = await fsp.readFile(file);
    } catch {
      existing = null;
    }

    if (existing) {
      // Never overwrite an existing key file, even when it cannot be decrypted:
      // the tokens encrypted with it would be lost for good.
      const text = decryptedText(await safeStorage.decryptStringAsync(existing));
      return text !== null && isValidKey(text) ? text : null;
    }

    if (!(await safeStorage.isAsyncEncryptionAvailable())) return null;
    const key = randomBytes(32).toString('base64');
    const encrypted = await safeStorage.encryptStringAsync(key);
    await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fsp.writeFile(file, encrypted, { mode: 0o600 });
    return key;
  } catch (err) {
    console.warn('[tokenKey] unavailable, OAuth tokens stay plaintext (mode 0600):', err instanceof Error ? err.message : 'unknown error');
    return null;
  }
}

/** Base64 32-byte token key for the server, or null when safeStorage is unavailable
 *  or the stored key cannot be read. Computed once; never logs the key. */
export function loadTokenKey(): Promise<string | null> {
  cached ??= load();
  return cached;
}
