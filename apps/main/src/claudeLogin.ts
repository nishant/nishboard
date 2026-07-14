import { BrowserWindow } from 'electron';
import { execFile, spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { ClaudeLoginOpenResult, IpcChannels } from '@dash/shared';

// One-click Claude Code CLI login (Settings → App → Claude + the widget's
// "not available" panel). Opens a REAL terminal window running
// `claude auth login --claudeai` (the CLI opens the browser / shows its own
// prompts — the user finishes there), then watches for fresh CLI credentials
// and auto-closes the terminal once login lands:
//   - Windows/Linux: ~/.claude/.credentials.json mtime bump (that's where the
//     CLI writes its OAuth tokens — same file packages/server claudeUsage.ts reads).
//   - macOS-only: the CLI stores creds in the login keychain (service
//     "Claude Code-credentials"); we poll `security find-generic-password`
//     WITHOUT -w — metadata only, the secret never enters this process — and
//     watch the item's "mdat" (modified date) attribute.
// The watcher gives up after 5 minutes and leaves the terminal open.

const POLL_MS = 2_000;
const WATCH_TIMEOUT_MS = 5 * 60_000;
// Grace before killing the terminal: lets the CLI finish its post-login writes
// (settings/onboarding files) and render "Login successful" before the window
// vanishes.
const KILL_GRACE_MS = 1_500;

/** The exact command the terminal runs. `claude auth login` is the CLI's
 *  dedicated login flow (verified against CLI 2.1.201) — it opens the browser,
 *  waits for the OAuth callback, prints success, and exits. `--claudeai`
 *  pins subscription billing (Max plan), never Console/API-key billing. */
export const CLAUDE_LOGIN_COMMAND = 'claude auth login --claudeai';

/** Exported for tests. */
export function credentialsPath(homeDir: string): string {
  return path.join(homeDir, '.claude', '.credentials.json');
}

export interface TerminalSpawnSpec {
  file: string;
  args: string[];
  /** Hide the helper process's own console (Windows-only concern — the
   *  powershell helper must not flash a second window). */
  windowsHide: boolean;
}

/** Build the platform-specific "open a visible terminal running <command>"
 *  spawn. Exported for tests.
 *
 *  Windows-only: PowerShell `Start-Process cmd /k … -PassThru` — ShellExecute
 *  always allocates a NEW visible console for cmd (spawning cmd.exe directly
 *  would attach to the parent's console under `pnpm dev`), and -PassThru
 *  prints the cmd PID: the killable root of the window's process tree. On
 *  Win11 the default-terminal setting routes this window into Windows
 *  Terminal anyway. Deliberately NOT `wt.exe`: the wt alias hands off to
 *  WindowsTerminal.exe and exits, so its PID can't close the window — and
 *  killing WindowsTerminal.exe would nuke every open tab.
 *
 *  macOS-only: osascript driving Terminal.app; `do script` echoes the created
 *  tab/window reference ("tab 1 of window id 123 …") on stdout, which we keep
 *  so the exact window can be closed later. */
export function buildTerminalSpawnSpec(platform: NodeJS.Platform, command: string): TerminalSpawnSpec {
  if (platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: [
        '-NoProfile',
        '-Command',
        `(Start-Process cmd -ArgumentList '/k','${command}' -PassThru).Id`,
      ],
      windowsHide: true,
    };
  }
  return {
    file: 'osascript',
    args: [
      '-e', `tell application "Terminal" to do script "${command}"`,
      '-e', 'tell application "Terminal" to activate',
    ],
    windowsHide: false,
  };
}

/** Parse the Start-Process helper's stdout (the spawned cmd PID). Exported for tests. */
export function parseSpawnedPid(stdout: string): number | null {
  const pid = Number.parseInt(stdout.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Parse the Terminal.app window id out of osascript's `do script` result
 *  ("tab 1 of window id 2685 of application \"Terminal\""). Exported for tests. */
export function parseTerminalWindowId(stdout: string): number | null {
  const match = /window id (\d+)/.exec(stdout);
  return match ? Number.parseInt(match[1], 10) : null;
}

/** Extract the "mdat" (modified date) attribute from
 *  `security find-generic-password` metadata output (macOS-only). Exported for tests. */
export function parseKeychainMdat(securityOutput: string): string | null {
  const match = /"mdat"<timedate>=\S+\s+"([^"]+)"/.exec(securityOutput);
  return match ? match[1] : null;
}

export interface CredsSnapshot {
  /** ~/.claude/.credentials.json mtime; null = file absent. */
  fileMtimeMs: number | null;
  /** macOS keychain item modified-date attribute; null = no item / not darwin. */
  keychainMdat: string | null;
}

