import { QueryClient } from '@tanstack/react-query';
import type { TrackData } from '@dash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTLE_DELAY_MS, optimisticNowPlaying, rollbackNowPlaying, settleNowPlaying } from './useSpotify';

const KEY = ['spotify-now-playing'];
const track = { trackId: 't1', isPlaying: false, shuffleState: false } as unknown as TrackData;

describe('now-playing optimistic helpers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('cancels in-flight polls, patches the cache and returns a snapshot', async () => {
    const qc = new QueryClient();
    qc.setQueryData(KEY, track);
    const cancel = vi.spyOn(qc, 'cancelQueries');
    const ctx = await optimisticNowPlaying(qc, { isPlaying: true });
    expect(cancel).toHaveBeenCalledWith({ queryKey: KEY });
    expect(ctx.previous).toEqual(track);
    expect(qc.getQueryData<TrackData>(KEY)?.isPlaying).toBe(true);
  });

  it('rolls back to the snapshot', async () => {
    const qc = new QueryClient();
    qc.setQueryData(KEY, track);
    const ctx = await optimisticNowPlaying(qc, { isPlaying: true });
    rollbackNowPlaying(qc, ctx);
    expect(qc.getQueryData<TrackData>(KEY)?.isPlaying).toBe(false);
  });

  it('leaves the cache alone when there was nothing to snapshot', async () => {
    const qc = new QueryClient();
    const ctx = await optimisticNowPlaying(qc, { isPlaying: true });
    rollbackNowPlaying(qc, ctx);
    expect(qc.getQueryData(KEY)).toBeUndefined();
  });

  it('delays the settle invalidation', () => {
    const qc = new QueryClient();
    const inv = vi.spyOn(qc, 'invalidateQueries');
    settleNowPlaying(qc);
    vi.advanceTimersByTime(SETTLE_DELAY_MS - 1);
    expect(inv).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(inv).toHaveBeenCalledWith({ queryKey: KEY });
  });
});
