import { LogIn, LogOut } from 'lucide-react';
import {
  useTwitchSearch, useTwitchAuthStatus, useTwitchConnect, useTwitchLogout,
  useTwitchFollowed, useTwitchFollowedAll,
} from './useTwitch';
import { embedUrl } from '../../lib/apiClient';
import { EmbedSearchWidget } from '../embed/EmbedSearchWidget';
import { HeaderAction } from '../../components/HeaderAction';
import type { EmbedSearchState, EmbedServiceAdapter } from '../embed/types';
import type { TwitchSearchPage } from '@dash/shared';

// simple-icons glyph
function TwitchIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
    </svg>
  );
}

function toItems(data: TwitchSearchPage | undefined) {
  return data?.items.map((c) => ({
    // login is both the embed param and unique per channel
    id: c.login,
    title: c.displayName,
    subtitle: c.isLive ? (c.gameName || c.title || 'Live') : 'Offline',
    thumbnailUrl: c.thumbnailUrl,
    isLive: c.isLive,
  }));
}

function useTwitchEmbedSearch(query: string): EmbedSearchState {
  const { data, isFetching, isError } = useTwitchSearch(query);
  return { items: toItems(data), isFetching, isError };
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
  const q = tabId === 'all' ? all : live;
  return { items: toItems(q.data), isFetching: q.isFetching, isError: q.isError };
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
  emptyHint: 'Search for channels above',
  errorHint: 'Search failed — add Twitch credentials in Settings → Developer',
  thumbShape: 'round',
  closeLabel: 'Close stream',
  embedUrl: (item) => embedUrl(`/api/twitch/embed?channel=${item.id}`),
  useSearch: useTwitchEmbedSearch,
  browse: {
    tabs: [
      { id: 'live', label: 'Live' },
      { id: 'all', label: 'All' },
    ],
    useBrowse: useTwitchEmbedBrowse,
  },
};

export function TwitchWidget() {
  return <EmbedSearchWidget adapter={TWITCH_ADAPTER} />;
}
