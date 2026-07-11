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
import { access, mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import os from 'os';
import path from 'path';
import type {
  ClaudeChatMode,
  ClaudeControlRequestBody,
  ClaudeEffort,
  ClaudeMetaData,
  ClaudePromptRequest,
  ClaudeQuestionItem,
  ClaudeSlashCommand,
  ClaudeStatusData,
  ClaudeStreamEvent,
} from '@dash/shared';

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
      // {type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta'|'thinking_delta',…}}}
      const event = asRecord(obj.event);
      if (!event || event.type !== 'content_block_delta') return [];
      const delta = asRecord(event.delta);
      if (!delta) return [];
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        return [{ type: 'delta', text: delta.text }];
      }
      // Extended thinking streams as thinking_delta (signature_delta is noise).
      if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        return [{ type: 'thinking', text: delta.thinking }];
      }
      return [];
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
      // {type:'result',subtype,is_error,duration_ms,usage:{output_tokens,...},...}
      const usage = asRecord(obj.usage);
      const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
      const contextTokens = usage
        ? num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens)
        : null;
      return [
        {
          type: 'done',
          isError: obj.is_error === true,
          durationMs: typeof obj.duration_ms === 'number' ? obj.duration_ms : 0,
          outputTokens: usage && typeof usage.output_tokens === 'number' ? usage.output_tokens : null,
          contextTokens,
        },
      ];
    }
    default:
      return [];
  }
}

// ── Slash-command / skill metadata ───────────────────────────────────────────
// The CLI's init frame lists every slash command (built-ins + ~/.claude/commands
// + user-invocable skills) and, separately, which of them are skills. Capture it
// on every chat and persist to ~/.dash/claude-meta.json so autocomplete works
// across restarts; before any chat has EVER run, fall back to scanning the
// ~/.claude/commands and ~/.claude/skills dirs directly.

const META_FILE = path.join(os.homedir(), '.dash', 'claude-meta.json');

let metaCache: ClaudeMetaData | null = null;

/** Pure: build ClaudeMetaData from a parsed init-frame object (or null when the
 *  line isn't an init frame). Exported for tests. */
export function extractInitMeta(raw: unknown): ClaudeMetaData | null {
  const obj = asRecord(raw);
  if (!obj || obj.type !== 'system' || obj.subtype !== 'init') return null;
  const names = Array.isArray(obj.slash_commands)
    ? obj.slash_commands.filter((n): n is string => typeof n === 'string')
    : [];
  const skills = new Set(
    Array.isArray(obj.skills) ? obj.skills.filter((n): n is string => typeof n === 'string') : [],
  );
  return {
    slashCommands: names.map((name) => ({ name, isSkill: skills.has(name) })),
    model: typeof obj.model === 'string' ? obj.model : null,
  };
}

function captureInitMeta(raw: unknown): void {
  const meta = extractInitMeta(raw);
  if (!meta || meta.slashCommands.length === 0) return;
  metaCache = meta;
  // Fire-and-forget persist — losing it only degrades cold-start autocomplete.
  void writeFile(META_FILE, JSON.stringify(meta)).catch(() => {});
}

/** Cold-start fallback: names from ~/.claude/commands/*.md and skill dirs
 *  containing SKILL.md under ~/.claude/skills. Best-effort, never throws. */
async function scanClaudeDirs(): Promise<ClaudeSlashCommand[]> {
  const home = os.homedir();
  const out: ClaudeSlashCommand[] = [];
  try {
    const files = await readdir(path.join(home, '.claude', 'commands'));
    for (const f of files) {
      if (f.endsWith('.md')) out.push({ name: f.slice(0, -3), isSkill: false });
    }
  } catch { /* no commands dir */ }
  try {
    const entries = await readdir(path.join(home, '.claude', 'skills'), { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) out.push({ name: e.name, isSkill: true });
    }
  } catch { /* no skills dir */ }
  return out;
}

