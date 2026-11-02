import { describe, expect, it } from 'vitest';
import type { TwitchVideo } from '@dash/shared';
import { channelItems, folderGameId, folderLogin, gameFolder, twitchEmbedPath, videoItem } from './twitchItems';

const NOW = Date.parse('2026-11-01T12:00:00Z');

const video = (over: Partial<TwitchVideo> = {}): TwitchVideo => ({
  kind: 'vod',
  id: '2001',
  title: 'Sunday stream',
  login: 'streamer',
  displayName: 'Streamer',
  thumbnailUrl: 'https://static-cdn.jtvnw.net/a.jpg',
  durationSeconds: 3 * 3600 + 12 * 60,
  createdAt: '2026-10-30T12:00:00Z',
  views: 12_300,
  ...over,
});

describe('twitch rows', () => {
  it('maps channels with a live subtitle, offline label and a channel link', () => {
    const items = channelItems({
      nextCursor: null,
      items: [
        { id: '1', login: 'live_one', displayName: 'Live One', thumbnailUrl: 'https://x/1.jpg', isLive: true, title: 'Ranked', gameName: 'Chess', startedAt: null },
        { id: '2', login: 'sleepy', displayName: 'Sleepy', thumbnailUrl: 'https://x/2.jpg', isLive: false, title: '', gameName: '', startedAt: null },
      ],
    }, 'wide');
    expect(items?.[0]).toMatchObject({ id: 'live_one', subtitle: 'Chess', isLive: true, thumbShape: 'wide', channel: { id: 'live_one', title: 'Live One' } });
    expect(items?.[1]).toMatchObject({ subtitle: 'Offline', isLive: false });
    const page = { nextCursor: null, items: [{ id: '1', login: 'a', displayName: 'A', thumbnailUrl: '', isLive: true, title: 'Speedrun', gameName: 'Chess', startedAt: null }] };
    expect(channelItems(page, 'wide', 'title')?.[0].subtitle).toBe('Speedrun');
    expect(channelItems(undefined)).toBeUndefined();
  });

  it('maps a vod and a clip to prefixed ids with duration, views and age', () => {
    const vod = videoItem(video(), NOW);
    expect(vod.id).toBe('video:2001');
    expect(vod.thumbShape).toBe('wide');
    expect(vod.subtitle).toMatch(/^3h 12m · 12\.3K views · 2d ago$/i);
    expect(videoItem(video({ kind: 'clip', id: 'Funny-Clip_1' }), NOW).id).toBe('clip:Funny-Clip_1');
    expect(videoItem(video({ title: '' }), NOW).title).toBe('Streamer');
  });

  it('builds embed paths for channels, vods and clips', () => {
    expect(twitchEmbedPath('streamer')).toBe('/api/twitch/embed?channel=streamer');
    expect(twitchEmbedPath('video:2001')).toBe('/api/twitch/embed?video=2001');
    expect(twitchEmbedPath('clip:Funny-Clip_1')).toBe('/api/twitch/embed?clip=Funny-Clip_1');
  });

  it('round-trips game and channel folders', () => {
    const folder = gameFolder({ id: '509658', name: 'Just Chatting', boxArtUrl: 'https://x/b.jpg' });
    expect(folder).toMatchObject({ id: 'game:509658', thumbShape: 'square' });
    expect(folderGameId(folder)).toBe('509658');
    expect(folderLogin(folder)).toBeNull();
    expect(folderLogin({ id: 'channel:streamer', title: 'Streamer' })).toBe('streamer');
    expect(folderGameId(null)).toBeNull();
  });
});
