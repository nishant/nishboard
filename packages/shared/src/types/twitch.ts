export interface TwitchChannel {
  id: string;
  login: string; // broadcaster login — used as the player embed channel
  displayName: string;
  thumbnailUrl: string; // stream still when live (followed, category streams), profile image otherwise (search, followed-all)
  isLive: boolean;
  title: string; // current stream title; last title from search; empty for offline followed-all rows
  gameName: string;
  startedAt: string | null; // ISO when the current stream went live, null if offline
}

export interface TwitchSearchPage {
  items: TwitchChannel[];
  nextCursor: string | null;
}

export interface TwitchAuthStatus {
  authenticated: boolean;
}

/** A past broadcast, highlight, upload (`vod`) or clip of a channel. */
export interface TwitchVideo {
  kind: 'vod' | 'clip';
  /** Numeric video id for a vod, clip slug for a clip — the embed param. */
  id: string;
  title: string;
  login: string;
  displayName: string;
  thumbnailUrl: string;
  durationSeconds: number;
  /** ISO time the broadcast or clip was made. */
  createdAt: string;
  views: number;
}

/** `/api/twitch/videos?type=`: past broadcasts, highlights, uploads or the last 30 days of clips. */
export type TwitchVideoType = 'archive' | 'highlight' | 'upload' | 'clips';

export interface TwitchVideosPage {
  items: TwitchVideo[];
  nextCursor: string | null;
}

/** A Twitch game (category), from `search/categories` or `games/top`. */
export interface TwitchCategory {
  id: string;
  name: string;
  boxArtUrl: string;
}