/** Slash-command metadata: memory → persisted file → dir scan. */
export async function getClaudeMeta(): Promise<ClaudeMetaData> {
  if (metaCache) return metaCache;
  try {
    const parsed = JSON.parse(await readFile(META_FILE, 'utf8')) as ClaudeMetaData;
    if (Array.isArray(parsed.slashCommands) && parsed.slashCommands.length > 0) {
      metaCache = parsed;
      return parsed;
    }
  } catch { /* no/corrupt file — fall through */ }
  return { slashCommands: await scanClaudeDirs(), model: null };
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
  /** ask → default permission mode + stdio prompt tool (writes/commands raise
   *  permission-request events; reads in ASK_MODE_ALLOWED_TOOLS run freely);
   *  auto → bypassPermissions (tools run autonomously); plan → CLI plan mode
   *  (+ stdio prompt tool so ExitPlanMode approval surfaces). */
  mode?: ClaudeChatMode;
  /** `--model` value (alias or full id). Omit for the CLI default. */
  model?: string;
  /** `--effort` level. Omit for the CLI default. */
  effort?: ClaudeEffort;
  /** CLI cwd (already validated/expanded by the route). Default ~/.dash. */
  workspaceDir?: string;
  /** `--add-dir` targets (already validated/expanded by the route). */
  additionalDirs?: string[];
  onEvent: (event: ClaudeStreamEvent) => void;
  /** Fires exactly once, after the child is fully finished (or failed to start). */
  onExit: () => void;
}

/** Read-shaped tools that never prompt in ask mode — approving every Read
 *  would make the mode unusable. Deliberately excludes Bash/Task/Write/Edit. */
export const ASK_MODE_ALLOWED_TOOLS = 'Read Glob Grep WebFetch WebSearch';

/** Pure: CLI argv for one chat turn (prompt travels via stdin, never argv).
 *  NOTES: --verbose is MANDATORY with -p + stream-json output (the CLI errors
 *  out without it); --include-partial-messages yields the delta stream;
 *  --input-format stream-json keeps stdin open as a control channel
 *  (permission prompts + AskUserQuestion answers flow back through it);
 *  --permission-prompt-tool stdio is what turns permission checks into
 *  control_request lines instead of silent auto-denies (verified on 2.1.207).
 *  Exported for tests. */
export function buildChatArgs(
  opts: Pick<SpawnClaudeChatOpts, 'sessionId' | 'mode' | 'model' | 'effort' | 'additionalDirs'>,
): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
  ];
  const mode = opts.mode ?? 'ask';
  if (mode === 'auto') {
    args.push('--permission-mode', 'bypassPermissions');
  } else if (mode === 'plan') {
    args.push('--permission-mode', 'plan', '--permission-prompt-tool', 'stdio');
  } else {
    // ask: default permission mode, prompts routed to stdio, reads pre-allowed.
    args.push('--permission-prompt-tool', 'stdio', '--allowedTools', ASK_MODE_ALLOWED_TOOLS);
  }
  if (opts.model) args.push('--model', opts.model);
  if (opts.effort) args.push('--effort', opts.effort);
  for (const dir of opts.additionalDirs ?? []) args.push('--add-dir', dir);
  if (opts.sessionId) args.push('--resume', opts.sessionId);
  return args;
}

// ── Control protocol (wire shapes pinned against CLI 2.1.207) ────────────────
// Captured live: a permission check arrives as
//   {"type":"control_request","request_id":"<uuid>","request":{"subtype":"can_use_tool",
//    "tool_name":"Write","input":{...},"description":"probe2.txt",
//    "permission_suggestions":[...],"tool_use_id":"toolu_..."}}
// and is answered by writing ONE line to the child's stdin:
//   {"type":"control_response","response":{"subtype":"success","request_id":"<uuid>",
//    "response":{"behavior":"allow","updatedInput":{...}}}}        (or behavior:"deny","message":...)
// AskUserQuestion answers ride updatedInput as {...input, answers:{"<question>":"<label>"}}.

/** Pure: the stream-json stdin line carrying the user's message. */
export function buildUserMessageLine(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n';
}

export interface CliControlRequest {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  /** CLI-provided human summary (e.g. the filename) — may be absent. */
  description: string | null;
}

/** Pure: parse a can_use_tool control_request line (already JSON.parsed).
 *  Returns null for anything else — unknown control frames degrade to the
 *  CLI-side timeout rather than crashing the stream. Exported for tests. */
export function extractControlRequest(raw: unknown): CliControlRequest | null {
  const obj = asRecord(raw);
  if (!obj || obj.type !== 'control_request' || typeof obj.request_id !== 'string') return null;
  const request = asRecord(obj.request);
  if (!request || request.subtype !== 'can_use_tool' || typeof request.tool_name !== 'string') return null;
  return {
    requestId: obj.request_id,
    toolName: request.tool_name,
    input: asRecord(request.input) ?? {},
    description: typeof request.description === 'string' ? request.description : null,
  };
}

