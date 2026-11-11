import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./apiClient', () => ({
  apiUrl: (path: string) => `http://test${path}`,
  authHeaders: () => ({ Authorization: 'Bearer t' }),
}));

import { getEventStream, postEventStream, StreamHttpError } from './streamClient';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

function stubFetch(res: Response): void {
  vi.stubGlobal('fetch', vi.fn(async () => res));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('event stream parsing', () => {
  it('reassembles frames split across chunks, skips malformed ones, keeps a final unterminated frame', async () => {
    stubFetch(
      new Response(streamOf(['data: {"a":1}\n', '\ndata: {"b"', ':2}\n\ndata: bad\n\n', 'data: {"c":3}'])),
    );
    const events: unknown[] = [];
    await getEventStream('/api/x', { signal: new AbortController().signal, onEvent: (e) => events.push(e) });
    expect(events).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('rejects with the server error text and status on a 409', async () => {
    stubFetch(new Response(JSON.stringify({ error: 'busy' }), { status: 409 }));
    const p = postEventStream('/api/claude/chat', { message: 'hi' }, {
      signal: new AbortController().signal,
      onEvent: () => undefined,
    });
    await expect(p).rejects.toMatchObject({ message: 'busy', status: 409 });
    await expect(p).rejects.toBeInstanceOf(StreamHttpError);
  });

  it('lets an exception thrown by onEvent propagate instead of dropping it as a malformed frame', async () => {
    stubFetch(new Response(streamOf(['data: {"a":1}\n\n'])));
    await expect(
      getEventStream('/api/x', {
        signal: new AbortController().signal,
        onEvent: () => {
          throw new Error('handler bug');
        },
      }),
    ).rejects.toThrow('handler bug');
  });
});
