// Settings backup — export/import the renderer's localStorage preferences as one
// JSON file. Covers layout, theme, app settings, hardware config, the crypto
// watchlist, and any widget store keyed `dashboard-*`, except EXCLUDED_KEYS.
// Secrets are NOT here (API keys live in the main process via safeStorage), so
// they're never written to the file. Import merges: it writes the keys in the
// file and leaves every other local key alone.

const KNOWN_KEYS = [
  'dashboard-layout',
  'dashboard-theme',
  'dashboard-app-settings',
  'hardware-config',
  'crypto-watchlist', // not dashboard-* prefixed, so the prefix sweep misses it
];

/** Never written to a backup or restored from one: the Claude transcript (prompts,
 *  file paths, commands, a CLI session id) must not reach the file or the
 *  cloud-synced auto-export folder, and palette recents are per-machine. */
const EXCLUDED_KEYS = ['dashboard-claude', 'dashboard-palette-recents'];

function isBackupKey(k: string): boolean {
  if (EXCLUDED_KEYS.includes(k)) return false;
  return KNOWN_KEYS.includes(k) || k.startsWith('dashboard-');
}

function backupKeys(): string[] {
  const keys = new Set(KNOWN_KEYS);
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && isBackupKey(k)) keys.add(k); // catches future widget stores
  }
  return [...keys];
}

interface BackupFile {
  app: 'nishboard';
  version: 1;
  exportedAt: string;
  data: Record<string, unknown>;
}

/** Snapshot every backup-relevant localStorage key into a BackupFile payload.
 *  Shared by manual Export and the synced-folder auto-export. */
export function buildBackupPayload(): BackupFile {
  const data: Record<string, unknown> = {};
  for (const k of backupKeys()) {
    const raw = localStorage.getItem(k);
    if (raw == null) continue;
    try {
      data[k] = JSON.parse(raw);
    } catch {
      data[k] = raw;
    }
  }
  return {
    app: 'nishboard',
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function exportSettings(): void {
  const payload = buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nishboard-settings.json';
  a.click();
  URL.revokeObjectURL(url);
}

/** Largest settings file we will read. Real backups are tens of KB. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The value to store for a key, or null when it is not a zustand persist
 *  envelope ({ state: object, version: number }). Strings are accepted only when
 *  they hold a JSON envelope (that is how an unparsable value is exported). */
function toEnvelopeString(v: unknown): string | null {
  let value = v;
  if (typeof v === 'string') {
    try {
      value = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || !isRecord(value.state) || typeof value.version !== 'number') return null;
  return JSON.stringify(value);
}

/** Read a backup file and write its keys back to localStorage. Caller should reload.
 *  Keys that are not persist envelopes are skipped. The write is all-or-nothing:
 *  on any error the previous values are restored and the error is rethrown. */
export async function importSettings(file: File): Promise<void> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error('Settings file is too large (over 5 MB)');
  }
  const text = await file.text();
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || parsed.app !== 'nishboard') {
    throw new Error('Not a Nishboard settings file');
  }
  if (parsed.version !== 1) {
    throw new Error(`Unsupported settings-file version (${String(parsed.version)})`);
  }
  const data = parsed.data;
  if (!isRecord(data)) {
    throw new Error('Not a valid Nishboard settings file');
  }
  const writes: [string, string][] = [];
  for (const [k, v] of Object.entries(data)) {
    // Only restore our own keys — a crafted file must not be able to write
    // arbitrary localStorage entries.
    if (!isBackupKey(k)) continue;
    const envelope = toEnvelopeString(v);
    if (envelope === null) continue;
    writes.push([k, envelope]);
  }
  const snapshot = writes.map(([k]): [string, string | null] => [k, localStorage.getItem(k)]);
  try {
    for (const [k, v] of writes) localStorage.setItem(k, v);
  } catch (err) {
    for (const [k, old] of snapshot) {
      try {
        if (old === null) localStorage.removeItem(k);
        else localStorage.setItem(k, old);
      } catch {
        // best effort: nothing more to do if restoring also fails
      }
    }
    throw err;
  }
}
