import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJson, fetchText, HttpError, UpstreamError } from './http';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('error classes', () => {
  it('HttpError carries the client-facing status verbatim', () => {
    const err = new HttpError(400, 'zip must be 5 digits');
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('zip must be 5 digits');
    expect(err.name).toBe('HttpError');
    expect(err).toBeInstanceOf(Error);
  });

  it('UpstreamError carries the upstream status', () => {
    const err = new UpstreamError(429, 'CoinGecko 429: throttled');
    expect(err.status).toBe(429);
    expect(err.name).toBe('UpstreamError');
  });
});

describe('fetchJson / fetchText', () => {
  it('parses an OK JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(fetchJson<{ ok: boolean }>('https://x.test')).resolves.toEqual({ ok: true });
  });

  it('throws UpstreamError with the status and a labeled, truncated body on non-OK', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota exceeded '.repeat(40), { status: 403 })));
    const p = fetchJson('https://x.test', undefined, { label: 'YouTube API' });
    await expect(p).rejects.toBeInstanceOf(UpstreamError);
    await p.catch((err: UpstreamError) => {
      expect(err.status).toBe(403);
      expect(err.message).toContain('YouTube API 403');
      expect(err.message.length).toBeLessThan(350); // body sliced to 300 chars
    });
  });

  it('propagates rejections (network failure / abort) unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    await expect(fetchJson('https://x.test')).rejects.toThrow('fetch failed');
  });

  it('fetchText returns the raw body with the same error semantics', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<rss/>', { status: 200 })));
    await expect(fetchText('https://x.test')).resolves.toBe('<rss/>');
  });

  it('passes an abort signal so hung upstreams cannot stall routes', async () => {
    const spy = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', spy);
    await fetchJson('https://x.test');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
