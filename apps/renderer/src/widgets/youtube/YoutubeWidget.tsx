import { LogOut } from 'lucide-react';
import {
  useYoutubeSearch, useYoutubeBrowse,
  useYoutubeAuthStatus, useYoutubeConnect, useYoutubeLogout,
  useYoutubeSubsFeed, useYoutubeLiked, useYoutubeMyPlaylists, useYoutubeFolderVideos,
} from './useYoutube';
import { embedUrl } from '../../lib/apiClient';
import { EmbedSearchWidget } from '../embed/EmbedSearchWidget';
import type {
  EmbedSearchState, EmbedFoldersState, EmbedFolder, EmbedServiceAdapter,
} from '../embed/types';
import type { YoutubeSearchPage } from '@dash/shared';

function YoutubeIcon({ size }: { size: number }) {
  return (
    <svg width={Math.round(size * 1.4286)} height={size} viewBox="0 0 20 14" fill="none">
      <rect width="20" height="14" rx="3.1" fill="currentColor" />
      <path d="M8 3.5L8 10.5L14 7L8 3.5Z" fill="white" />
    </svg>
  );
}

const CONNECT_HINT = 'Connect your Google account to see this';

function toEmbedState(
  data: YoutubeSearchPage | undefined,
  isFetching: boolean,
  isError: boolean,
): EmbedSearchState {
  return {
    items: data?.items.map((v) => ({
      id: v.videoId,
      title: v.title,
      subtitle: v.channelTitle,
      thumbnailUrl: v.thumbnailUrl,
      channel: v.channelId ? { id: v.channelId, title: v.channelTitle } : undefined,
    })),
    isFetching,
    isError,
  };
}

function useYoutubeEmbedSearch(query: string): EmbedSearchState {
  const { data, isFetching, isError } = useYoutubeSearch(query);
  return toEmbedState(data, isFetching, isError);
}

const ACCOUNT_TABS = new Set(['subs', 'liked', 'playlists']);

function useYoutubeEmbedBrowse(tabId: string, enabled: boolean): EmbedSearchState {
  const authed = useYoutubeAuthStatus().data?.authenticated === true;
  // All hooks run unconditionally (rules of hooks); `enabled` gates fetching so
  // only the visible tab hits the server.
  const isAccountTab = ACCOUNT_TABS.has(tabId);
  const browse = useYoutubeBrowse(tabId, enabled && !isAccountTab);
  const subs = useYoutubeSubsFeed(enabled && authed && tabId === 'subs');
  const liked = useYoutubeLiked(enabled && authed && tabId === 'liked');

  if (isAccountTab && !authed) {
    return { items: undefined, isFetching: false, isError: false, hint: CONNECT_HINT };
  }
  const q = tabId === 'subs' ? subs : tabId === 'liked' ? liked : browse;
  return toEmbedState(q.data, q.isFetching, q.isError);
}

function useYoutubeEmbedFolders(tabId: string, enabled: boolean): EmbedFoldersState {
  const authed = useYoutubeAuthStatus().data?.authenticated === true;
  const { data, isFetching, isError } = useYoutubeMyPlaylists(enabled && authed && tabId === 'playlists');
  if (!authed) {
    return { folders: undefined, isFetching: false, isError: false, hint: CONNECT_HINT };
  }
  return {
    folders: data?.map((p) => ({
      id: p.id,
      title: p.title,
      subtitle: `${p.videoCount} videos`,
      thumbnailUrl: p.thumbnailUrl,
    })),
    isFetching,
    isError,
  };
}

function useYoutubeEmbedFolderItems(folder: EmbedFolder | null): EmbedSearchState {
  const { data, isFetching, isError } = useYoutubeFolderVideos(folder?.id ?? null);
  return toEmbedState(data, isFetching, isError);
}

/** Tab-strip control: Connect when signed out, a small disconnect when in. */
function YoutubeConnectHeader() {
  const { data } = useYoutubeAuthStatus();
  const connect = useYoutubeConnect();
  const logout = useYoutubeLogout();
  if (data?.authenticated) {
    return (
      <button
        onClick={() => logout.mutate()}
        title="Disconnect YouTube"
        className="p-1 rounded text-th-ghost hover:text-red-400 transition-colors shrink-0"
      >
        <LogOut size={11} />
      </button>
    );
  }
  return (
    <button
      onClick={() => connect.mutate()}
      disabled={connect.isPending}
      className="px-2 py-0.5 rounded-full text-[10px] shrink-0 transition-colors bg-red-500/20 text-red-300 hover:bg-red-500/35 disabled:opacity-50"
    >
      Connect
    </button>
  );
}

const YOUTUBE_ADAPTER: EmbedServiceAdapter = {
  serviceName: 'YouTube',
  Icon: YoutubeIcon,
  searchPlaceholder: 'Search YouTube…',
  homeCta: 'Search videos',
  emptyHint: 'Search for videos above',
  errorHint: 'Search failed — add a YouTube API key in Settings → Developer',
  thumbShape: 'wide',
  closeLabel: 'Close video',
  embedUrl: (item) => embedUrl(`/api/youtube/embed?videoId=${item.id}`),
  useSearch: useYoutubeEmbedSearch,
  browse: {
    tabs: [
      { id: 'subs', label: 'Subs' },
      { id: 'playlists', label: 'Playlists', kind: 'folders' },
      { id: 'liked', label: 'Liked' },
      { id: 'trending', label: 'Trending' },
      { id: 'music', label: 'Music' },
      { id: 'gaming', label: 'Gaming' },
    ],
    useBrowse: useYoutubeEmbedBrowse,
    useFolders: useYoutubeEmbedFolders,
    useFolderItems: useYoutubeEmbedFolderItems,
    HomeHeader: YoutubeConnectHeader,
  },
};

export function YoutubeWidget() {
  return <EmbedSearchWidget adapter={YOUTUBE_ADAPTER} />;
}
