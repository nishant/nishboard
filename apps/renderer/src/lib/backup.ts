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

/** Read a backup file and write its keys back to localStorage. Caller should reload. */
export async function importSettings(file: File): Promise<void> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<BackupFile>;
  if (parsed?.app !== 'nishboard') {
    throw new Error('Not a Nishboard settings file');
  }
  if (parsed.version !== 1) {
    throw new Error(`Unsupported settings-file version (${String(parsed.version)})`);
  }
  const data = parsed.data;
  if (!data || typeof data !== 'object') {
    throw new Error('Not a valid Nishboard settings file');
  }
  for (const [k, v] of Object.entries(data)) {
    // Only restore our own keys — a crafted file must not be able to write
    // arbitrary localStorage entries.
    if (!isBackupKey(k)) continue;
    localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
}