/** True when the current snapshot shows credentials newer than the baseline —
 *  i.e. the CLI just wrote a fresh login. Exported for tests. */
export function credsChanged(baseline: CredsSnapshot, current: CredsSnapshot): boolean {
  if (
    current.fileMtimeMs !== null &&
    (baseline.fileMtimeMs === null || current.fileMtimeMs > baseline.fileMtimeMs)
  ) {
    return true;
  }
  return current.keychainMdat !== null && current.keychainMdat !== baseline.keychainMdat;
}

// ── Watcher (module singleton — one login flow at a time) ─────────────────────

interface ActiveLogin {
  timer: NodeJS.Timeout;
}
let active: ActiveLogin | null = null;
let opening = false;

async function readCredsSnapshot(): Promise<CredsSnapshot> {
  let fileMtimeMs: number | null = null;
  try {
    fileMtimeMs = (await fs.stat(credentialsPath(os.homedir()))).mtimeMs;
  } catch {
    // absent — normal before first login
  }
  let keychainMdat: string | null = null;
  if (process.platform === 'darwin') {
    // macOS-only: metadata read (no -w) — the token itself is never fetched.
    keychainMdat = await new Promise<string | null>((resolve) => {
      execFile(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials'],
        { timeout: 5_000 },
        (err, stdout) => resolve(err ? null : parseKeychainMdat(String(stdout))),
      );
    });
  }
  return { fileMtimeMs, keychainMdat };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence probe, works on Windows too
    return true;
  } catch {
    return false;
  }
}

function stopWatch(): void {
  if (!active) return;
  clearInterval(active.timer);
  active = null;
}

function broadcastLoginFinished(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('claude:login-finished' satisfies IpcChannels);
  }
}

/** Open the login terminal and start the credentials watcher. Resolves once
 *  the terminal window is up ('opened') or immediately when a previous login
 *  flow is still being watched ('already-open'). Rejects when no terminal
 *  could be spawned. */
export async function openClaudeLogin(): Promise<ClaudeLoginOpenResult> {
  if (active || opening) return 'already-open';
  opening = true;
  try {
    const baseline = await readCredsSnapshot();

    const spec = buildTerminalSpawnSpec(process.platform, CLAUDE_LOGIN_COMMAND);
    const helper = spawn(spec.file, spec.args, {
      windowsHide: spec.windowsHide,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let helperOut = '';
    helper.stdout.on('data', (chunk: Buffer) => {
      helperOut += chunk.toString('utf8');
    });
    const helperOk = await new Promise<boolean>((resolve) => {
      helper.once('error', () => resolve(false)); // ENOENT etc.
      helper.once('close', (code) => resolve(code === 0));
    });
    if (!helperOk) throw new Error('Could not open a terminal window for Claude login');

    // Windows-only: cmd PID (tree-killable). macOS-only: Terminal window id.
    const winPid = process.platform === 'win32' ? parseSpawnedPid(helperOut) : null;
    const macWindowId = process.platform === 'darwin' ? parseTerminalWindowId(helperOut) : null;

    const closeTerminal = (): void => {
      if (winPid !== null) {
        // Windows-only: kill the cmd tree we spawned — the console window
        // (or its Windows Terminal tab) closes with it.
        execFile('taskkill', ['/PID', String(winPid), '/T', '/F'], () => undefined);
      } else if (macWindowId !== null) {
        // macOS-only: close the exact Terminal window `do script` created.
        // Best-effort — if Terminal prompts about a running process, the user
        // dismisses it (claude has already exited by this point).
        execFile(
          'osascript',
          ['-e', `tell application "Terminal" to close (every window whose id is ${macWindowId}) saving no`],
          () => undefined,
        );
      }
      // No handle (unexpected stdout) → leave the window open; auto-close is
      // best-effort and the login itself already succeeded.
    };

    const deadline = Date.now() + WATCH_TIMEOUT_MS;
    let ticking = false; // keychain probe can outlast a 2s tick — never overlap
    const timer = setInterval(() => {
      if (ticking) return;
      ticking = true;
      void (async () => {
        try {
          if (Date.now() > deadline) {
            stopWatch(); // give up quietly; terminal stays for the user
            return;
          }
          if (winPid !== null && !pidAlive(winPid)) {
            stopWatch(); // Windows-only: user closed the window themselves
            return;
          }
          const current = await readCredsSnapshot();
          if (credsChanged(baseline, current)) {
            stopWatch();
            setTimeout(closeTerminal, KILL_GRACE_MS);
            broadcastLoginFinished();
          }
        } finally {
          ticking = false;
        }
      })();
    }, POLL_MS);
    active = { timer };
    return 'opened';
  } finally {
    opening = false;
  }
}
