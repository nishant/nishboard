import { ChildProcess, spawn, execSync } from 'child_process';
import { app } from 'electron';
import path from 'path';
import { readCredentials } from '../credentials';

let serverProcess: ChildProcess | null = null;

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

export async function spawnServer(): Promise<void> {
  killStaleOnPort(port);

  if (!isDev) {
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
    serverProcess.stdout?.pipe(process.stdout);
    serverProcess.stderr?.pipe(process.stderr);
    serverProcess.on('error', (err) => console.error('[server] spawn error:', err));
  }
  // In dev, concurrently already started the server — just wait for it.

  await waitForServer();
  console.log(`[server] ready on :${port}`);
}

export function stopServer(): void {
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
