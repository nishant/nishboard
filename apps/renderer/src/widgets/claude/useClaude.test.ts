import { beforeEach, describe, expect, it, vi } from 'vitest';

const postEventStream = vi.fn();
vi.mock('../../lib/streamClient', async () => {
  const actual = await vi.importActual<typeof import('../../lib/streamClient')>('../../lib/streamClient');
  return { ...actual, postEventStream: (...a: unknown[]) => postEventStream(...a) };
});
const toast = vi.fn();
vi.mock('../../lib/alerts', () => ({ toast: (...a: unknown[]) => toast(...a), fireAlert: vi.fn() }));

import { StreamHttpError } from '../../lib/streamClient';
import { postChatWithRetry, useSendClaudeMessage } from './useClaude';
import { useClaudeStore } from '../../store/claudeStore';
import type { ClaudeChatRequestBody } from '@dash/shared';

const body = { message: 'hi', mode: 'ask' } as ClaudeChatRequestBody;
const conflict = () => new StreamHttpError('A Claude response is already streaming', 409);

beforeEach(() => {
  vi.useFakeTimers();
  postEventStream.mockReset();
  toast.mockReset();
  useClaudeStore.setState({ messages: [], isStreaming: false });
});

describe('postChatWithRetry (409 backoff)', () => {
  it('retries a 409 with backoff and then succeeds', async () => {
    postEventStream
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce(undefined);
    const p = postChatWithRetry(body, { signal: new AbortController().signal, onEvent: vi.fn() });
    await vi.advanceTimersByTimeAsync(299);
    expect(postEventStream).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(postEventStream).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(600);
    await p;
    expect(postEventStream).toHaveBeenCalledTimes(3);
  });

  it('rejects with the 409 after exhausting every retry', async () => {
    postEventStream.mockRejectedValue(conflict());
    const p = postChatWithRetry(body, { signal: new AbortController().signal, onEvent: vi.fn() });
    const assertion = expect(p).rejects.toMatchObject({ status: 409 });
    await vi.advanceTimersByTimeAsync(4_500);
    await assertion;
    expect(postEventStream).toHaveBeenCalledTimes(5);
  });

  it('does not retry other failures', async () => {
    postEventStream.mockRejectedValue(new StreamHttpError('boom', 500));
    await expect(
      postChatWithRetry(body, { signal: new AbortController().signal, onEvent: vi.fn() }),
    ).rejects.toMatchObject({ status: 500 });
    expect(postEventStream).toHaveBeenCalledTimes(1);
  });
});

describe('useSendClaudeMessage', () => {
  it('removes the unsent user bubble when 409 outlasts the retries', async () => {
    postEventStream.mockRejectedValue(conflict());
    useSendClaudeMessage().send('hello');
    expect(useClaudeStore.getState().messages).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(4_600);
    expect(useClaudeStore.getState().messages).toEqual([]);
    expect(useClaudeStore.getState().isStreaming).toBe(false);
    expect(toast).toHaveBeenCalled();
  });

  it('surfaces a done frame with isError as an error note and a toast', async () => {
    postEventStream.mockImplementation(async (_p: string, _b: unknown, opts: { onEvent: (e: unknown) => void }) => {
      opts.onEvent({ type: 'done', durationMs: 10, outputTokens: 1, contextTokens: 2, isError: true });
    });
    useSendClaudeMessage().send('hello');
    await vi.advanceTimersByTimeAsync(0);
    const last = useClaudeStore.getState().messages.at(-1)!;
    expect(JSON.stringify(last.parts)).toContain('Claude ended the turn with an error');
    expect(toast).toHaveBeenCalledWith('Claude', 'Claude ended the turn with an error', 'error');
    expect(useClaudeStore.getState().isStreaming).toBe(false);
  });
});
