import { LogIn, LogOut } from 'lucide-react';
import {
  useTwitchSearch, useTwitchAuthStatus, useTwitchConnect, useTwitchLogout,
  useTwitchFollowed, useTwitchFollowedAll,
  useTwitchTopGames, useTwitchCategories, useTwitchCategoryStreams, useTwitchVideos,
} from './useTwitch';
import { channelItems, videoItem, gameFolder, folderLogin, folderGameId, twitchEmbedPath } from './twitchItems';
import { embedUrl } from '../../lib/apiClient';
import { EmbedSearchWidget } from '../embed/EmbedSearchWidget';
import { HeaderAction } from '../../components/HeaderAction';
import type { EmbedBrowseTab, EmbedFolder, EmbedFoldersState, EmbedSearchState, EmbedServiceAdapter } from '../embed/types';
import type { TwitchVideoType } from '@dash/shared';

// simple-icons glyph
function TwitchIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
    </svg>
  );
}

const SEARCH_GAMES = 3;

function useTwitchEmbedSearch(query: string): EmbedSearchState {
  const { data, isFetching, isError } = useTwitchSearch(query);
  return { items: channelItems(data), isFetching, isError };
}

/** The best few games matching the same search, listed above the channels
 *  (more would push the channels out of a small tile). Errors stay quiet here:
 *  the channel search reports its own. */
function useTwitchEmbedSearchFolders(query: string): EmbedFoldersState {
  const { data, isFetching } = useTwitchCategories(query);
  return { folders: data?.slice(0, SEARCH_GAMES).map(gameFolder), isFetching, isError: false };
}

function useTwitchEmbedBrowse(tabId: string, enabled: boolean): EmbedSearchState {
  const authed = useTwitchAuthStatus().data?.authenticated === true;
  // Both hooks run unconditionally (rules of hooks); `enabled` gates fetching
  // so only the visible tab polls.
  const live = useTwitchFollowed(enabled && authed && tabId === 'live');
  const all = useTwitchFollowedAll(enabled && authed && tabId === 'all');
  if (!authed) {
    return {
      items: undefined, isFetching: false, isError: false,
      hint: "Connect your Twitch account from the widget header to see who's live",
    };
  }
  // Live rows carry stream stills; All rows carry profile avatars.
  return tabId === 'all'
    ? { items: channelItems(all.data), isFetching: all.isFetching, isError: all.isError }
    : { items: channelItems(live.data, 'wide'), isFetching: live.isFetching, isError: live.isError };
}

/** Games tab: top games right now (app token — works signed out). */
function useTwitchEmbedFolders(tabId: string, enabled: boolean): EmbedFoldersState {
  const { data, isFetching, isError } = useTwitchTopGames(enabled && tabId === 'games');
  return { folders: data?.map(gameFolder), isFetching, isError };
}

const CHANNEL_TABS: EmbedBrowseTab[] = [
  { id: 'archive', label: 'Past broadcasts' },
  { id: 'highlight', label: 'Highlights' },
  { id: 'clips', label: 'Clips' },
];
const VIDEO_TYPES: readonly TwitchVideoType[] = ['archive', 'highlight', 'clips'];

/** An open folder: `game:<id>` → live streams in that game; `channel:<login>`
 *  → that channel's past broadcasts, highlights or clips (the folder tab). */
function useTwitchEmbedFolderItems(folder: EmbedFolder | null, tabId: string): EmbedSearchState {
  const gameId = folderGameId(folder);
  const login = folderLogin(folder);
  const type = VIDEO_TYPES.find((t) => t === tabId) ?? 'archive';
  // Both hooks run unconditionally; the null ids gate fetching.
  const streams = useTwitchCategoryStreams(gameId);
  const videos = useTwitchVideos(login, type);
  if (gameId !== null) {
    return { items: channelItems(streams.data, 'wide', 'title'), isFetching: streams.isFetching, isError: streams.isError };
  }
  return {
    items: videos.data?.items.map((v) => videoItem(v)),
    isFetching: videos.isFetching,
    isError: videos.isError,
  };
}

/** WidgetShell header action (via DashboardGrid): Connect when signed out,
 *  disconnect when in — widget-level actions live in the top bar. */
export function TwitchActions() {
  const { data } = useTwitchAuthStatus();
  const connect = useTwitchConnect();
  const logout = useTwitchLogout();
  if (data?.authenticated) {
    return (
      <HeaderAction title="Disconnect Twitch" danger onClick={() => logout.mutate()}>
        <LogOut size={12} />
      </HeaderAction>
    );
  }
  return (
    <HeaderAction title="Connect Twitch" onClick={() => connect.mutate()}>
      <LogIn size={12} />
    </HeaderAction>
  );
}

const TWITCH_ADAPTER: EmbedServiceAdapter = {
  serviceName: 'Twitch',
  Icon: TwitchIcon,
  searchPlaceholder: 'Search Twitch…',
  homeCta: 'Search channels',
  emptyHint: 'Search for channels or games above',
  errorHint: 'Search failed — add Twitch credentials in Settings → Developer',
  thumbShape: 'round',
  closeLabel: 'Close stream',
  embedUrl: (item) => embedUrl(twitchEmbedPath(item.id)),
  useSearch: useTwitchEmbedSearch,
  useSearchFolders: useTwitchEmbedSearchFolders,
  searchFoldersLabel: 'Games',
  searchItemsLabel: 'Channels',
  browse: {
    tabs: [
      { id: 'live', label: 'Live' },
      { id: 'all', label: 'All' },
      { id: 'games', label: 'Games', kind: 'folders' },
    ],
    useBrowse: useTwitchEmbedBrowse,
    useFolders: useTwitchEmbedFolders,
    useFolderItems: useTwitchEmbedFolderItems,
    folderTabs: (folder) => (folderLogin(folder) !== null ? CHANNEL_TABS : undefined),
  },
};

export function TwitchWidget() {
  return <EmbedSearchWidget adapter={TWITCH_ADAPTER} />;
}
