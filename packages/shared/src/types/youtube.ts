export interface YoutubeVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  /** Uploader channel id — lets the widget open a channel's uploads view.
   *  Optional: some API surfaces (older caches) may omit it. */
  channelId?: string;
  thumbnailUrl: string;
  publishedAt: string;
  /** Video length in seconds (from contentDetails). 0 when unknown. */
  durationSeconds: number;
  /** Heuristic Short flag — ≤60s duration OR a `#shorts` title tag. The server
   *  always sets this so the renderer can filter without another request. */
  isShort: boolean;
}

export interface YoutubeSearchPage {
  items: YoutubeVideo[];
  nextPageToken: string | null;
}

export interface YoutubeAuthStatus {
  authenticated: boolean;
}

/** One of the signed-in user's playlists (Playlists tab). */
export interface YoutubePlaylist {
  id: string;
  title: string;
  videoCount: number;
  thumbnailUrl: string | null;
}
