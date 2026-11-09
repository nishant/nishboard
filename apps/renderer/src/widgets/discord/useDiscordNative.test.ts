import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import type { DiscordStatusData, DiscordStreamEvent } from '@dash/shared';

const mocks = vi.hoisted(() => ({
  getEventStream: vi.fn(),
  get: vi.fn(),
}));
vi.mock('../../lib/streamClient', () => ({ getEventStream: mocks.getEventStream }));
vi.mock('../../lib/apiClient', () => ({ apiClient: { get: mocks.get, post: vi.fn() } }));

import { nextBackoffMs, useDiscordStream } from './useDiscordNative';

const OK: DiscordStatusData = { configured: true, running: true, connected: true };

describe('nextBackoffMs', () => {
  it('doubles from 1s and caps at 30s', () => {
    const seq: number[] = [];
    let d = 1000;
    for (let i = 0; i < 8; i++) {
      seq.push(d);
      d = nextBackoffMs(d);
    }
    expect(seq).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
});

describe('useDiscordStream reconnect', () => {
  let qc: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);

  beforeEach(() => {
    vi.useFakeTimers();
    qc = new QueryClient();
    mocks.getEventStream.mockReset();
    mocks.get.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reopens the stream with backoff after it ends, and stops on unmount', async () => {
    mocks.getEventStream.mockResolvedValue(undefined); // stream ends immediately
    mocks.get.mockResolvedValue(OK);
    const { unmount } = renderHook(
      () => useDiscordStream({ enabled: true, channelId: '123456', onEvent: () => undefined }),
      { wrapper },
    );
    expect(mocks.getEventStream).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.getEventStream).toHaveBeenCalledTimes(2);

    // The second gap is 2s, not 1s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mocks.getEventStream).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mocks.getEventStream).toHaveBeenCalledTimes(3);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.getEventStream).toHaveBeenCalledTimes(3);
  });

  it('applies state frames to the status query and does not reopen while Discord is not running', async () => {
    let emit: (e: DiscordStreamEvent) => void = () => undefined;
    mocks.getEventStream.mockImplementationOnce((_url: string, o: { onEvent: (e: DiscordStreamEvent) => void }) => {
      emit = o.onEvent;
      return Promise.resolve();
    });
    mocks.get.mockResolvedValue({ configured: true, running: false, connected: false });
    qc.setQueryData(['discord-status'], OK);
    renderHook(() => useDiscordStream({ enabled: true, channelId: null, onEvent: () => undefined }), { wrapper });
    act(() => emit({ type: 'state', running: false, connected: false }));
    expect(qc.getQueryData<DiscordStatusData>(['discord-status'])?.running).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mocks.get).toHaveBeenCalled();
    expect(mocks.getEventStream).toHaveBeenCalledTimes(1);
  });
});
