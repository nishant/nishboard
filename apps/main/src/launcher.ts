import { app, dialog, net, shell, BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { LauncherGroupData, LauncherItemData, LauncherStateData } from '@dash/shared';

// Quick-launcher persistence lives entirely in the main process:
// userData/launcher.json holds groups + items where item.target is the
// executable path or URL. The renderer only ever receives the sanitized
// LauncherStateData (no targets) and launches by id — file paths never cross
// the contextBridge in either direction. Icons are resolved main-side too and
// cross as data: URIs (bytes only): even a favicon URL would leak the
// target's hostname.

interface LauncherItem extends LauncherItemData {
  target: string;
}

interface LauncherFile {
  version: 2;
  groups: LauncherGroupData[];
  items: LauncherItem[];
}

const FAVICON_TIMEOUT_MS = 3000;
const FAVICON_MAX_BYTES = 64 * 1024;

function launcherPath(): string {
  return path.join(app.getPath('userData'), 'launcher.json');
}

function isValidItem(it: unknown): it is LauncherItem {
  if (typeof it !== 'object' || it === null) return false;
  const x = it as LauncherItem;
  return (
    typeof x.id === 'string' &&
    typeof x.label === 'string' &&
    typeof x.target === 'string' &&
    (x.kind === 'app' || x.kind === 'url') &&
    (x.group === undefined || typeof x.group === 'string') &&
    (x.icon === undefined || (typeof x.icon === 'string' && x.icon.startsWith('data:')))
  );
}

function isValidGroup(g: unknown): g is LauncherGroupData {
  if (typeof g !== 'object' || g === null) return false;
  const x = g as LauncherGroupData;
  return typeof x.id === 'string' && typeof x.label === 'string';
}

/** Pure migration: v1 flat array → v2 file; v2 validated (dangling group refs
 *  dropped); anything else → empty. Exported for direct testing. */
export function migrateLauncherFile(raw: unknown): LauncherFile {
  if (Array.isArray(raw)) {
    return { version: 2, groups: [], items: raw.filter(isValidItem) };
  }
  if (typeof raw === 'object' && raw !== null && (raw as LauncherFile).version === 2) {
    const src = raw as { groups?: unknown; items?: unknown };
    const groups = Array.isArray(src.groups) ? src.groups.filter(isValidGroup) : [];
    const items = Array.isArray(src.items) ? src.items.filter(isValidItem) : [];
    const gids = new Set(groups.map((g) => g.id));
    for (const it of items) {
      if (it.group !== undefined && !gids.has(it.group)) delete it.group;
    }
    return { version: 2, groups, items };
  }
  return { version: 2, groups: [], items: [] };
}

let file: LauncherFile | null = null;

function load(): LauncherFile {
  if (file) return file;
  try {
    file = migrateLauncherFile(JSON.parse(readFileSync(launcherPath(), 'utf8')));
  } catch {
    file = { version: 2, groups: [], items: [] };
  }
  return file;
}

function save(): void {
  // Always writes v2 — a v1 file upgrades one-way on first mutation.
  writeFileSync(launcherPath(), JSON.stringify(file ?? load(), null, 2), 'utf8');
}

/** The single sanitizer between disk state and the renderer: icon (data: URI
 *  bytes) passes, `target` never does. */
function toData(it: LauncherItem): LauncherItemData {
  return { id: it.id, label: it.label, kind: it.kind, group: it.group, icon: it.icon };
}

export function getLauncherState(): LauncherStateData {
  const f = load();
  return { groups: f.groups.map((g) => ({ ...g })), items: f.items.map(toData) };
}

// ── Icons (main-side only) ────────────────────────────────────────────────────

/** Icon for an executable/app. Windows .lnk: read the shortcut's target for
 *  icon extraction only — launching keeps the .lnk (preserves args/cwd). */
async function appIcon(target: string): Promise<string | undefined> {
  try {
    let iconSource = target;
    if (process.platform === 'win32' && target.toLowerCase().endsWith('.lnk')) {
      try {
        const resolved = shell.readShortcutLink(target).target;
        if (resolved) iconSource = resolved;
      } catch {
        // Unreadable shortcut — getFileIcon on the .lnk still yields something.
      }
    }
    // 'normal' = 32px — right for an 18px render at 2× DPI without bloating
    // the JSON the way 'large' (48px) would.
    const img = await app.getFileIcon(iconSource, { size: 'normal' });
    return img.isEmpty() ? undefined : img.toDataURL();
  } catch {
    return undefined;
  }
}

/** Favicon for a URL, fetched main-side and inlined as a data: URI. The
 *  timeout is load-bearing: adding a URL while offline must not hang the IPC. */
async function urlIcon(target: string): Promise<string | undefined> {
  try {
    const host = new URL(target).hostname;
    const res = await net.fetch(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`,
      { signal: AbortSignal.timeout(FAVICON_TIMEOUT_MS) },
    );
    if (!res.ok) return undefined;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > FAVICON_MAX_BYTES) return undefined;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  }
}

function resolveIcon(it: LauncherItem): Promise<string | undefined> {
  return it.kind === 'app' ? appIcon(it.target) : urlIcon(it.target);
}

/** Re-derive icons for every item — also the backfill path for items that
 *  predate icons (v1-migrated files). Failures leave existing icons in place. */
export async function refreshLauncherIcons(): Promise<void> {
  const f = load();
  for (const it of f.items) {
    const icon = await resolveIcon(it);
    if (icon) it.icon = icon;
  }
  save();
}

// ── Items ─────────────────────────────────────────────────────────────────────

/** Native file picker → new 'app' item. Returns null when cancelled. */
export async function addLauncherApp(win: BrowserWindow | null): Promise<LauncherItemData | null> {
  const filters =
    process.platform === 'win32'
      ? [{ name: 'Programs', extensions: ['exe', 'lnk', 'bat', 'cmd'] }]
      : process.platform === 'darwin'
        ? [{ name: 'Applications', extensions: ['app'] }]
        : [{ name: 'All files', extensions: ['*'] }];
  const defaultPath =
    process.platform === 'darwin' ? '/Applications'
    : process.platform === 'win32' ? path.join(process.env.ProgramFiles ?? 'C:\\Program Files')
    : undefined;

  const result = win
    ? await dialog.showOpenDialog(win, { properties: ['openFile'], filters, defaultPath })
    : await dialog.showOpenDialog({ properties: ['openFile'], filters, defaultPath });
  const target = result.filePaths[0];
  if (result.canceled || !target) return null;

  const label = path.basename(target, path.extname(target));
  const item: LauncherItem = { id: randomUUID(), label, kind: 'app', target };
  item.icon = await appIcon(target);
  load().items.push(item);
  save();
  return toData(item);
}

export async function addLauncherUrl(label: string, url: string): Promise<LauncherItemData> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are allowed');
  const item: LauncherItem = {
    id: randomUUID(),
    label: label.trim() || new URL(url).hostname,
    kind: 'url',
    target: url,
  };
  item.icon = await urlIcon(url); // fail-soft: undefined offline → lucide fallback
  load().items.push(item);
  save();
  return toData(item);
}

export function removeLauncherItem(id: string): void {
  const f = load();
  f.items = f.items.filter((it) => it.id !== id);
  save();
}

export function renameLauncherItem(id: string, label: string): void {
  const it = load().items.find((x) => x.id === id);
  if (it && label.trim()) {
    it.label = label.trim();
    save();
  }
}

/** Reorder to match `ids`; items not mentioned keep their relative order at the end. */
export function reorderLauncherItems(ids: string[]): void {
  const f = load();
  const byId = new Map(f.items.map((it) => [it.id, it]));
  const next: LauncherItem[] = [];
  for (const id of ids) {
    const it = byId.get(id);
    if (it) { next.push(it); byId.delete(id); }
  }
  next.push(...byId.values());
  f.items = next;
  save();
}

export async function launchItem(id: string): Promise<void> {
  const it = load().items.find((x) => x.id === id);
  if (!it) return;
  if (it.kind === 'url') {
    // Re-validate at launch: the file on disk is user-editable.
    if (/^https?:\/\//i.test(it.target)) await shell.openExternal(it.target);
    return;
  }
  await shell.openPath(it.target);
}

// ── Groups ────────────────────────────────────────────────────────────────────

export function addLauncherGroup(label: string): LauncherGroupData {
  const group: LauncherGroupData = { id: randomUUID(), label: label.trim() || 'Group' };
  load().groups.push(group);
  save();
  return { ...group };
}

export function renameLauncherGroup(id: string, label: string): void {
  const g = load().groups.find((x) => x.id === id);
  if (g && label.trim()) {
    g.label = label.trim();
    save();
  }
}

/** Delete the group and ungroup its members — items are never deleted. */
export function removeLauncherGroup(id: string): void {
  const f = load();
  f.groups = f.groups.filter((g) => g.id !== id);
  for (const it of f.items) {
    if (it.group === id) delete it.group;
  }
  save();
}

export function assignLauncherGroup(itemId: string, groupId: string | null): void {
  const f = load();
  const it = f.items.find((x) => x.id === itemId);
  if (!it) return;
  if (groupId === null) {
    delete it.group;
  } else if (f.groups.some((g) => g.id === groupId)) {
    it.group = groupId;
  }
  save();
}

/** Launch all members sequentially with a small stagger so the launched apps
 *  don't fight over focus all at once. */
export async function launchGroup(id: string): Promise<void> {
  const members = load().items.filter((it) => it.group === id);
  for (const it of members) {
    await launchItem(it.id);
    await new Promise((r) => setTimeout(r, 100));
  }
}
