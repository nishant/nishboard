// 127.0.0.1, not localhost: the server binds 127.0.0.1 only, and on Windows
// `localhost` can resolve to ::1 first. Matches the spawn health check.
const DEFAULT_API_BASE = 'http://127.0.0.1:7432';

/** The API origin. Unset (every normal build) it is the local server. The Fold check
 *  (scripts/fold-serve.mjs) builds with VITE_API_BASE=/ so the page asks the origin that
 *  served it, a fixture server, instead of the Electron-started one on 7432.
 *  Exported for tests. */
export function resolveApiBase(override: string | undefined): string {
  return override ? override.replace(/\/+$/, '') : DEFAULT_API_BASE;
}

export const API_BASE = resolveApiBase(import.meta.env.VITE_API_BASE as string | undefined);

export const apiUrl = (path: string): string => `${API_BASE}${path}`;

/** The per-launch bearer token from the main process (preload). The server
 *  answers nothing under /api without it, apart from the embeds and OAuth
 *  callbacks, which are navigations and cannot send a header. */
export function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${window.electron?.apiToken ?? ''}` };
}

/** Embed iframes stay on localhost, NOT 127.0.0.1: the Twitch player's parent=
 *  param is "localhost" (Twitch rejects bare IPs), and iframe navigations
 *  fall back between v4/v6 fine. API fetches use apiClient/apiUrl instead. */
export const embedUrl = (path: string): string => `http://localhost:7432${path}`;

// Prefer the server's { error } message (e.g. "No Spotify device found…") so the
// UI can show the real cause instead of a bare status code.
async function errorMessage(res: Response, path: string): Promise<string> {
  try {
    const data = await res.json() as { error?: string };
    if (data?.error) return data.error;
  } catch {
    // no JSON body
  }
  return `API ${res.status}: ${path}`;
}

export interface RequestOpts {
  /** Caller abort (e.g. TanStack's query signal). */
  signal?: AbortSignal;
  /** Give up after this long. Default 15s: one hung server call must not freeze a polled query. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

async function request<T>(path: string, init: RequestInit, opts: RequestOpts | undefined, allowEmpty: boolean): Promise<T> {
  const signals = [opts?.signal, AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS)].filter(
    (s): s is AbortSignal => s !== undefined,
  );
  const signal = AbortSignal.any(signals);
  try {
    const res = await fetch(apiUrl(path), { ...init, signal });
    if (!res.ok) throw new Error(await errorMessage(res, path));
    if (allowEmpty && res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (e) {
    // A caller abort keeps its own error; only our timer becomes "Timed out".
    if (!opts?.signal?.aborted && signal.aborted) throw new Error(`Timed out: ${path}`);
    throw e;
  }
}

function get<T>(path: string, opts?: RequestOpts): Promise<T> {
  return request<T>(path, { headers: authHeaders() }, opts, false);
}

function post<T>(path: string, body?: unknown, opts?: RequestOpts): Promise<T> {
  return request<T>(
    path,
    {
      method: 'POST',
      headers: body !== undefined ? { ...authHeaders(), 'Content-Type': 'application/json' } : authHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    opts,
    true,
  );
}

export const apiClient = { get, post };
