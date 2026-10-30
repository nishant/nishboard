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
  it('reuses a cookie refreshed by another request instead of logging in again', async () => {
    let logins = 0;
    const cookieOf = (init?: RequestInit): string => (init?.headers as Record<string, string>).cookie;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (String(input).endsWith('/login')) {
          logins += 1;
          return loginRes('old');
        }
        return jsonRes({ ok: true });
      }),
    );
    await inboxRequest('GET', '/items'); // caches 'old'; logins === 1

    // From here the inbox rejects 'old'. B's first send stalls until released.
    let releaseB: (r: Response) => void = () => undefined;
    const bGate = new Promise<Response>((resolve) => {
      releaseB = resolve;
    });
    let oldSends = 0;
    const fn = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      if (String(input).endsWith('/login')) {
        logins += 1;
        return loginRes('new');
      }
      if (cookieOf(init).endsWith('=new')) return jsonRes({ ok: true });
      oldSends += 1;
      return oldSends === 1 ? bGate : jsonRes({ error: 'no' }, 401);
    });
    vi.stubGlobal('fetch', fn);

    const b = inboxRequest('GET', '/items');
    await vi.waitFor(() => expect(oldSends).toBe(1)); // B is parked on its first send
    // A runs to completion: 401, re-login ('new'), retry OK.
    expect(await inboxRequest('GET', '/items')).toEqual({ ok: true });
    expect(logins).toBe(2);

    // B's 401 arrives only now, after A's re-login finished.
    releaseB(jsonRes({ error: 'no' }, 401));
    expect(await b).toEqual({ ok: true });
    expect(logins).toBe(2); // B reused 'new' rather than logging in a third time
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
