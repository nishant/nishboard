import { describe, expect, it } from 'vitest';
import { youtubeSearchOptions } from './useYoutube';

describe('youtubeSearchOptions', () => {
  it('never retries or refetches on its own, since a search can spend a quota unit', () => {
    const o = youtubeSearchOptions('lofi');
    expect(o.retry).toBe(false);
    expect(o.staleTime).toBe(Infinity);
    expect(o.refetchOnMount).toBe(false);
    expect(o.queryKey).toEqual(['youtube-search', 'lofi', undefined]);
  });

  it('is disabled for an empty query', () => {
    expect(youtubeSearchOptions('').enabled).toBe(false);
  });
});
