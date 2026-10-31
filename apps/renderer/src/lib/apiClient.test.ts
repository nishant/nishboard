import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '@dash/shared';
import { apiClient } from './apiClient';
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
