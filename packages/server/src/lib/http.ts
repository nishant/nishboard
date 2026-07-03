/** An intentional client-facing error — the central error handler sends this
 *  status and message verbatim. Throw from route logic instead of hand-rolling
 *  `reply.code(...).send({ error })` in per-route try/catch blocks. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** A non-OK response from an upstream API. The central error handler passes
 *  informative statuses (401/403/404/429) through to the client and maps
 *  everything else to 502. */
export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

export interface FetchOpts {
  /** Abort the request after this long — a hung upstream must not stall the
   *  route until the socket dies. */
  timeoutMs?: number;
  /** Short upstream name used in error messages, e.g. "YouTube API". */
  label?: string;
}

async function doFetch(url: string, init: RequestInit | undefined, opts: FetchOpts): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new UpstreamError(res.status, `${opts.label ?? 'Upstream'} ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

/** fetch + ok-check + JSON parse with a timeout. Throws UpstreamError on a
 *  non-OK response. The cast to T is the single place unvalidated upstream
 *  JSON enters the type system — callers must treat optional fields as such. */
export async function fetchJson<T>(url: string, init?: RequestInit, opts: FetchOpts = {}): Promise<T> {
  const res = await doFetch(url, init, opts);
  return (await res.json()) as T;
}

/** fetchJson's text-body sibling (RSS, HTML) — same timeout/error semantics. */
export async function fetchText(url: string, init?: RequestInit, opts: FetchOpts = {}): Promise<string> {
  const res = await doFetch(url, init, opts);
  return res.text();
}
