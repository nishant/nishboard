import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = await vi.hoisted(async () => {
  const fsMod = await import('fs');
  const osMod = await import('os');
  const pathMod = await import('path');
  return fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'nishboard-test-'));
});

class FakePipe extends EventEmitter {
  pipe = vi.fn();
}

class FakeChild extends EventEmitter {
  stdout = new FakePipe();
  stderr = new FakePipe();
  exitCode: number | null = null;
  signalCode: string | null = null;
  kill = vi.fn((signal?: string) => {
    // Exit asynchronously, like a real process.
    setTimeout(() => {
      this.signalCode = signal ?? 'SIGTERM';
      this.emit('exit', null, this.signalCode);
    }, 0);
    return true;
  });
}

const children: FakeChild[] = [];
const spawnMock = vi.fn(() => {
  const c = new FakeChild();
  children.push(c);
  return c;
});

vi.mock('child_process', () => ({ spawn: spawnMock, execSync: vi.fn(() => ''), execFileSync: vi.fn(() => '') }));
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/app', getPath: () => tmpDir, getAppMetrics: () => [] } }));
vi.mock('../credentials', () => ({ readCredentials: () => ({}) }));
vi.mock('../tokenKey', () => ({ loadTokenKey: () => Promise.resolve(null) }));
vi.mock('../apiToken', () => ({ apiToken: () => 'test-token' }));

describe('restartServer', () => {
  afterEach(() => {
    fs.rmSync(path.join(tmpDir, 'logs'), { recursive: true, force: true });
  });

  beforeEach(() => {
    children.length = 0;
    spawnMock.mockClear();
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })));
  });

  it('leaves exactly one tracked child and schedules no respawn', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { spawnServer, restartServer, stopServer } = await import('./spawn');
      await spawnServer();
      expect(spawnMock).toHaveBeenCalledTimes(1);

      await restartServer();
      expect(spawnMock).toHaveBeenCalledTimes(2);

      // Well past the 1s crash-restart backoff: no phantom respawn.
      await vi.advanceTimersByTimeAsync(20_000);
      expect(spawnMock).toHaveBeenCalledTimes(2);

      // The new child is still tracked, so stopping kills it.
      const second = children[1];
      await stopServer();
      expect(second.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('per-child server log', () => {
  afterEach(() => {
    fs.rmSync(path.join(tmpDir, 'logs'), { recursive: true, force: true });
  });

  beforeEach(() => {
    children.length = 0;
    spawnMock.mockClear();
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })));
  });

  it('a late exit of an old child does not end the new child log stream', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { spawnServer, restartServer, stopServer } = await import('./spawn');
      await spawnServer();
      await restartServer();
      expect(children).toHaveLength(2);

      children[1].stdout.emit('data', 'before-late-exit\n');
      children[0].emit('exit', null, 'SIGTERM'); // late duplicate exit of the old child
      children[1].stdout.emit('data', 'after-late-exit\n');
      await stopServer();
      await vi.advanceTimersByTimeAsync(200);

      const log = fs.readFileSync(path.join(tmpDir, 'logs', 'server.log'), 'utf8');
      expect(log).toContain('before-late-exit');
      expect(log).toContain('after-late-exit');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('crash restart backoff', () => {
  afterEach(() => {
    fs.rmSync(path.join(tmpDir, 'logs'), { recursive: true, force: true });
  });

  beforeEach(() => {
    children.length = 0;
    spawnMock.mockClear();
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })));
  });

  it('respawns after 1s, 2s, 4s, 8s, 16s, then gives up', async () => {
    // No shouldAdvanceTime: real elapsed ms would leak into the fake clock and fire
    // a backoff timer during advanceTimersByTimeAsync(delay - 1) on a slow runner.
    vi.useFakeTimers();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { spawnServer } = await import('./spawn');
      await spawnServer();
      expect(spawnMock).toHaveBeenCalledTimes(1);

      let expected = 1;
      for (const delay of [1000, 2000, 4000, 8000, 16000]) {
        children[expected - 1].emit('exit', 1, null); // crash
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(spawnMock).toHaveBeenCalledTimes(expected); // not yet
        await vi.advanceTimersByTimeAsync(1);
        expected += 1;
        expect(spawnMock).toHaveBeenCalledTimes(expected);
      }

      // Sixth crash: the attempt budget is spent, so no further respawn.
      children[expected - 1].emit('exit', 1, null);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(spawnMock).toHaveBeenCalledTimes(expected);
    } finally {
      err.mockRestore();
      vi.useRealTimers();
    }
  });
});
