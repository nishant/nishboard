import { apiUrl, authHeaders } from './apiClient';

/**
 * SSE-style event-stream helpers — one `data: <json>\n\n` frame per event.
 * Kept separate from apiClient: its get/post helpers buffer whole JSON bodies,
 * these hand frames to the caller as they arrive.
 */

/** Non-2xx response; `status` lets callers react (e.g. retry a 409). */
export class StreamHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'StreamHttpError';
  }
}

async function consumeEventStream<T>(
  res: Response,
  path: string,
  onEvent: (e: T) => void,
): Promise<void> {
  if (!res.ok) {
    // Prefer the server's { error } message (e.g. the 409 single-flight text).
    let message = `API ${res.status}: ${path}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // no JSON body
    }
    throw new StreamHttpError(message, res.status);
  }
  if (!res.body) throw new Error(`API ${res.status}: ${path} returned no stream body`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  // Parse inside the try, deliver outside it: an exception thrown by the
  // caller's handler is a handler bug, not a malformed frame, and must surface.
  const handle = (raw: string): void => {
    const frame = raw.trim();
    if (!frame.startsWith('data: ')) return;
    let ev: T;
    try {
      ev = JSON.parse(frame.slice('data: '.length)) as T;
    } catch {
      return; // malformed frame — skip
    }
    onEvent(ev);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // Frames can split anywhere across network chunks — buffer on a blank line.
    buf += decoder.decode(value, { stream: true });
    let idx = buf.indexOf('\n\n');
    while (idx !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      handle(frame);
      idx = buf.indexOf('\n\n');
    }
  }
  // Flush the decoder and a last frame that had no trailing blank line.
  buf += decoder.decode();
  handle(buf);
}

/** POST JSON and consume the response as an event stream (Claude chat). */
export async function postEventStream<T>(
  path: string,
  body: unknown,
  opts: { signal: AbortSignal; onEvent: (e: T) => void },
): Promise<void> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  await consumeEventStream(res, path, opts.onEvent);
}

/** GET an event stream (Discord native live feed). Resolves when the server
 *  ends the stream; rejects on abort/network — callers decide whether that
 *  means reconnect. */
export async function getEventStream<T>(
  path: string,
  opts: { signal: AbortSignal; onEvent: (e: T) => void },
): Promise<void> {
  const res = await fetch(apiUrl(path), { headers: authHeaders(), signal: opts.signal });
  await consumeEventStream(res, path, opts.onEvent);
}
