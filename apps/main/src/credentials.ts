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

export function readCredentials(): Partial<Record<CredentialKey, string>> {
  const file = credentialsPath();
  if (!existsSync(file)) return {};

  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
    const result: Partial<Record<CredentialKey, string>> = {};

    for (const [key, val] of Object.entries(raw)) {
      if (!isCredentialKey(key) || typeof val !== 'string') continue;
      try {
        result[key] = safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(val, 'base64'))
          : val; // fallback: plaintext (safeStorage unavailable on some Linux setups)
      } catch {
        // corrupted entry — skip silently
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Which credential keys are stored — a presence check on the JSON file that
 *  never decrypts anything. This is all the renderer is allowed to know. */
export function readCredentialStatus(): Partial<Record<CredentialKey, boolean>> {
  const file = credentialsPath();
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
    const result: Partial<Record<CredentialKey, boolean>> = {};
    for (const key of Object.keys(raw)) {
      if (isCredentialKey(key)) result[key] = true;
    }
    return result;
  } catch {
    return {};
  }
}

/** Merge-on-save: the write-only Settings UI sends only touched keys.
 *  Non-empty string = set/replace; '' = clear; absent = keep the stored value.
 *  Existing entries are carried over as-is (still encrypted) — they are never
 *  round-tripped through the renderer. */
export function writeCredentials(creds: Partial<Record<CredentialKey, string>>): void {
  const dir = path.dirname(credentialsPath());
  mkdirSync(dir, { recursive: true });

  let stored: Record<string, string> = {};
  if (existsSync(credentialsPath())) {
    try {
      const raw = JSON.parse(readFileSync(credentialsPath(), 'utf8')) as Record<string, string>;
      for (const [key, val] of Object.entries(raw)) {
        if (isCredentialKey(key) && typeof val === 'string') stored[key] = val;
      }
    } catch {
      stored = {};
    }
  }

  for (const [key, val] of Object.entries(creds)) {
    if (!isCredentialKey(key) || typeof val !== 'string') continue;
    if (val === '') {
      delete stored[key];
    } else {
      stored[key] = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(val).toString('base64')
        : val;
    }
  }
  writeFileSync(credentialsPath(), JSON.stringify(stored, null, 2), 'utf8');
}
