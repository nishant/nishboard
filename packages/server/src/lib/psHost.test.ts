import { EventEmitter } from 'events';
import type { spawn } from 'child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PsHost, buildBootstrap } from './psHost';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  written: string[] = [];
  killed = false;
  autoReady = true;
  stdin = Object.assign(new EventEmitter(), {
    write: (s: string) => {
      this.written.push(s);
      // Like the real bootstrap: announce readiness once the loop is listening.
      if (this.written.length === 1 && this.autoReady) this.stdout.emit('data', Buffer.from('{"ready":true}\n'));
      return true;
    },
    end: () => undefined,
  });
  kill(): boolean {
    this.killed = true;
    this.emit('exit', null);
    return true;
  }
  /** Request lines written after the bootstrap. */
  requests(): { id: number; script: string }[] {
    return this.written.slice(1).map((l) => {
      const sp = l.indexOf(' ');
      return { id: Number(l.slice(0, sp)), script: Buffer.from(l.slice(sp + 1).trim(), 'base64').toString('utf8') };
    });
  }
  reply(obj: object): void {
    this.stdout.emit('data', Buffer.from(JSON.stringify(obj) + '\n'));
  }
}

function setup(opts: { idleMs?: number; timeoutMs?: number; readyTimeoutMs?: number; autoReady?: boolean } = {}) {
  const children: FakeChild[] = [];
  const spawnFn = vi.fn(() => {
    const c = new FakeChild();
    c.autoReady = opts.autoReady ?? true;
    children.push(c);
    return c;
  }) as unknown as typeof spawn;
  const host = new PsHost({ ...opts, spawnFn, bootstrap: 'BOOT\n' });
  return { host, children, spawnFn };
}

