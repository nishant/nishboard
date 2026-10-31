import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';

// Windows only. One long-lived PowerShell process that runs snippets on request,
// so the sound widget's 5s poll does not spawn (and JIT-compile WASAPI C# in) a
// fresh powershell.exe every time.
//
// Wire protocol (one line each way):
//   stdin : `<id> <base64 utf8 script>\n`
//   stdout: `{"id":<id>,"ok":true,"out":"..."}` or `{"id":<id>,"ok":false,"error":"..."}`
// stdout lines that do not start with `{` are PowerShell noise and are ignored.

const DEFAULT_IDLE_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_READY_TIMEOUT_MS = 30_000;

/** The request loop. A single line on purpose: `-Command -` feeds stdin line by line. */
const LOOP_LINE =
  "[Console]::Out.WriteLine('{\"ready\":true}'); [Console]::Out.Flush(); " +
  'while ($true) { $line = [Console]::In.ReadLine(); if ($null -eq $line) { break }; ' +
  '$sp = $line.IndexOf(" "); $id = [int]$line.Substring(0, $sp); ' +
  'try { $s = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Substring($sp + 1))); ' +
  '$o = (& ([ScriptBlock]::Create($s)) | Out-String); $r = @{ id = $id; ok = $true; out = $o } } ' +
  'catch { $r = @{ id = $id; ok = $false; error = [string]$_ } }; ' +
  '[Console]::Out.WriteLine((ConvertTo-Json -InputObject $r -Compress)); [Console]::Out.Flush() }';

/**
 * Bootstrap written to stdin once at process start. `csharp` (optional) is
 * compiled once with Add-Type; AudioDeviceCmdlets is imported once and the
 * result left in `$HasCmdlets`.
 */
export function buildBootstrap(csharp?: string): string {
  const lines = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    "$ErrorActionPreference = 'Stop'",
  ];
  if (csharp) {
    const b64 = Buffer.from(csharp, 'utf8').toString('base64');
    lines.push(
      `try { Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))) } catch { }`,
    );
  }
  lines.push(
    '$HasCmdlets = $false',
    'try { Import-Module AudioDeviceCmdlets -ErrorAction Stop; $HasCmdlets = $true } catch { }',
    LOOP_LINE,
  );
  return lines.join('\n') + '\n';
}

interface Pending {
  id: number;
  script: string;
  resolve: (out: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  sent: boolean;
}

interface PsHostOptions {
  idleMs?: number;
  timeoutMs?: number;
  spawnFn?: typeof spawn;
  bootstrap?: string;
  readyTimeoutMs?: number;
}

interface HostReply {
  id: number;
  ok: boolean;
  out?: string;
  error?: string;
}

function isHostReply(v: unknown): v is HostReply {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === 'number' && typeof r.ok === 'boolean';
}

export class PsHost {
  private readonly idleMs: number;
  private readonly timeoutMs: number;
  private readonly spawnFn: typeof spawn;
  private readonly bootstrap: string;
  private readonly readyTimeoutMs: number;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  private child: ChildProcessWithoutNullStreams | null = null;
  private queue: Pending[] = [];
  private current: Pending | null = null;
  private nextId = 0;
  private buf = '';
  /** True once the bootstrap has printed its ready line; requests wait for it. */
  private ready = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(opts: PsHostOptions = {}) {
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.spawnFn = opts.spawnFn ?? spawn;
    this.bootstrap = opts.bootstrap ?? buildBootstrap();
    this.readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  }

  /** Run a PowerShell snippet in the long-lived process; resolves with its trimmed stdout text. */
  run(script: string): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('PowerShell host disposed'));
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ id: ++this.nextId, script, resolve, reject, timer: null, sent: false });
      this.pump();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.stopChild();
    this.failAll(new Error('PowerShell host disposed'));
  }

  private clearReadyTimer(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
  }

  private clearIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private pump(): void {
    if (this.current || this.queue.length === 0) return;
    this.clearIdle();
    const next = this.queue.shift();
    if (!next) return;
    try {
      this.ensureChild();
    } catch (err) {
      next.reject(err instanceof Error ? err : new Error(String(err)));
      this.pump();
      return;
    }
    this.current = next;
    this.flush();
  }

  /** Send the in-flight request once the loop is listening. PowerShell buffers the
   *  bootstrap's stdin, so anything written earlier would be swallowed. */
  private flush(): void {
    const cur = this.current;
    const child = this.child;
    if (!cur || !child || !this.ready || cur.sent) return;
    cur.sent = true;
    // The request timer only covers the request itself, not process startup.
    cur.timer = setTimeout(() => {
      if (this.current !== cur) return;
      this.current = null;
      this.stopChild();
      cur.reject(new Error(`PowerShell request timed out after ${this.timeoutMs}ms`));
      this.pump();
    }, this.timeoutMs);
    const payload = Buffer.from(cur.script, 'utf8').toString('base64');
    try {
      child.stdin.write(`${cur.id} ${payload}\n`);
    } catch {
      // The exit handler rejects the request.
    }
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = this.spawnFn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    ) as ChildProcessWithoutNullStreams;
    this.child = child;
    this.buf = '';
    this.ready = false;
    this.clearReadyTimer();
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null;
      if (this.child !== child || this.ready) return;
      this.stopChild();
      this.failAll(new Error(`PowerShell host did not become ready in ${this.readyTimeoutMs}ms`));
    }, this.readyTimeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      if (this.child !== child) return;
      this.onData(chunk.toString());
    });
    // Drain stderr so a chatty process can never block on a full pipe.
    child.stderr?.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => this.onExit(child));
    child.on('exit', () => this.onExit(child));

    try {
      child.stdin.write(this.bootstrap);
    } catch {
      // The exit handler rejects pending requests.
    }
    return child;
  }

  private onData(text: string): void {
    this.buf += text;
    let nl = this.buf.indexOf('\n');
    while (nl !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line.startsWith('{')) this.onLine(line);
      nl = this.buf.indexOf('\n');
    }
  }

  private onLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof parsed === 'object' && parsed !== null && 'ready' in parsed) {
      this.ready = true;
      this.clearReadyTimer();
      this.flush();
      return;
    }
    if (!isHostReply(parsed)) return;
    const cur = this.current;
    if (!cur || cur.id !== parsed.id) return;
    if (cur.timer) clearTimeout(cur.timer);
    this.current = null;
    if (parsed.ok) cur.resolve((parsed.out ?? '').trim());
    else cur.reject(new Error(parsed.error ?? 'PowerShell error'));
    if (this.queue.length > 0) this.pump();
    else this.armIdle();
  }

  private armIdle(): void {
    this.clearIdle();
    if (this.disposed || !this.child) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.current && this.queue.length === 0) this.stopChild();
    }, this.idleMs);
    // Never keep the server alive just for the idle timer.
    this.idleTimer.unref?.();
  }

  private onExit(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return;
    this.child = null;
    this.buf = '';
    this.clearIdle();
    this.failAll(new Error('PowerShell host exited'));
  }

  private stopChild(): void {
    this.clearIdle();
    this.clearReadyTimer();
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.buf = '';
    try {
      child.stdin.end();
    } catch {
      // already closed
    }
    try {
      child.kill();
    } catch {
      // already gone
    }
  }

  private failAll(err: Error): void {
    const cur = this.current;
    this.current = null;
    const waiting = this.queue;
    this.queue = [];
    if (cur) {
      if (cur.timer) clearTimeout(cur.timer);
      cur.reject(err);
    }
    for (const p of waiting) p.reject(err);
  }
}
