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

/** True when any ~/.dash/*_tokens.json already holds an encrypted payload, i.e. the
 *  existing key file is the only way to read it and must never be replaced. */
async function hasEncryptedTokens(dir: string): Promise<boolean> {
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return false;
  }
  for (const name of names) {
    if (!name.endsWith('_tokens.json')) continue;
    try {
      const parsed: unknown = JSON.parse(await fsp.readFile(path.join(dir, name), 'utf8'));
      if (typeof parsed === 'object' && parsed !== null && (parsed as { alg?: unknown }).alg === 'aes-256-gcm') return true;
    } catch {
      // unreadable or plaintext: not an encrypted payload
    }
  }
  return false;
}

async function createKey(file: string): Promise<string> {
  const key = randomBytes(32).toString('base64');
  const encrypted = await safeStorage.encryptStringAsync(key);
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  // Atomic: a crash or full disk must never leave a truncated key file behind.
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await fsp.writeFile(tmp, encrypted, { mode: 0o600 });
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  return key;
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

    if (existing && existing.length > 0) {
      let text: string | null = null;
      try {
        text = decryptedText(await safeStorage.decryptStringAsync(existing));
      } catch {
        text = null;
      }
      if (text !== null && isValidKey(text)) return text;
      // Unreadable key. If encrypted tokens depend on it, never replace it.
      if (await hasEncryptedTokens(path.dirname(file))) {
        console.warn('[tokenKey] existing key cannot be read and encrypted tokens depend on it; OAuth tokens will fall back to plaintext until it is fixed');
        cached = null; // let a later restartServer() try again
        return null;
      }
    }

    if (!(await safeStorage.isAsyncEncryptionAvailable())) return null;
    return await createKey(file);
  } catch (err) {
    console.warn('[tokenKey] unavailable, OAuth tokens fall back to plaintext (mode 0600):', err instanceof Error ? err.message : 'unknown error');
    cached = null;
    return null;
  }
}

/** Base64 32-byte token key for the server, or null when safeStorage is unavailable
 *  or the stored key cannot be read. Computed once on success (a failure is retried on the next call); never logs the key. */
export function loadTokenKey(): Promise<string | null> {
  cached ??= load();
  return cached;
}