/** Pure: requestId of a control_cancel_request line, else null. */
export function extractControlCancel(raw: unknown): string | null {
  const obj = asRecord(raw);
  if (!obj || obj.type !== 'control_cancel_request') return null;
  return typeof obj.request_id === 'string' ? obj.request_id : null;
}

/** Pure: shape a control request into what the widget's prompt card renders. */
export function buildPromptRequest(toolName: string, input: Record<string, unknown>, description: string | null): ClaudePromptRequest {
  if (toolName === 'AskUserQuestion' && Array.isArray(input.questions)) {
    const questions: ClaudeQuestionItem[] = [];
    for (const q of input.questions) {
      const qr = asRecord(q);
      if (!qr || typeof qr.question !== 'string') continue;
      const options = Array.isArray(qr.options)
        ? qr.options.flatMap((o) => {
            const or = asRecord(o);
            return or && typeof or.label === 'string'
              ? [{ label: or.label, description: typeof or.description === 'string' ? or.description : null }]
              : [];
          })
        : [];
      questions.push({
        question: qr.question,
        header: typeof qr.header === 'string' ? qr.header : null,
        multiSelect: qr.multiSelect === true,
        options,
      });
    }
    if (questions.length > 0) return { kind: 'question', questions };
    // Malformed questions payload — fall through to a generic tool card.
  }
  if (toolName === 'ExitPlanMode' && typeof input.plan === 'string') {
    return { kind: 'plan', plan: input.plan };
  }
  return { kind: 'tool', toolName, detail: description ?? toolDetail(toolName, input) };
}

/** Pure: the stdin line answering a control request. For AskUserQuestion,
 *  `answers` (per-question selected labels, in question order) are keyed by
 *  question text — multi-select labels join with ", " (matches how the
 *  interactive CLI reports multi answers). Exported for tests. */
export function buildControlResponseLine(
  requestId: string,
  pending: { toolName: string; input: Record<string, unknown> },
  resp: ClaudeControlRequestBody['response'],
): string {
  let inner: Record<string, unknown>;
  if (resp.behavior === 'deny') {
    inner = { behavior: 'deny', message: resp.message ?? 'The user denied this action in the dashboard.' };
  } else {
    let updatedInput: Record<string, unknown> = pending.input;
    if ('answers' in resp && pending.toolName === 'AskUserQuestion' && Array.isArray(pending.input.questions)) {
      const answers: Record<string, string> = {};
      pending.input.questions.forEach((q, i) => {
        const qr = asRecord(q);
        const chosen = resp.answers[i];
        if (qr && typeof qr.question === 'string' && Array.isArray(chosen) && chosen.length > 0) {
          answers[qr.question] = chosen.join(', ');
        }
      });
      updatedInput = { ...pending.input, answers };
    }
    inner = { behavior: 'allow', updatedInput };
  }
  return JSON.stringify({
    type: 'control_response',
    response: { subtype: 'success', request_id: requestId, response: inner },
  }) + '\n';
}

const STDERR_CAP = 16 * 1024;

/** How long a permission prompt may sit unanswered before the server denies it
 *  on the user's behalf (the CLI would otherwise wait forever). */
export const PROMPT_TIMEOUT_MS = 5 * 60_000;

/** After the result frame we end stdin and expect a prompt exit; if the child
 *  lingers (e.g. a straggling subprocess), kill it. */
const EXIT_GRACE_MS = 5_000;

export interface ClaudeChatHandle {
  kill(): void;
  /** Answer a pending permission/question/plan prompt. False = unknown or
   *  already-resolved requestId. */
  respondControl(requestId: string, response: ClaudeControlRequestBody['response']): boolean;
}

/**
 * Spawn one CLI chat turn. Events stream through onEvent; the handle's kill()
 * tears the child down (client disconnected / Stop pressed).
 */
