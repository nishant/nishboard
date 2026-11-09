import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeChild extends EventEmitter {
  stdout = null;
  stderr = null;
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

vi.mock('child_process', () => ({ spawn: spawnMock, execSync: vi.fn(() => '') }));
vi.mock('electron', () => ({ app: { getAppPath: () => '/app', getPath: () => '/tmp/nishboard-test' } }));
vi.mock('../credentials', () => ({ readCredentials: () => ({}) }));
vi.mock('../tokenKey', () => ({ loadTokenKey: () => Promise.resolve(null) }));
vi.mock('../apiToken', () => ({ apiToken: () => 'test-token' }));

describe('restartServer', () => {
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