describe('PsHost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts lazily, writes the bootstrap once, and matches replies by id', async () => {
    const { host, children, spawnFn } = setup();
    expect(spawnFn).not.toHaveBeenCalled();
    const p = host.run('Get-Thing');
    expect(children).toHaveLength(1);
    expect(children[0].written[0]).toBe('BOOT\n');
    const [req] = children[0].requests();
    expect(req.script).toBe('Get-Thing');
    children[0].reply({ id: req.id, ok: true, out: '  hello \r\n' });
    await expect(p).resolves.toBe('hello');
    const p2 = host.run('Again');
    expect(children).toHaveLength(1);
    children[0].reply({ id: children[0].requests()[1].id, ok: true, out: 'two' });
    await expect(p2).resolves.toBe('two');
    host.dispose();
  });

  it('holds the request until the bootstrap reports ready', async () => {
    const { host, children } = setup({ autoReady: false });
    const p = host.run('A');
    expect(children[0].requests()).toHaveLength(0);
    children[0].stdout.emit('data', Buffer.from('{"ready":true}\n'));
    const [req] = children[0].requests();
    expect(req.script).toBe('A');
    children[0].reply({ id: req.id, ok: true, out: 'a' });
    await expect(p).resolves.toBe('a');
    host.dispose();
  });

  it('does not cut off a slow bootstrap with the request timeout', async () => {
    const { host, children } = setup({ autoReady: false, timeoutMs: 1000, readyTimeoutMs: 5000 });
    const p = host.run('A');
    await vi.advanceTimersByTimeAsync(3000);
    expect(children[0].killed).toBe(false);
    children[0].stdout.emit('data', Buffer.from('{"ready":true}\n'));
    const [req] = children[0].requests();
    children[0].reply({ id: req.id, ok: true, out: 'late' });
    await expect(p).resolves.toBe('late');
    host.dispose();
  });

  it('kills the child and fails the queue when ready never arrives', async () => {
    const { host, children } = setup({ autoReady: false, timeoutMs: 1000, readyTimeoutMs: 5000 });
    const a = host.run('A');
    const b = host.run('B');
    const aAssert = expect(a).rejects.toThrow('did not become ready');
    const bAssert = expect(b).rejects.toThrow('did not become ready');
    await vi.advanceTimersByTimeAsync(5000);
    await aAssert;
    await bAssert;
    expect(children[0].killed).toBe(true);
    expect(children[0].requests()).toHaveLength(0);
    host.dispose();
  });

  it('rejects with the PowerShell error when ok is false', async () => {
    const { host, children } = setup();
    const p = host.run('boom');
    children[0].reply({ id: children[0].requests()[0].id, ok: false, error: 'bad thing' });
    await expect(p).rejects.toThrow('bad thing');
    host.dispose();
  });

  it('serialises requests: one in flight at a time', async () => {
    const { host, children } = setup();
    const a = host.run('A');
    const b = host.run('B');
    expect(children[0].requests().map((r) => r.script)).toEqual(['A']);
    children[0].reply({ id: children[0].requests()[0].id, ok: true, out: 'a' });
    await expect(a).resolves.toBe('a');
    expect(children[0].requests().map((r) => r.script)).toEqual(['A', 'B']);
    children[0].reply({ id: children[0].requests()[1].id, ok: true, out: 'b' });
    await expect(b).resolves.toBe('b');
    host.dispose();
  });

  it('times out, kills the process, and the next request starts a fresh one', async () => {
    const { host, children } = setup({ timeoutMs: 1000 });
    const p = host.run('slow');
    const assertion = expect(p).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(children[0].killed).toBe(true);

    const p2 = host.run('next');
    expect(children).toHaveLength(2);
    children[1].reply({ id: children[1].requests()[0].id, ok: true, out: 'ok' });
    await expect(p2).resolves.toBe('ok');
    host.dispose();
  });

  it('a crash rejects in-flight and queued requests, then restarts on the next run', async () => {
    const { host, children } = setup();
    const a = host.run('A');
    const b = host.run('B');
    const aAssert = expect(a).rejects.toThrow('PowerShell host exited');
    const bAssert = expect(b).rejects.toThrow('PowerShell host exited');
    children[0].emit('exit', 1);
    await aAssert;
    await bAssert;

    const c = host.run('C');
    expect(children).toHaveLength(2);
    children[1].reply({ id: children[1].requests()[0].id, ok: true, out: 'c' });
    await expect(c).resolves.toBe('c');
    host.dispose();
  });

  it('stops the process after the idle period and restarts on demand', async () => {
    const { host, children } = setup({ idleMs: 60_000 });
    const p = host.run('A');
    children[0].reply({ id: children[0].requests()[0].id, ok: true, out: 'a' });
    await p;
    await vi.advanceTimersByTimeAsync(59_999);
    expect(children[0].killed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(children[0].killed).toBe(true);

    const p2 = host.run('B');
    expect(children).toHaveLength(2);
    children[1].reply({ id: children[1].requests()[0].id, ok: true, out: 'b' });
    await expect(p2).resolves.toBe('b');
    host.dispose();
  });

  it('ignores stdout noise and partial lines', async () => {
    const { host, children } = setup();
    const p = host.run('A');
    const id = children[0].requests()[0].id;
    children[0].stdout.emit('data', Buffer.from('PS C:\\> some noise\r\nWARNING: x\n'));
    children[0].stdout.emit('data', Buffer.from('{not json}\n'));
    children[0].stdout.emit('data', Buffer.from(`{"id":${id},"ok":tr`));
    children[0].stdout.emit('data', Buffer.from('ue,"out":"fine"}\n'));
    await expect(p).resolves.toBe('fine');
    host.dispose();
  });

  it('dispose kills the process and rejects pending and future requests', async () => {
    const { host, children } = setup();
    const p = host.run('A');
    const assertion = expect(p).rejects.toThrow('disposed');
    host.dispose();
    await assertion;
    expect(children[0].killed).toBe(true);
    await expect(host.run('B')).rejects.toThrow('disposed');
  });
});

describe('buildBootstrap', () => {
  it('embeds the C# as base64 and ends with the request loop on a single line', () => {
    const b = buildBootstrap('public class X {}');
    expect(b).toContain(Buffer.from('public class X {}', 'utf8').toString('base64'));
    expect(b).toContain('Import-Module AudioDeviceCmdlets');
    const lines = b.trimEnd().split('\n');
    expect(lines[lines.length - 1]).toContain('while ($true)');
    expect(lines[lines.length - 1]).toContain('ready');
  });
});
