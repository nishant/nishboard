import type { ReactElement } from 'react';

/** A playable search result, normalized across services. */
export interface EmbedItem {
  /** Service-specific embed key (YouTube videoId, Twitch login) — also the row/iframe key. */
  id: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string;
  /** Renders the pulsing live dot in rows and the control bar when true. */
  isLive?: boolean;
}

/** What EmbedSearchWidget needs from a search — decoupled from TanStack types
 *  so adapters can map service results however they like. */
export interface EmbedSearchState {
  /** undefined until the first page arrives (drives the "Searching…" state). */
  items: EmbedItem[] | undefined;
  isFetching: boolean;
  isError: boolean;
  /** Shown in the browse body when there's nothing to fetch yet
   *  (e.g. "Connect your Twitch account…"). */
  hint?: string;
}

export interface EmbedBrowseTab {
  id: string;
  label: string;
}

/** Optional browse extension: a cheap home feed (tab strip + rows) replacing
 *  the hero home view when the tile is tall enough. */
export interface EmbedBrowse {
  tabs: EmbedBrowseTab[];
  /** Rows for a tab. Must be a real hook (called from the browse home view);
   *  `enabled` gates fetching. */
  useBrowse: (tabId: string, enabled: boolean) => EmbedSearchState;
  /** Optional extra control rendered at the left of the tab strip
   *  (e.g. a Twitch "Connect" button). */
  HomeHeader?: () => ReactElement | null;
}

/** Everything service-specific about an embed-search widget. The generic
 *  component owns the view state machine, measurement, iframe-kept-mounted
 *  trick, search overlay, and control bar. */
export interface EmbedServiceAdapter {
  serviceName: string;
  Icon: (props: { size: number }) => ReactElement;
  searchPlaceholder: string;
  /** Home-screen button label, e.g. "Search videos". */
  homeCta: string;
  /** Empty-results-area hint, e.g. "Search for videos above". */
  emptyHint: string;
  /** Search-error hint — point at Settings, not .env (packaged builds have no .env). */
  errorHint: string;
  /** Row thumbnail shape: 16:9 video still vs round channel avatar. */
  thumbShape: 'wide' | 'round';
  /** Close-button tooltip, e.g. "Close video". */
  closeLabel: string;
  embedUrl: (item: EmbedItem) => string;
  useSearch: (query: string) => EmbedSearchState;
  /** When present, the home view becomes a browse feed (if the tile is tall enough). */
  browse?: EmbedBrowse;
}
