import { LogIn, LogOut } from 'lucide-react';
import {
  useYoutubeSearch, useYoutubeBrowse,
  useYoutubeAuthStatus, useYoutubeConnect, useYoutubeLogout,
  useYoutubeSubsFeed, useYoutubeLiked, useYoutubeMyPlaylists, useYoutubeFolderVideos,
} from './useYoutube';
import { embedUrl } from '../../lib/apiClient';
import { EmbedSearchWidget } from '../embed/EmbedSearchWidget';
import { HeaderAction } from '../../components/HeaderAction';
import { useAppSettingsStore } from '../../store/settingsStore';
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

const CONNECT_HINT = 'Connect your Google account from the widget header to see this';

/** The single YouTube list → EmbedSearchState mapper. Every tab (search, browse
 *  subs/trending/music/gaming/liked, and folder/channel drill-ins) funnels
 *  through here, so the "Hide Shorts" filter lives in this one place — a pure
 *  client-side drop of already-fetched `isShort` items (instant on toggle, no
 *  refetch). It reads the setting reactively, hence a hook. */
function useEmbedState(
  data: YoutubeSearchPage | undefined,
  isFetching: boolean,
  isError: boolean,
): EmbedSearchState {
  const hideShorts = useAppSettingsStore((s) => s.hideYoutubeShorts);
  const videos = hideShorts ? data?.items.filter((v) => !v.isShort) : data?.items;
  return {
    items: videos?.map((v) => ({
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
  return useEmbedState(data, isFetching, isError);
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

  const q = tabId === 'subs' ? subs : tabId === 'liked' ? liked : browse;
  // Call the mapper unconditionally (rules of hooks) — it reads the Hide-Shorts
  // setting; the not-connected branch below overrides its result.
  const state = useEmbedState(q.data, q.isFetching, q.isError);

  if (isAccountTab && !authed) {
    return { items: undefined, isFetching: false, isError: false, hint: CONNECT_HINT };
  }
  return state;
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
  return useEmbedState(data, isFetching, isError);
}

/** WidgetShell header action (via DashboardGrid): Connect when signed out,
 *  disconnect when in — widget-level actions live in the top bar. */
export function YoutubeActions() {
  const { data } = useYoutubeAuthStatus();
  const connect = useYoutubeConnect();
  const logout = useYoutubeLogout();
  if (data?.authenticated) {
    return (
      <HeaderAction title="Disconnect YouTube" danger onClick={() => logout.mutate()}>
        <LogOut size={12} />
      </HeaderAction>
    );
  }
  return (
    <HeaderAction title="Connect YouTube (Google account)" onClick={() => connect.mutate()}>
      <LogIn size={12} />
    </HeaderAction>
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
  },
};

export function YoutubeWidget() {
  return <EmbedSearchWidget adapter={YOUTUBE_ADAPTER} />;
}
