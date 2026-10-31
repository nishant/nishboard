// 127.0.0.1, not localhost: the server binds 127.0.0.1 only, and on Windows
// `localhost` can resolve to ::1 first. Matches the spawn health check.
export const API_BASE = 'http://127.0.0.1:7432';

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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { headers: authHeaders() });
  if (!res.ok) throw new Error(await errorMessage(res, path));
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: body !== undefined ? { ...authHeaders(), 'Content-Type': 'application/json' } : authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await errorMessage(res, path));
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const apiClient = { get, post };
