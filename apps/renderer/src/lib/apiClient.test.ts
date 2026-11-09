import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '@dash/shared';
import { apiClient, resolveApiBase } from './apiClient';
import { getEventStream, postEventStream } from './streamClient';

function stubFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function sentHeaders(fn: ReturnType<typeof vi.fn>, call = 0): Headers {
  const init: RequestInit | undefined = fn.mock.calls[call][1];
  return new Headers(init?.headers);
}

describe('apiClient bearer token', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.electron = undefined;
  });

  it('sends the preload token on GET, POST with and without a body, and both streams', async () => {
    window.electron = { apiToken: 'tok-123' } as Partial<ElectronAPI> as ElectronAPI;
    const fn = stubFetch();
    await apiClient.get('/api/weather');
    await apiClient.post('/api/spotify/pause');
    await apiClient.post('/api/claude/control', { id: 'x' });
    const signal = new AbortController().signal;
    await postEventStream('/api/claude/chat', { prompt: 'hi' }, { signal, onEvent: () => undefined }).catch(() => undefined);
    await getEventStream('/api/discord/stream', { signal, onEvent: () => undefined }).catch(() => undefined);
    expect(fn).toHaveBeenCalledTimes(5);
    for (let i = 0; i < 5; i++) expect(sentHeaders(fn, i).get('authorization'), String(i)).toBe('Bearer tok-123');
    expect(sentHeaders(fn, 2).get('content-type')).toBe('application/json');
  });

  it('outside Electron sends an empty token, which the server refuses', async () => {
    const fn = stubFetch();
    await apiClient.get('/api/weather');
    expect(sentHeaders(fn).get('authorization')).toBe('Bearer');
  });
});

/** A fetch that never answers; rejects with the signal's reason when aborted. */
function stubHangingFetch(): void {
  vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  })));
}

describe('apiClient timeout and abort', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AbortSignal.timeout runs on a native timer that fake timers cannot advance,
  // so these use a real, short timeoutMs.
  it('gives up on a hung GET with "Timed out: <path>"', async () => {
    stubHangingFetch();
    await expect(apiClient.get('/api/hardware', { timeoutMs: 20 })).rejects.toThrow('Timed out: /api/hardware');
  });

  it('honours a per-call timeoutMs on POST', async () => {
    stubHangingFetch();
    await expect(apiClient.post('/api/discord/connect', undefined, { timeoutMs: 20 })).rejects.toThrow(
      'Timed out: /api/discord/connect',
    );
  });

  it('a caller abort rejects with the abort, not a timeout', async () => {
    stubHangingFetch();
    const ctl = new AbortController();
    const p = apiClient.get('/api/weather', { signal: ctl.signal });
    ctl.abort();
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeDefined();
    expect(String((err as Error).message)).not.toContain('Timed out');
  });
});

describe('resolveApiBase', () => {
  it('is the local server unless overridden', () => {
    expect(resolveApiBase(undefined)).toBe('http://127.0.0.1:7432');
    expect(resolveApiBase('')).toBe('http://127.0.0.1:7432');
  });

  it('takes the Fold check override, where "/" means the origin that served the page', () => {
    expect(resolveApiBase('/')).toBe('');
    expect(resolveApiBase('http://127.0.0.1:5301/')).toBe('http://127.0.0.1:5301');
  });
});
