const BASE_URL = 'http://localhost:7432';

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
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(await errorMessage(res, path));
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await errorMessage(res, path));
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const apiClient = { get, post };
