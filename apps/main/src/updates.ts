import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, Notification } from 'electron';
import { autoUpdater } from 'electron-updater';
import { readCredentials } from './credentials';
import type { ElectronAPI, UpdateCheckData } from '@dash/shared';

// Update checks against GitHub releases. Optional GITHUB_TOKEN credential
// covers the private-repo case. Releases are produced by
// .github/workflows/release.yml (draft -> installers attached -> published).
//
// Windows packaged builds install updates themselves through electron-updater
// (startAutoUpdates). macOS stays check-only (unsigned builds cannot self-install):
// checkUpdates() compares semver and returns the DMG link.

// Not re-exported from the shared index, so derive it from the API contract.
type UpdateStatusData = Awaited<ReturnType<ElectronAPI['app']['getUpdateStatus']>>;

const REPO = 'nishant/nishboard';
const MEMO_MS = 24 * 60 * 60 * 1000;

let memo: { data: UpdateCheckData; at: number } | null = null;

/** Exported for tests. */
export function normalize(tag: string): string {
  return tag.replace(/^v/i, '').trim();
}

interface SemverParts {
  core: [number, number, number];
  pre: string[];
}

function parseSemver(v: string): SemverParts | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(normalize(v));
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.') : [],
  };
}

/** Compare two versions (MAJOR.MINOR.PATCH[-prerelease], leading v ignored).
 *  Returns >0 when a is newer, <0 when older, 0 when equal or either side is
 *  unparseable (so garbage never reports an update). Exported for tests. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] > pb.core[i] ? 1 : -1;
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1; // a release outranks its prereleases
  if (pb.pre.length === 0) return -1;
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1; // fewer identifiers = lower
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) > Number(y) ? 1 : -1;
    if (xn) return -1; // numeric < alphanumeric
    if (yn) return 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

/** True when this build installs updates itself (Windows packaged). */
export function autoUpdateSupported(): boolean {
  return app.isPackaged === true && process.platform === 'win32';
}

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

/** The installer asset for THIS platform, or null. macOS: prefer the current
 *  arch's DMG (…-arm64.dmg) over any other .dmg; Windows: the NSIS .exe.
 *  Exported for tests. */
export function pickAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
  if (process.platform === 'darwin') {
    const dmgs = assets.filter((a) => a.name.endsWith('.dmg'));
    return dmgs.find((a) => a.name.includes(`-${process.arch}`)) ?? dmgs[0] ?? null;
  }
  if (process.platform === 'win32') {
    return assets.find((a) => a.name.endsWith('.exe')) ?? null;
  }
  return null;
}

export async function checkUpdates(): Promise<UpdateCheckData> {
  const currentVersion = app.getVersion();
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.data;

  const token = readCredentials().GITHUB_TOKEN;
  const none = { autoUpdate: autoUpdateSupported(), latestVersion: null, url: null, assetUrl: null, assetName: null, hasUpdate: false };
  let data: UpdateCheckData;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 404) {
      // No releases yet — or a private repo without a token (GitHub 404s both).
      data = {
        currentVersion, ...none,
        message: token
          ? 'No releases yet — you are on the development build.'
          : 'No releases found. If the repo is private, add a GitHub token in Settings → Developer.',
      };
    } else if (!res.ok) {
      data = {
        currentVersion, ...none,
        message: `GitHub returned ${res.status} — try again later.`,
      };
    } else {
      const release = (await res.json()) as {
        tag_name?: string;
        html_url?: string;
        assets?: ReleaseAsset[];
      };
      const latestVersion = release.tag_name ? normalize(release.tag_name) : null;
      const hasUpdate = latestVersion !== null && compareSemver(latestVersion, currentVersion) > 0;
      const asset = hasUpdate ? pickAsset(release.assets ?? []) : null;
      data = {
        currentVersion,
        latestVersion,
        url: release.html_url ?? null,
        assetUrl: asset?.browser_download_url ?? null,
        assetName: asset?.name ?? null,
        hasUpdate,
        autoUpdate: autoUpdateSupported(),
        message: hasUpdate ? undefined : 'You are up to date.',
      };
    }
  } catch {
    return { // network failure: don't memo — the next click should retry
      currentVersion, ...none,
      message: 'Update check failed — network unavailable?',
    };
  }

  memo = { data, at: Date.now() };
  if (autoUpdateSupported() && data.hasUpdate) {
    // Kick the background updater so the download starts now, not at the next 6h tick.
    void autoUpdater.checkForUpdates().catch(() => undefined);
  }
  return data;
}

// ── Auto-update (Windows packaged builds) ─────────────────────────────────────

const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const LOG_MAX_BYTES = 1024 * 1024;

let status: UpdateStatusData = { state: 'idle', version: null, percent: null, message: null };
let installing = false;
let started = false;
const notifiedVersions = new Set<string>();

/** True once the user chose "Restart to update"; the close-to-tray handler must not block it. */
export function isInstallingUpdate(): boolean {
  return installing;
}

export function getUpdateStatus(): UpdateStatusData {
  return status;
}

export function installUpdate(): void {
  if (status.state !== 'downloaded') return;
  installing = true;
  autoUpdater.quitAndInstall(false, true);
}

interface UpdaterLogger {
  info: (m: unknown) => void;
  warn: (m: unknown) => void;
  error: (m: unknown) => void;
  debug: (m: unknown) => void;
}

function updaterLogger(): UpdaterLogger {
  const file = path.join(app.getPath('userData'), 'logs', 'updater.log');
  const write = (level: string, message: unknown): void => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try {
        if (fs.statSync(file).size > LOG_MAX_BYTES) fs.truncateSync(file, 0);
      } catch { /* no log file yet */ }
      const text = message instanceof Error ? message.message : String(message);
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${text.replace(/\r?\n/g, ' ')}\n`);
    } catch { /* logging must never break updating */ }
  };
  return {
    info: (m) => write('info', m),
    warn: (m) => write('warn', m),
    error: (m) => write('error', m),
    debug: (m) => write('debug', m),
  };
}

export function startAutoUpdates(getWindows: () => BrowserWindow[]): void {
  if (!autoUpdateSupported() || started) return;
  started = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = updaterLogger();

  const set = (next: UpdateStatusData): void => {
    status = next;
    for (const win of getWindows()) {
      if (!win.isDestroyed()) win.webContents.send('app:update-status', next);
    }
  };

  autoUpdater.on('checking-for-update', () =>
    set({ state: 'checking', version: null, percent: null, message: null }));
  autoUpdater.on('update-not-available', () =>
    set({ state: 'idle', version: null, percent: null, message: null }));
  autoUpdater.on('update-available', (info) =>
    set({ state: 'downloading', version: info.version, percent: 0, message: null }));
  autoUpdater.on('download-progress', (p) =>
    set({ state: 'downloading', version: status.version, percent: Math.round(p.percent), message: null }));
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'downloaded', version: info.version, percent: null, message: null });
    if (!notifiedVersions.has(info.version) && Notification.isSupported()) {
      notifiedVersions.add(info.version);
      const n = new Notification({
        title: `Nishboard ${info.version} is ready`,
        body: 'It installs when you quit. Or restart now from Settings → About.',
      });
      n.on('failed', (_e, err) => console.warn('[notify] failed:', err));
      n.show();
    }
  });
  autoUpdater.on('error', (err) =>
    set({ state: 'error', version: null, percent: null, message: (err?.message ?? String(err)).slice(0, 200) }));

  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => undefined); // failures also arrive via the 'error' event
  };
  setTimeout(check, FIRST_CHECK_MS).unref?.();
  setInterval(check, CHECK_EVERY_MS).unref?.();
}
