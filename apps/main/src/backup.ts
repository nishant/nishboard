import { dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import { writeFileSync, renameSync, mkdirSync } from 'fs';
import path from 'path';
import { readPrefs, writePrefs } from './prefs';

// Auto-export target: the renderer sends the (secret-free) settings payload;
// this writes it atomically into the user-chosen folder. Point the folder at a
// Drive-for-Desktop / OneDrive / Dropbox directory and the OS client syncs it.

const FILE_NAME = 'nishboard-settings.json';
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // localStorage prefs — way under this

export async function chooseBackupFolder(win: BrowserWindow | null): Promise<string | null> {
  const opts = { properties: ['openDirectory' as const, 'createDirectory' as const] };
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  const dir = result.filePaths[0];
  if (result.canceled || !dir) return null;
  writePrefs({ backupDir: dir });
  return dir;
}

export function writeBackup(payloadJson: string): void {
  const dir = readPrefs().backupDir;
  if (!dir) return; // auto-export off — cheap no-op
  if (typeof payloadJson !== 'string' || payloadJson.length > MAX_PAYLOAD_BYTES) return;
  try {
    JSON.parse(payloadJson); // must be valid JSON — never write garbage into a synced folder
  } catch {
    return;
  }
  mkdirSync(dir, { recursive: true });
  // Atomic: a sync client should never observe a half-written file.
  const tmp = path.join(dir, `.${FILE_NAME}.tmp`);
  writeFileSync(tmp, payloadJson, 'utf8');
  renameSync(tmp, path.join(dir, FILE_NAME));
}
