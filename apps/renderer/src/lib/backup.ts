// Settings backup — export/import the renderer's localStorage preferences as one
// JSON file. Covers layout, theme, app settings, watchlist, hardware config, and
// any widget store keyed `dashboard-*`. Secrets are NOT here (API keys live in the
// main process via safeStorage), so they're never written to the file.

const KNOWN_KEYS = [
  'dashboard-layout',
  'dashboard-theme',
  'dashboard-app-settings',
  'stocks-watchlist',
  'hardware-config',
];

function backupKeys(): string[] {
  const keys = new Set(KNOWN_KEYS);
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('dashboard-')) keys.add(k); // catches future widget stores
  }
  return [...keys];
}

interface BackupFile {
  app: 'nishboard';
  version: 1;
  exportedAt: string;
  data: Record<string, unknown>;
}

export function exportSettings(): void {
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
  const payload: BackupFile = {
    app: 'nishboard',
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
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
  const data = parsed?.data;
  if (!data || typeof data !== 'object') {
    throw new Error('Not a valid Nishboard settings file');
  }
  for (const [k, v] of Object.entries(data)) {
    localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
}