export function spawnClaudeChat(opts: SpawnClaudeChatOpts): ClaudeChatHandle {
  let child: ChildProcess | null = null;
  let killed = false;
  let exited = false;
  let sawDone = false;
  let graceTimer: NodeJS.Timeout | null = null;

  // Prompts the CLI is waiting on. Never log `input` — it can carry file
  // contents / commands (same secrecy rule as the rest of this module).
  const pending = new Map<string, { toolName: string; input: Record<string, unknown>; timer: NodeJS.Timeout }>();

  const clearPending = (): void => {
    for (const p of pending.values()) clearTimeout(p.timer);
    pending.clear();
  };

  const killChild = (): void => {
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
  };

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

    // Default cwd = ~/.dash so the CLI's per-project session history lands in
    // the same stable home-dir spot the dashboard already uses; the user can
    // point it elsewhere via Settings → Claude → Workspace.
    const cwd = opts.workspaceDir ?? path.join(os.homedir(), '.dash');
    await mkdir(cwd, { recursive: true }).catch(() => {});

    if (killed) {
      exitOnce();
      return;
    }

    const args = buildChatArgs(opts);

    // LOAD-BEARING: delete ANTHROPIC_API_KEY. If it leaks through, the CLI
    // silently bills API credits instead of the claude.ai Max subscription.
    // CLAUDE_CODE_OAUTH_TOKEN (if configured in Settings) passes through via
    // the spread as the no-interactive-login fallback.
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    // Lets the model ask multiple-choice questions (rendered as prompt cards).
    env.CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL = '1';

    child = spawnCli(cliPath, args, { cwd, env });

    const writeLine = (line: string): void => {
      // EPIPE after child death is swallowed by the stdin 'error' handler.
      child?.stdin?.write(line);
    };

    let stderr = '';
    const splitter = createLineSplitter((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('{')) {
        let raw: unknown = null;
        try {
          raw = JSON.parse(trimmed);
        } catch { /* not JSON — parseStreamJsonLine skips it too */ }
        // Init frames carry the slash-command/skill list — snapshot it for
        // /api/claude/meta (autocomplete) before the client-event mapping,
        // which deliberately drops those fields.
        captureInitMeta(raw);
        // Control channel: permission checks / question prompts / plan approval.
        const control = extractControlRequest(raw);
        if (control) {
          const timer = setTimeout(() => {
            if (!pending.delete(control.requestId)) return;
            writeLine(buildControlResponseLine(control.requestId, control, {
              behavior: 'deny',
              message: 'Timed out waiting for approval in the dashboard.',
            }));
            emit({ type: 'permission-resolved', requestId: control.requestId, behavior: 'deny', reason: 'timeout' });
          }, PROMPT_TIMEOUT_MS);
          pending.set(control.requestId, { toolName: control.toolName, input: control.input, timer });
          emit({
            type: 'permission-request',
            requestId: control.requestId,
            request: buildPromptRequest(control.toolName, control.input, control.description),
          });
          return;
        }
        const cancelled = extractControlCancel(raw);
        if (cancelled) {
          const entry = pending.get(cancelled);
          if (entry) {
            clearTimeout(entry.timer);
            pending.delete(cancelled);
            emit({ type: 'permission-resolved', requestId: cancelled, behavior: 'deny', reason: 'cancelled' });
          }
          return;
        }
      }
      for (const event of parseStreamJsonLine(line)) {
        if (event.type === 'done') {
          sawDone = true;
          // stdin is the control channel, held open all turn — closing it after
          // the result frame is what lets the CLI exit (verified on 2.1.207).
          child?.stdin?.end();
          graceTimer = setTimeout(killChild, EXIT_GRACE_MS);
          // With stream-json INPUT, `--resume <unknown id>` doesn't emit an
          // error frame — it prints "No conversation found…" on stderr and
          // ends with an is_error result. Convert that to an error event so
          // the route's retry-without-resume kicks in (wiped ~/.claude
          // history, different machine, bogus persisted id).
          if (event.isError && isSessionNotFoundError(stderr)) {
            emit({ type: 'error', message: classifyCliError(stderr) });
            continue;
          }
        }
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
      clearPending();
      if (graceTimer) clearTimeout(graceTimer);
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

    // The message goes via stdin (never argv) as a stream-json line. stdin
    // stays OPEN — it doubles as the control channel for prompt responses;
    // the done-frame handler above closes it once the turn finishes.
    child.stdin?.on('error', () => {}); // EPIPE if the child dies instantly
    child.stdin?.write(buildUserMessageLine(opts.message));
  })();

  return {
    respondControl(requestId, response): boolean {
      const entry = pending.get(requestId);
      if (!entry) return false;
      clearTimeout(entry.timer);
      pending.delete(requestId);
      child?.stdin?.write(buildControlResponseLine(requestId, entry, response));
      emit({
        type: 'permission-resolved',
        requestId,
        behavior: response.behavior,
        reason: 'user',
      });
      return true;
    },
    kill(): void {
      killed = true;
      clearPending();
      if (graceTimer) clearTimeout(graceTimer);
      killChild();
    },
  };
}
