import { useYoutubeSearch, useYoutubeBrowse } from './useYoutube';
import { embedUrl } from '../../lib/apiClient';
import { EmbedSearchWidget } from '../embed/EmbedSearchWidget';
import type { EmbedSearchState, EmbedServiceAdapter } from '../embed/types';
import type { YoutubeSearchPage } from '@dash/shared';

function YoutubeIcon({ size }: { size: number }) {
  return (
    <svg width={Math.round(size * 1.4286)} height={size} viewBox="0 0 20 14" fill="none">
      <rect width="20" height="14" rx="3.1" fill="currentColor" />
      <path d="M8 3.5L8 10.5L14 7L8 3.5Z" fill="white" />
    </svg>
  );
}

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
    })),
    isFetching,
    isError,
  };
}

function useYoutubeEmbedSearch(query: string): EmbedSearchState {
  const { data, isFetching, isError } = useYoutubeSearch(query);
  return toEmbedState(data, isFetching, isError);
}

function useYoutubeEmbedBrowse(tabId: string, enabled: boolean): EmbedSearchState {
  const { data, isFetching, isError } = useYoutubeBrowse(tabId, enabled);
  return toEmbedState(data, isFetching, isError);
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
      { id: 'trending', label: 'Trending' },
      { id: 'music', label: 'Music' },
      { id: 'gaming', label: 'Gaming' },
    ],
    useBrowse: useYoutubeEmbedBrowse,
  },
};

export function YoutubeWidget() {
  return <EmbedSearchWidget adapter={YOUTUBE_ADAPTER} />;
}
