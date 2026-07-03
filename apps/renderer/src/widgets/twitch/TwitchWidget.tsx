import { useTwitchSearch } from './useTwitch';
import { embedUrl } from '../../lib/apiClient';
import { EmbedSearchWidget } from '../embed/EmbedSearchWidget';
import type { EmbedSearchState, EmbedServiceAdapter } from '../embed/types';

// simple-icons glyph
function TwitchIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
    </svg>
  );
}

function useTwitchEmbedSearch(query: string): EmbedSearchState {
  const { data, isFetching, isError } = useTwitchSearch(query);
  return {
    items: data?.items.map((c) => ({
      // login is both the embed param and unique per channel
      id: c.login,
      title: c.displayName,
      subtitle: c.isLive ? (c.gameName || c.title || 'Live') : 'Offline',
      thumbnailUrl: c.thumbnailUrl,
      isLive: c.isLive,
    })),
    isFetching,
    isError,
  };
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
};

export function TwitchWidget() {
  return <EmbedSearchWidget adapter={TWITCH_ADAPTER} />;
}
