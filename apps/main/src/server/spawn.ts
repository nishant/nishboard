import { ChildProcess, spawn, execSync } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { readCredentials } from '../credentials';

// ── Server log tee ────────────────────────────────────────────────────────────
// Child stdout/stderr also land in userData/logs/server.log so "why is a
// widget erroring" is debuggable after the fact. 5 MB cap with one rotation
// (server.log → server.log.1).

const LOG_MAX_BYTES = 5 * 1024 * 1024;
let logStream: fs.WriteStream | null = null;
let logBytes = 0;

export function logsDir(): string {
  return path.join(app.getPath('userData'), 'logs');
}

function logFile(): string {
  return path.join(logsDir(), 'server.log');
}

function openLogStream(): void {
  try {
    fs.mkdirSync(logsDir(), { recursive: true });
    logBytes = fs.existsSync(logFile()) ? fs.statSync(logFile()).size : 0;
    if (logBytes > LOG_MAX_BYTES) rotateLog();
    logStream = fs.createWriteStream(logFile(), { flags: 'a' });
  } catch {
    logStream = null; // logging is best-effort — never block the server on it
  }
}

function rotateLog(): void {
  try {
    fs.renameSync(logFile(), `${logFile()}.1`); // replaces any previous .1
    logBytes = 0;
  } catch { /* best-effort */ }
}

function teeToLog(chunk: Buffer | string): void {
  if (!logStream) return;
  if (logBytes > LOG_MAX_BYTES) {
    logStream.end();
    rotateLog();
    logStream = fs.createWriteStream(logFile(), { flags: 'a' });
  }
  logStream.write(chunk);
  logBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
}

function closeLogStream(): void {
  logStream?.end();
  logStream = null;
}

let serverProcess: ChildProcess | null = null;
// Distinguishes our own kill (quit, credential-save restart) from a crash, so the
// exit handler only auto-respawns on the latter.
let intentionalStop = false;
let restartAttempts = 0;
let restartTimer: NodeJS.Timeout | null = null;

const MAX_RESTART_ATTEMPTS = 5;
const HEALTHY_RESET_MS = 60_000;

const isDev = process.env.NODE_ENV === 'development';
const port = Number(process.env.SERVER_PORT ?? 7432);

/** Kill any leftover process holding our port from a previous (possibly crashed) run. */
function killStaleOnPort(p: number): void {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${p} | findstr LISTENING`, { encoding: 'utf8' });
      const match = out.match(/\s+(\d+)\s*$/m);
      if (match) execSync(`taskkill /PID ${match[1]} /F`, { stdio: 'ignore' });
    } else {
      const pids = execSync(`lsof -ti tcp:${p}`, { encoding: 'utf8' }).trim();
      if (pids) execSync(`kill -9 ${pids}`, { stdio: 'ignore' });
    }
  } catch {
    // Nothing on the port, or command unavailable — safe to continue
  }
}

async function waitForServer(timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server on :${port} did not start within ${timeoutMs}ms`);
}

function startChild(): void {
  // In production the server lives at {appPath}/server/index.js
  // (electron-builder maps packages/server/dist → server/ with asar: false)
  const serverEntry = path.join(app.getAppPath(), 'server', 'index.js');

  // Inject credentials stored via safeStorage so the server reads them from process.env
  const credentials = readCredentials();

  // process.execPath in Electron is the Electron binary, not Node.js.
  // Setting ELECTRON_RUN_AS_NODE=1 makes the Electron binary behave as a
  // plain Node.js runner — the correct way to spawn Node scripts from Electron.
  serverProcess = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      SERVER_PORT: String(port),
      ...credentials,
    },
    stdio: 'pipe',
  });
  openLogStream();
  teeToLog(`\n--- server spawned ${new Date().toISOString()} ---\n`);
  serverProcess.stdout?.pipe(process.stdout);
  serverProcess.stderr?.pipe(process.stderr);
  serverProcess.stdout?.on('data', teeToLog);
  serverProcess.stderr?.on('data', teeToLog);
  serverProcess.on('error', (err) => console.error('[server] spawn error:', err));

  const startedAt = Date.now();
  serverProcess.on('exit', (code, signal) => {
    serverProcess = null;
    closeLogStream();
    if (intentionalStop) return;
    // A crash after a healthy stretch is a fresh incident, not a crash loop.
    if (Date.now() - startedAt > HEALTHY_RESET_MS) restartAttempts = 0;
    if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
      console.error(
        `[server] exited (code ${code}, signal ${signal}) — giving up after ${MAX_RESTART_ATTEMPTS} restarts`,
      );
      return;
    }
    const delay = 1000 * 2 ** restartAttempts;
    restartAttempts += 1;
    console.error(
      `[server] exited (code ${code}, signal ${signal}) — restarting in ${delay}ms (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})`,
    );
    restartTimer = setTimeout(startChild, delay);
  });
}

export async function spawnServer(): Promise<void> {
  if (!isDev) {
    // Production only: clear any leftover process on our port before spawning ours.
    // In dev the server is managed externally by `concurrently` (tsx watch); killing
    // the port here would take down the live dev server on every Electron restart
    // (Electron restarts whenever a main/shared file recompiles), so we skip it.
    killStaleOnPort(port);
    intentionalStop = false;
    restartAttempts = 0;
    startChild();
  }
  // In dev, concurrently already started the server — just wait for it.

  await waitForServer();
  console.log(`[server] ready on :${port}`);
}

export function stopServer(): void {
  intentionalStop = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  serverProcess?.kill();
  serverProcess = null;
}

/** Save new credentials and restart the server child process with updated env vars.
 *  No-op in dev (server is managed externally by concurrently). */
export async function restartServer(): Promise<void> {
  if (isDev) return;
  stopServer();
  await spawnServer();
}
