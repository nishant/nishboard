import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxBadPasswordError, inboxRequest, resetInboxSession } from './inboxClient';
import { jsonRes } from '../test/fetchStub';

function loginRes(token: string): Response {
  return new Response(null, { status: 204, headers: { 'set-cookie': `inbox_session=${token}; Path=/` } });
}

beforeEach(() => {
  process.env.INBOX_PASSWORD = 'pw1';
  resetInboxSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.INBOX_PASSWORD;
});

describe('inboxRequest re-login', () => {
  it('does exactly one re-login when two requests both get 401 on a cached cookie', async () => {
    let logins = 0;
    const fn = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/login')) {
        logins += 1;
        return loginRes(logins === 1 ? 'old' : 'new');
      }
      const cookie = (init?.headers as Record<string, string>).cookie;
      return cookie.endsWith('=new') ? jsonRes({ ok: true }) : jsonRes({ error: 'no' }, 401);
    });
    vi.stubGlobal('fetch', fn);
    await inboxRequest('GET', '/items'); // caches 'old', which the inbox now rejects
    // Make the cached cookie stale: the stub only accepts 'new' from here on.
    fn.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/login')) {
        logins += 1;
        return loginRes('new');
      }
      const cookie = (init?.headers as Record<string, string>).cookie;
      return cookie.endsWith('=new') ? jsonRes({ ok: true }) : jsonRes({ error: 'no' }, 401);
    });
    const [a, b] = await Promise.all([inboxRequest('GET', '/items'), inboxRequest('GET', '/items')]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(logins).toBe(2);
  });

  it('remembers a rejected password and stops posting logins until it changes', async () => {
    const fn = vi.fn(async () => jsonRes({ error: 'Wrong password.' }, 401));
    vi.stubGlobal('fetch', fn);
    await expect(inboxRequest('GET', '/items')).rejects.toBeInstanceOf(InboxBadPasswordError);
    await expect(inboxRequest('GET', '/items')).rejects.toBeInstanceOf(InboxBadPasswordError);
    expect(fn).toHaveBeenCalledTimes(1);

    process.env.INBOX_PASSWORD = 'pw2';
    await expect(inboxRequest('GET', '/items')).rejects.toBeInstanceOf(InboxBadPasswordError);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
