import { cred } from './env';

// Client for the local Inbox service (nishant/inbox, loopback 127.0.0.1:8805).
// It authenticates with its own password login → `inbox_session` cookie, which
// we keep in MEMORY only. Plain global fetch sends no Origin header and a
// loopback Host, which is exactly what the inbox requires. Only `/api/*` is
// ever called — never `/ingest/*`. The password and cookie are never logged.

export const INBOX_API = process.env.INBOX_API_URL || 'http://127.0.0.1:8805/api';

const TIMEOUT_MS = 2000;
const COOKIE_NAME = 'inbox_session';

/** Unreachable service or timeout. */
export class InboxOfflineError extends Error {}
/** cred('INBOX_PASSWORD') is empty. */
export class InboxNoPasswordError extends Error {}
/** The login (or a retried request) answered 401. */
export class InboxBadPasswordError extends Error {}
export class InboxUpstreamError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

let sessionToken: string | null = null;
let loginInFlight: Promise<string> | null = null;
// Password value the inbox rejected: no further login POSTs until it changes
// (saving a new password restarts the server, which also clears this).
let badPassword: string | null = null;

/** Clears the cached cookie + in-flight login. Exported for tests. */
export function resetInboxSession(): void {
  sessionToken = null;
  loginInFlight = null;
  badPassword = null;
}

async function doLogin(password: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${INBOX_API}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new InboxOfflineError('Inbox is not reachable.');
  }
  if (res.status === 401) throw new InboxBadPasswordError('Wrong password.');
  if (res.status === 429) throw new InboxUpstreamError(429, 'Too many Inbox login tries. Wait a minute.');
  if (!res.ok) throw new InboxUpstreamError(res.status >= 500 ? 502 : res.status, `Inbox login ${res.status}`);
  const prefix = `${COOKIE_NAME}=`;
  const entry = res.headers.getSetCookie().find((c) => c.startsWith(prefix));
  const token = entry ? entry.slice(prefix.length).split(';')[0] : '';
  if (!token) throw new InboxUpstreamError(502, 'Inbox login returned no session.');
  return token;
}

/** Single-flight: concurrent callers share one login fetch. */
function login(password: string): Promise<string> {
  if (!loginInFlight) {
    const p = doLogin(password).then(
      (t) => {
        sessionToken = t;
        badPassword = null;
        return t;
      },
      (e: unknown) => {
        if (e instanceof InboxBadPasswordError) badPassword = password;
        throw e;
      },
    );
    const clear = (): void => {
      if (loginInFlight === p) loginInFlight = null;
    };
    p.then(clear, clear);
    loginInFlight = p;
  }
  return loginInFlight;
}

async function send(method: 'GET' | 'POST', path: string, token: string, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { cookie: `${COOKIE_NAME}=${token}`, accept: 'application/json' };
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (method === 'POST') {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  try {
    return await fetch(INBOX_API + path, init);
  } catch {
    throw new InboxOfflineError('Inbox is not reachable.');
  }
}

export async function inboxRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const password = cred('INBOX_PASSWORD');
  if (!password) throw new InboxNoPasswordError('Inbox password is not set.');

  if (badPassword !== null && badPassword === password) {
    throw new InboxBadPasswordError('The Inbox password was not accepted.');
  }

  let token = sessionToken ?? (await login(password));
  let res = await send(method, path, token, body);
  if (res.status === 401) {
    // Cached cookie rejected: log in once more and retry once, no loop.
    if (sessionToken && sessionToken !== token) {
      // Another request already refreshed the cookie: reuse it, no extra login.
      token = sessionToken;
    } else {
      sessionToken = null;
      token = await login(password);
    }
    res = await send(method, path, token, body);
    if (res.status === 401) {
      if (sessionToken === token) sessionToken = null;
      throw new InboxBadPasswordError('The Inbox password was not accepted.');
    }
  }
  if (res.status === 204) return undefined as T;
  if (res.ok) return (await res.json()) as T;
  let message = `Inbox ${res.status}`;
  try {
    const j = (await res.json()) as { error?: unknown };
    if (typeof j.error === 'string' && j.error) message = j.error;
  } catch {
    // non-JSON error body: keep the fallback
  }
  throw new InboxUpstreamError(res.status, message);
}
