import { vi } from 'vitest';

/** URL-substring → response factory. First match wins; an unmatched URL
 *  throws so a test can never silently hit a real upstream. */
export type FetchRoute = [match: string, handler: (url: string) => Response];

export function stubFetch(routes: FetchRoute[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: string | URL): Promise<Response> => {
    const url = String(input);
    for (const [match, handler] of routes) {
      if (url.includes(match)) return handler(url);
    }
    throw new Error(`Unstubbed fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function textRes(body: string, status = 200): Response {
  return new Response(body, { status });
}
