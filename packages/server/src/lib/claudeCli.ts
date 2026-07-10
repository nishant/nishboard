/**
 * Bridge to the user-installed Claude Code CLI (`claude`). The CLI is spawned
 * as a child process in `-p` (print) mode with stream-json output and the
 * prompt written to stdin. Billing rides the CLI's own claude.ai OAuth login
 * (Max subscription) — see the env handling in spawnClaudeChat for the
 * load-bearing ANTHROPIC_API_KEY deletion.
 *
 * NEVER log the OAuth token or message contents from this module.
 */
import { spawn, execFile } from 'child_process';
import type { ChildProcess } from 'child_process';
import { promisify } from 'util';
import { access, mkdir } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import os from 'os';
import path from 'path';
import type { ClaudeStatusData, ClaudeStreamEvent } from '@dash/shared';

const execFileAsync = promisify(execFile);

// ── CLI discovery ────────────────────────────────────────────────────────────

interface CliInfo {
  path: string;
  version: string | null;
}

// Positive results cache forever (an installed CLI doesn't move mid-session);
// negative results are NOT cached here — the route's 60s TtlCache throttles
// re-probing instead. resetCliCache() drops the cache after a spawn failure
// (e.g. the CLI was uninstalled/reinstalled while we were running).
let cached: CliInfo | null = null;

/** Exported for tests (and used internally on spawn failure). */
export function resetCliCache(): void {
  cached = null;
}

async function findOnWindows(): Promise<string | null> {
  // Windows-only: `where.exe claude` lists every PATH match. npm installs
  // create claude.cmd (+ extensionless sh shim); the native installer drops a
  // claude.exe. Prefer .exe, else .cmd — anything else isn't spawnable here.
  try {
    const { stdout } = await execFileAsync('where.exe', ['claude'], { encoding: 'utf8' });
    const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const exe = lines.find((l) => l.toLowerCase().endsWith('.exe'));
    if (exe) return exe;
    const cmd = lines.find((l) => l.toLowerCase().endsWith('.cmd'));
    return cmd ?? null;
  } catch {
    return null;
  }
}

