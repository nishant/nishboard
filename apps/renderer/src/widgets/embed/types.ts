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
}
