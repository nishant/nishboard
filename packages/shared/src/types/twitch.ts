export interface TwitchChannel {
  id: string;
  login: string; // broadcaster login — used as the player embed channel
  displayName: string;
  thumbnailUrl: string; // profile image
  isLive: boolean;
  title: string; // stream title (current or last)
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
