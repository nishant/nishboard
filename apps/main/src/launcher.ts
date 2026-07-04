import { app, dialog, shell, BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import type { LauncherItemData } from '@dash/shared';

// Quick-launcher persistence lives entirely in the main process:
// userData/launcher.json holds { id, label, kind, target } where target is the
// executable path or URL. The renderer only ever receives the sanitized
// LauncherItemData (no target) and launches by id — file paths never cross the
// contextBridge in either direction.

interface LauncherItem extends LauncherItemData {
  target: string;
}

function launcherPath(): string {
  return path.join(app.getPath('userData'), 'launcher.json');
}

let items: LauncherItem[] | null = null;

function load(): LauncherItem[] {
  if (items) return items;
  try {
    const raw = JSON.parse(readFileSync(launcherPath(), 'utf8')) as unknown;
    items = Array.isArray(raw)
      ? raw.filter((it): it is LauncherItem =>
          typeof it === 'object' && it !== null &&
          typeof (it as LauncherItem).id === 'string' &&
          typeof (it as LauncherItem).label === 'string' &&
          typeof (it as LauncherItem).target === 'string' &&
          ((it as LauncherItem).kind === 'app' || (it as LauncherItem).kind === 'url'))
      : [];
  } catch {
    items = existsSync(launcherPath()) ? [] : [];
  }
  return items;
}

function save(): void {
  writeFileSync(launcherPath(), JSON.stringify(items ?? [], null, 2), 'utf8');
}

function toData(it: LauncherItem): LauncherItemData {
  return { id: it.id, label: it.label, kind: it.kind };
}

export function getLauncherItems(): LauncherItemData[] {
  return load().map(toData);
}

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
  load().push(item);
  save();
  return toData(item);
}

export function addLauncherUrl(label: string, url: string): LauncherItemData {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are allowed');
  const item: LauncherItem = {
    id: randomUUID(),
    label: label.trim() || new URL(url).hostname,
    kind: 'url',
    target: url,
  };
  load().push(item);
  save();
  return toData(item);
}

export function removeLauncherItem(id: string): void {
  items = load().filter((it) => it.id !== id);
  save();
}

export function renameLauncherItem(id: string, label: string): void {
  const it = load().find((x) => x.id === id);
  if (it && label.trim()) {
    it.label = label.trim();
    save();
  }
}

/** Reorder to match `ids`; items not mentioned keep their relative order at the end. */
export function reorderLauncherItems(ids: string[]): void {
  const current = load();
  const byId = new Map(current.map((it) => [it.id, it]));
  const next: LauncherItem[] = [];
  for (const id of ids) {
    const it = byId.get(id);
    if (it) { next.push(it); byId.delete(id); }
  }
  next.push(...byId.values());
  items = next;
  save();
}

export async function launchItem(id: string): Promise<void> {
  const it = load().find((x) => x.id === id);
  if (!it) return;
  if (it.kind === 'url') {
    // Re-validate at launch: the file on disk is user-editable.
    if (/^https?:\/\//i.test(it.target)) await shell.openExternal(it.target);
    return;
  }
  await shell.openPath(it.target);
}
