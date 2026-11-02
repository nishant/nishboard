import type { ReactElement } from 'react';

/** A playable search result, normalized across services. */
export interface EmbedItem {
  /** Service-specific embed key (YouTube videoId, Twitch login / `video:…` /
   *  `clip:…`) — also the row/iframe key. */
  id: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string;
  /** Overrides the adapter's thumbShape for this row (e.g. a VOD still in a
   *  channel-avatar service). */
  thumbShape?: EmbedThumbShape;
  /** Renders the pulsing live dot in rows and the control bar when true. */
  isLive?: boolean;
  /** When set (and the adapter has useFolderItems), the row subtitle becomes a
   *  click target that opens this channel's uploads as a folder view. */
  channel?: { id: string; title: string };
}

export type EmbedThumbShape = 'wide' | 'round' | 'square';

/** A drillable container of items (a playlist, a channel's uploads, a game). */
export interface EmbedFolder {
  /** Adapter-interpreted key, e.g. 'PLxyz…' or 'channel:UCxyz…'. */
  id: string;
  title: string;
  subtitle?: string;
  thumbnailUrl?: string | null;
  /** Row thumbnail shape. Default 'wide'. */
  thumbShape?: EmbedThumbShape;
}

export interface EmbedFoldersState {
  folders: EmbedFolder[] | undefined;
  isFetching: boolean;
  isError: boolean;
  hint?: string;
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
  /** Search only: a quiet line above the results, e.g. "Saved 3h ago". */
  note?: string;
  /** Search only: shown as a Refresh link next to `note` (fetch fresh results). */
  onRefresh?: () => void;
}

export interface EmbedBrowseTab {
  id: string;
  label: string;
  /** 'folders' renders the tab as a drillable list (needs useFolders +
   *  useFolderItems on the browse extension). Default: 'videos'. */
  kind?: 'videos' | 'folders';
}

/** Optional browse extension: a cheap home feed (tab strip + rows) replacing
 *  the hero home view when the tile is tall enough. */
export interface EmbedBrowse {
  tabs: EmbedBrowseTab[];
  /** Rows for a tab. Must be a real hook (called from the browse home view);
   *  `enabled` gates fetching. */
  useBrowse: (tabId: string, enabled: boolean) => EmbedSearchState;
  /** Folder rows for a kind:'folders' tab (e.g. "your playlists"). Must be a
   *  real hook; `enabled` gates fetching. */
  useFolders?: (tabId: string, enabled: boolean) => EmbedFoldersState;
  /** Items inside an open folder (also serves channel-uploads folders opened
   *  from a row's channel click). Must be a real hook; null folder = disabled.
   *  `tabId` is the folder's selected tab when `folderTabs` gives it some. */
  useFolderItems?: (folder: EmbedFolder | null, tabId: string) => EmbedSearchState;
  /** Sub-tabs for an open folder (e.g. a Twitch channel's Past broadcasts /
   *  Highlights / Clips). Pure function; undefined = no tab strip. */
  folderTabs?: (folder: EmbedFolder) => EmbedBrowseTab[] | undefined;
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
  thumbShape: EmbedThumbShape;
  /** Close-button tooltip, e.g. "Close video". */
  closeLabel: string;
  embedUrl: (item: EmbedItem) => string;
  useSearch: (query: string) => EmbedSearchState;
  /** Folder matches for the same submitted query (e.g. Twitch games), listed
   *  above the item results under `searchFoldersLabel`. Must be a real hook. */
  useSearchFolders?: (query: string) => EmbedFoldersState;
  /** Section headings when search returns folders too, e.g. 'Games' / 'Channels'. */
  searchFoldersLabel?: string;
  searchItemsLabel?: string;
  /** When present, the home view becomes a browse feed (if the tile is tall enough). */
  browse?: EmbedBrowse;
}
