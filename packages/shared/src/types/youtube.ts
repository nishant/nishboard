export interface YoutubeVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  /** Uploader channel id — lets the widget open a channel's uploads view.
   *  Optional: some API surfaces (older caches) may omit it. */
  channelId?: string;
  thumbnailUrl: string;
  publishedAt: string;
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
