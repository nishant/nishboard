import { safeStorage, app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { CREDENTIAL_KEYS } from '@dash/shared';
import type { CredentialKey } from '@dash/shared';

function credentialsPath(): string {
  return path.join(app.getPath('userData'), 'credentials.json');
}

// Everything read here is spread into the spawned server's process.env, so both
// read and write are whitelisted to CREDENTIAL_KEYS — otherwise a compromised
// renderer could persist arbitrary env vars (NODE_OPTIONS, PATH, …) via
// credentials:save-all and have them injected into a Node child process.
function isCredentialKey(key: string): key is CredentialKey {
  return (CREDENTIAL_KEYS as readonly string[]).includes(key);
}

type Credentials = Partial<Record<CredentialKey, string>>;

// Decrypted once (loadCredentials) so the sync readers below never touch
// safeStorage's deprecated sync API.
let cache: Credentials = {};

function readStored(): Record<string, string> {
  const file = credentialsPath();
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const stored: Record<string, string> = {};
    for (const [key, val] of Object.entries(raw)) {
      if (isCredentialKey(key) && typeof val === 'string') stored[key] = val;
    }
    return stored;
  } catch {
    return {};
  }
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

/** Decrypt the stored credentials into the module cache. Call once before spawnServer(). */
export async function loadCredentials(): Promise<void> {
  const stored = readStored();
  const available = await safeStorage.isAsyncEncryptionAvailable();
  const result: Credentials = {};
  for (const [key, val] of Object.entries(stored)) {
    if (!isCredentialKey(key)) continue;
    try {
      // fallback: plaintext (safeStorage unavailable on some Linux setups)
      const text = available
        ? decryptedText(await safeStorage.decryptStringAsync(Buffer.from(val, 'base64')))
        : val;
      if (text !== null) result[key] = text;
    } catch {
      // corrupted entry — skip silently
    }
  }
  cache = result;
}

/** The decrypted credentials (empty before loadCredentials() has run). */
export function readCredentials(): Credentials {
  return cache;
}

/** Which credential keys are stored — a presence check that never exposes values.
 *  This is all the renderer is allowed to know. */
export function readCredentialStatus(): Partial<Record<CredentialKey, boolean>> {
  const result: Partial<Record<CredentialKey, boolean>> = {};
  for (const key of Object.keys(cache)) {
    if (isCredentialKey(key)) result[key] = true;
  }
  return result;
}

/** Merge-on-save: the write-only Settings UI sends only touched keys.
 *  Non-empty string = set/replace; '' = clear; absent = keep the stored value.
 *  Existing entries are carried over as-is (still encrypted) — they are never
 *  round-tripped through the renderer. */
export async function writeCredentials(creds: Credentials): Promise<void> {
  const dir = path.dirname(credentialsPath());
  mkdirSync(dir, { recursive: true });

  const stored = readStored();
  const available = await safeStorage.isAsyncEncryptionAvailable();

  for (const [key, val] of Object.entries(creds)) {
    if (!isCredentialKey(key) || typeof val !== 'string') continue;
    if (val === '') {
      delete stored[key];
    } else {
      stored[key] = available
        ? (await safeStorage.encryptStringAsync(val)).toString('base64')
        : val;
    }
  }
  writeFileSync(credentialsPath(), JSON.stringify(stored, null, 2), 'utf8');
  await loadCredentials();
}
