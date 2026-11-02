import { ago, duration, num } from '@nish/ui/format';
import type { TwitchCategory, TwitchSearchPage, TwitchVideo } from '@dash/shared';
import type { EmbedFolder, EmbedItem, EmbedThumbShape } from '../embed/types';

// Twitch payloads → embed-widget rows. Item ids double as the embed target:
// a bare login plays the channel, `video:<id>` a past broadcast/highlight,
// `clip:<slug>` a clip (logins can't contain ':', so the prefixes are safe).

const CHANNEL_FOLDER = 'channel:';
const GAME_FOLDER = 'game:';

/** Channel rows. `thumbShape` 'wide' for stream stills (live lists), default
 *  round for profile avatars. A live row's subtitle is its game, or its stream
 *  title where every row shares the game (`'title'`, inside a game folder).
 *  Every row links its channel's videos. */
export function channelItems(
  page: TwitchSearchPage | undefined,
  thumbShape?: EmbedThumbShape,
  liveSubtitle: 'game' | 'title' = 'game',
): EmbedItem[] | undefined {
  return page?.items.map((c) => ({
    id: c.login,
    title: c.displayName,
    subtitle: !c.isLive
      ? 'Offline'
      : (liveSubtitle === 'title' ? c.title || c.gameName : c.gameName || c.title) || 'Live',
    thumbnailUrl: c.thumbnailUrl,
    thumbShape,
    isLive: c.isLive,
    channel: { id: c.login, title: c.displayName },
  }));
}

/** A past broadcast, highlight or clip row: "3h 12m · 12K views · 2d ago". */
export function videoItem(v: TwitchVideo, now = Date.now()): EmbedItem {
  return {
    id: `${v.kind === 'clip' ? 'clip' : 'video'}:${v.id}`,
    title: v.title || v.displayName,
    subtitle: [duration(v.durationSeconds), `${num(v.views, { compact: true })} views`, ago(v.createdAt, { now })]
      .filter(Boolean)
      .join(' · '),
    thumbnailUrl: v.thumbnailUrl,
    thumbShape: 'wide',
  };
}

export function gameFolder(c: TwitchCategory): EmbedFolder {
  return { id: `${GAME_FOLDER}${c.id}`, title: c.name, thumbnailUrl: c.boxArtUrl || null, thumbShape: 'square' };
}

/** The login of a `channel:` folder, else null. */
export function folderLogin(folder: EmbedFolder | null): string | null {
  return folder?.id.startsWith(CHANNEL_FOLDER) ? folder.id.slice(CHANNEL_FOLDER.length) : null;
}

/** The game id of a `game:` folder, else null. */
export function folderGameId(folder: EmbedFolder | null): string | null {
  return folder?.id.startsWith(GAME_FOLDER) ? folder.id.slice(GAME_FOLDER.length) : null;
}

/** The server embed path for a row id (see the prefixes above). */
export function twitchEmbedPath(id: string): string {
  if (id.startsWith('video:')) return `/api/twitch/embed?video=${encodeURIComponent(id.slice('video:'.length))}`;
  if (id.startsWith('clip:')) return `/api/twitch/embed?clip=${encodeURIComponent(id.slice('clip:'.length))}`;
  return `/api/twitch/embed?channel=${encodeURIComponent(id)}`;
}
