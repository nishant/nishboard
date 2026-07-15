import { apiUrl } from './apiClient';

/**
 * SSE-style event-stream helpers — one `data: <json>\n\n` frame per event.
 * Kept separate from apiClient: its get/post helpers buffer whole JSON bodies,
 * these hand frames to the caller as they arrive.
 */

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
    throw new Error(message);
  }
  if (!res.body) throw new Error(`API ${res.status}: ${path} returned no stream body`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // Frames can split anywhere across network chunks — buffer on '\n\n'.
    buf += decoder.decode(value, { stream: true });
    let idx = buf.indexOf('\n\n');
    while (idx !== -1) {
      const frame = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (frame.startsWith('data: ')) {
        try {
          onEvent(JSON.parse(frame.slice('data: '.length)) as T);
        } catch {
          // malformed frame — skip
        }
      }
      idx = buf.indexOf('\n\n');
    }
  }
}

/** POST JSON and consume the response as an event stream (Claude chat). */
export async function postEventStream<T>(
  path: string,
  body: unknown,
  opts: { signal: AbortSignal; onEvent: (e: T) => void },
): Promise<void> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const res = await fetch(apiUrl(path), { signal: opts.signal });
  await consumeEventStream(res, path, opts.onEvent);
}