async function findOnMac(): Promise<string | null> {
  // macOS-only: `which` first, then the usual suspects — a packaged Electron
  // app launched from Finder inherits launchd's minimal PATH which misses
  // every one of these.
  try {
    const { stdout } = await execFileAsync('which', ['claude'], { encoding: 'utf8' });
    const found = stdout.trim();
    if (found) return found;
  } catch {
    // not on PATH — fall through to candidates
  }
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(home, '.claude', 'local', 'claude'),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

/** Resolve the full path of the installed `claude` CLI, or null. */
export async function locateClaude(): Promise<string | null> {
  if (cached) return cached.path;
  const found = process.platform === 'win32' ? await findOnWindows() : await findOnMac();
  if (found) cached = { path: found, version: null };
  return found;
}

/**
 * Spawn-shape helper. Node ≥18.17 throws EINVAL when spawning a `.cmd`
 * without a shell — for a `.cmd` we spawn cmd.exe with ['/c', fullPath,
 * ...args]. Injection-safe by construction: no user data ever lands in argv
 * (the prompt travels via stdin), so cmd.exe only ever sees our literals.
 */
function spawnCli(fullPath: string, cliArgs: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcess {
  if (process.platform === 'win32' && fullPath.toLowerCase().endsWith('.cmd')) {
    // Windows-only (.cmd shim from an npm install)
    return spawn('cmd.exe', ['/c', fullPath, ...cliArgs], { ...opts, windowsHide: true });
  }
  // .exe or macOS binary — spawn directly.
  return spawn(fullPath, cliArgs, { ...opts, windowsHide: true });
}

async function probeVersion(fullPath: string): Promise<string> {
  const isCmd = process.platform === 'win32' && fullPath.toLowerCase().endsWith('.cmd');
  const { stdout } = isCmd
    ? await execFileAsync('cmd.exe', ['/c', fullPath, '--version'], { encoding: 'utf8', timeout: 15_000, windowsHide: true })
    : await execFileAsync(fullPath, ['--version'], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  return stdout.trim();
}

/** Locate + `--version` probe. Version caches alongside the path. */
export async function claudeStatus(): Promise<ClaudeStatusData> {
  const cliPath = await locateClaude();
  if (!cliPath) return { available: false, version: null, reason: 'not-found' };
  if (cached?.version) return { available: true, version: cached.version };
  try {
    const version = await probeVersion(cliPath);
    cached = { path: cliPath, version };
    return { available: true, version };
  } catch {
    // Found a binary but it can't even print a version — treat as broken and
    // drop the cache so a reinstall is picked up.
    resetCliCache();
    return { available: false, version: null, reason: 'error' };
  }
}

// ── stream-json parsing (pure — exported for tests) ─────────────────────────

/**
 * Buffered newline splitter: stdout chunks can split a JSON line anywhere,
 * so carry the partial tail across push() calls. flush() emits any trailing
 * unterminated line (CLI output normally ends with \n, but be safe).
 */
export function createLineSplitter(onLine: (line: string) => void): { push(chunk: string): void; flush(): void } {
  let buf = '';
  return {
    push(chunk: string): void {
      buf += chunk;
      let idx = buf.indexOf('\n');
      while (idx !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        onLine(line);
        idx = buf.indexOf('\n');
      }
    },
    flush(): void {
      if (buf.length > 0) {
        const line = buf;
        buf = '';
        onLine(line);
      }
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Short human label for a tool call, derived from its input — a filename for
 * file tools, the command for shells, the pattern for search, etc. Kept compact
 * (the widget renders it in a one-line chip). Exported for tests.
 */
export function toolDetail(name: string, input: unknown): string {
  const inp = asRecord(input) ?? {};
  const basename = (p: unknown): string => (typeof p === 'string' ? p.split(/[\\/]/).pop() ?? p : '');
  let detail = '';
  switch (name) {
    case 'Write':
    case 'Edit':
    case 'Read':
    case 'NotebookEdit':
      detail = basename(inp.file_path ?? inp.notebook_path);
      break;
    case 'Bash':
    case 'PowerShell':
      detail = typeof inp.command === 'string' ? inp.command : '';
      break;
    case 'Glob':
    case 'Grep':
      detail = typeof inp.pattern === 'string' ? inp.pattern : '';
      break;
    case 'WebFetch':
    case 'WebSearch':
      detail = (typeof inp.url === 'string' && inp.url) || (typeof inp.query === 'string' && inp.query) || '';
      break;
    case 'Task':
      detail = typeof inp.description === 'string' ? inp.description : '';
      break;
    default:
      detail = '';
  }
  return detail.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * Map one raw stream-json line from `claude -p --output-format stream-json
 * --include-partial-messages --verbose` to zero or more ClaudeStreamEvents.
 * Most lines map to one event (or none); an `assistant` line can carry several
 * tool calls and a `user` line several tool results, hence the array. Unknown
 * types and unparseable lines return `[]` (forward-compatible: newer CLIs add
 * event types freely). Exported for tests.
 */
export function parseStreamJsonLine(line: string): ClaudeStreamEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const obj = asRecord(raw);
  if (!obj) return [];

  switch (obj.type) {
    case 'system': {
      // {type:'system',subtype:'init',session_id,model,...}
      if (obj.subtype !== 'init') return [];
      return [
        {
          type: 'init',
          sessionId: typeof obj.session_id === 'string' ? obj.session_id : '',
          model: typeof obj.model === 'string' ? obj.model : '',
        },
      ];
    }
    case 'stream_event': {
      // {type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text}}}
      const event = asRecord(obj.event);
      if (!event || event.type !== 'content_block_delta') return [];
      const delta = asRecord(event.delta);
      if (!delta || delta.type !== 'text_delta' || typeof delta.text !== 'string') return [];
      return [{ type: 'delta', text: delta.text }];
    }
    case 'assistant': {
      // {type:'assistant',message:{content:[{type:'text',text},{type:'tool_use',id,name,input}]}}
      // Text is NOT re-emitted here — the delta stream already carried it (and a
      // tool-using turn has several assistant messages, so re-emitting text would
      // duplicate/clobber). We only surface the tool_use blocks.
      const message = asRecord(obj.message);
      if (!message || !Array.isArray(message.content)) return [];
      // Observed on v2.1.201: a not-logged-in CLI reports auth failure as a
      // synthetic assistant message ("Not logged in · Please run /login") with
      // error:'authentication_failed' on the EVENT — not on stderr. Surface
      // the friendly hint instead of the raw CLI text.
      if (obj.error === 'authentication_failed') {
        return [{ type: 'error', message: LOGIN_HINT }];
      }
      const events: ClaudeStreamEvent[] = [];
      for (const block of message.content) {
        const b = asRecord(block);
        if (b && b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
          events.push({ type: 'tool-use', id: b.id, name: b.name, detail: toolDetail(b.name, b.input) });
        }
      }
      return events;
    }
    case 'user': {
      // {type:'user',message:{content:[{type:'tool_result',tool_use_id,is_error,content}]}}
      // The CLI reports tool completion as a synthetic user turn.
      const message = asRecord(obj.message);
      if (!message || !Array.isArray(message.content)) return [];
      const events: ClaudeStreamEvent[] = [];
      for (const block of message.content) {
        const b = asRecord(block);
        if (b && b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
          events.push({ type: 'tool-result', id: b.tool_use_id, isError: b.is_error === true });
        }
      }
      return events;
    }
    case 'result': {
      // {type:'result',subtype,is_error,duration_ms,...}
      return [
        {
          type: 'done',
          isError: obj.is_error === true,
          durationMs: typeof obj.duration_ms === 'number' ? obj.duration_ms : 0,
        },
      ];
    }
    default:
      return [];
  }
}

const LOGIN_HINT = 'Claude Code is not logged in — run `claude /login` in a terminal.';

/**
 * Turn accumulated stderr into a client-facing error message. Auth-shaped
 * failures get the friendly login hint; everything else passes through
 * (truncated) so resume-not-found detection still sees the raw text.
 * Exported for tests.
 */
export function classifyCliError(stderr: string): string {
  const text = stderr.trim();
  if (/log\s*in|logged\s+in|authenticat|oauth/i.test(text)) return LOGIN_HINT;
  return text.slice(0, 500) || 'Claude CLI exited unexpectedly with no output';
}

/** Does this error message mean `--resume <id>` pointed at a session the CLI
 *  doesn't know? (Wiped ~/.claude history, different machine, …) */
export function isSessionNotFoundError(message: string): boolean {
  return /no conversation found|session.{0,40}not found/i.test(message);
}

// ── Chat spawn ───────────────────────────────────────────────────────────────

export interface SpawnClaudeChatOpts {
  message: string;
  sessionId?: string;
  /** Passed straight to `--permission-mode`. 'bypassPermissions' lets the CLI
   *  actually write files / run commands / invoke skills — which a
   *  non-interactive `-p` session otherwise auto-denies (it can't prompt).
   *  Omit or 'default' to keep the safe, read-only-ish posture. */
  permissionMode?: 'default' | 'bypassPermissions';
  onEvent: (event: ClaudeStreamEvent) => void;
  /** Fires exactly once, after the child is fully finished (or failed to start). */
  onExit: () => void;
}

const STDERR_CAP = 16 * 1024;

/**
 * Spawn one CLI chat turn. Events stream through onEvent; the handle's kill()
 * tears the child down (client disconnected / Stop pressed).
 */
export function spawnClaudeChat(opts: SpawnClaudeChatOpts): { kill(): void } {
  let child: ChildProcess | null = null;
  let killed = false;
  let exited = false;
  let sawDone = false;

  const exitOnce = (): void => {
    if (exited) return;
    exited = true;
    opts.onExit();
  };

  const emit = (event: ClaudeStreamEvent): void => {
    if (!exited) opts.onEvent(event);
  };

  void (async () => {
    const cliPath = await locateClaude();
    if (!cliPath) {
      emit({ type: 'error', message: 'Claude Code CLI not found — install it from claude.com/claude-code.' });
      exitOnce();
      return;
    }

    // cwd = ~/.dash so the CLI's per-project session history lands in the same
    // stable home-dir spot the dashboard already uses (survives reinstalls).
    const cwd = path.join(os.homedir(), '.dash');
    await mkdir(cwd, { recursive: true }).catch(() => {});

    if (killed) {
      exitOnce();
      return;
    }

    // NOTE: --verbose is MANDATORY with -p + stream-json — the CLI errors out
    // without it. --include-partial-messages is what yields the delta stream.
    const args = ['-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose'];
    // Opt-in tool execution. Without this, -p mode auto-denies Write/Edit/Bash
    // (it can't show a permission prompt), so file output / commands / skills
    // never actually run — they just report "pending permission approval".
    if (opts.permissionMode && opts.permissionMode !== 'default') {
      args.push('--permission-mode', opts.permissionMode);
    }
    if (opts.sessionId) args.push('--resume', opts.sessionId);

    // LOAD-BEARING: delete ANTHROPIC_API_KEY. If it leaks through, the CLI
    // silently bills API credits instead of the claude.ai Max subscription.
    // CLAUDE_CODE_OAUTH_TOKEN (if configured in Settings) passes through via
    // the spread as the no-interactive-login fallback.
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    child = spawnCli(cliPath, args, { cwd, env });

    let stderr = '';
    const splitter = createLineSplitter((line) => {
      for (const event of parseStreamJsonLine(line)) {
        if (event.type === 'done') sawDone = true;
        emit(event);
      }
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      // Spawn failure (ENOENT after uninstall, EPERM, …) — drop the discovery
      // cache so the next request re-probes a fresh install location.
      resetCliCache();
      emit({ type: 'error', message: `Failed to start Claude CLI: ${err.code ?? err.message}` });
      exitOnce();
    });

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => splitter.push(chunk));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < STDERR_CAP) stderr += chunk;
    });

    child.on('close', (code) => {
      splitter.flush();
      if (!sawDone && !killed) {
        // Non-zero exit (or clean exit with no result) and no result frame —
        // surface stderr as the error.
        const message = code === 0
          ? 'Claude CLI exited without producing a result'
          : classifyCliError(stderr);
        emit({ type: 'error', message });
      }
      exitOnce();
    });

    // Prompt goes via stdin (never argv) then EOF so -p mode starts.
    child.stdin?.on('error', () => {}); // EPIPE if the child dies instantly
    child.stdin?.write(opts.message);
    child.stdin?.end();
  })();

  return {
    kill(): void {
      killed = true;
      if (!child) return;
      if (process.platform === 'win32' && child.pid) {
        // Windows-only: the child may be a cmd.exe wrapper around the real CLI
        // process — child.kill() would only hit the wrapper. Kill the tree.
        void execFileAsync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
          .catch(() => child?.kill());
      } else {
        // macOS-only (and .exe edge): direct child, plain SIGTERM suffices.
        child.kill();
      }
    },
  };
}
