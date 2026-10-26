import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { Play, Plus, Music, Mic2, Check } from 'lucide-react';
import { EmptyState, ErrorState, IconButton, Modal, Spinner, cn, Label } from '@nish/ui';
import { SearchInput } from '../../components/nishGaps';
import {
  useDebouncedValue, useSpotifySearch, useDevices,
  usePlayTrack, useQueueTrack,
} from './useSpotify';
import { fmtMs } from '../../lib/time';
import type { SpotifyTrackItem } from '@dash/shared';

type RowAction = 'play' | 'queue';
type ActionStatus = 'idle' | 'pending' | 'done' | 'error';

interface ResultRowProps {
  track: SpotifyTrackItem;
  playStatus: ActionStatus;
  queueStatus: ActionStatus;
  onAction: (track: SpotifyTrackItem, action: RowAction) => void;
}

// Hoisted (not defined inside ResultRow): a component created during render
// gets a fresh identity each time, remounting its DOM on every parent render.
function ActionButton({
  track, action, status, icon, title, onAction,
}: {
  track: SpotifyTrackItem;
  action: RowAction;
  status: ActionStatus;
  icon: React.ReactNode;
  title: string;
  onAction: (track: SpotifyTrackItem, action: RowAction) => void;
}) {
  return (
    <IconButton
      label={title}
      size="sm"
      onClick={(e) => { e.stopPropagation(); onAction(track, action); }}
      disabled={track.isLocal || status === 'pending'}
      className={cn(
        status === 'done' ? 'text-th-ok' : status === 'error' ? 'text-th-loss' : 'hover:text-th-ok',
      )}
    >
      {status === 'pending'
        ? <Spinner size="sm" />
        : status === 'done'
        ? <Check size={13} />
        : icon}
    </IconButton>
  );
}

const ResultRow = memo(function ResultRow({
  track, playStatus, queueStatus, onAction,
}: ResultRowProps) {
  return (
    <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-th-elevated group">
      {track.imageUrl ? (
        <img src={track.imageUrl} alt="" className="w-9 h-9 rounded shrink-0 object-cover" loading="lazy" />
      ) : (
        <div className="w-9 h-9 rounded bg-th-elevated flex items-center justify-center shrink-0">
          {track.type === 'episode'
            ? <Mic2 size={12} className="text-th-hi3" />
            : <Music size={12} className="text-th-hi3" />}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-th-hi truncate leading-tight">{track.trackName}</p>
        <p className="text-3xs text-th-hi3 truncate">{track.artistName}</p>
      </div>
      <span className="text-th-hi3 text-3xs tabular-nums shrink-0">{fmtMs(track.durationMs)}</span>
      <div className="flex items-center gap-0.5 shrink-0">
        <ActionButton track={track} onAction={onAction} action="play" status={playStatus} icon={<Play size={13} />} title="Play now" />
        <ActionButton track={track} onAction={onAction} action="queue" status={queueStatus} icon={<Plus size={13} />} title="Add to queue" />
      </div>
    </div>
  );
});

interface SpotifySearchDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SpotifySearchDialog({ open, onClose }: SpotifySearchDialogProps) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);
  const inputRef = useRef<HTMLInputElement>(null);

  // Per-row action status (cleared after 1.5s for visual feedback)
  const [statusMap, setStatusMap] = useState<Record<string, { play?: ActionStatus; queue?: ActionStatus }>>({});

  const search = useSpotifySearch(debouncedQuery, open);
  const devices = useDevices(open);
  const playTrack = usePlayTrack();
  const queueTrack = useQueueTrack();

  const activeDeviceId = useMemo(
    () => devices.data?.find((d) => d.isActive)?.id,
    [devices.data],
  );

  // Reset state + focus input on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setStatusMap({});
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  const setStatus = (trackId: string, action: RowAction, status: ActionStatus) => {
    setStatusMap((prev) => ({
      ...prev,
      [trackId]: { ...prev[trackId], [action]: status },
    }));
    if (status === 'done' || status === 'error') {
      setTimeout(() => {
        setStatusMap((prev) => {
          const row = prev[trackId];
          if (!row) return prev;
          const { [action]: _, ...rest } = row;
          return { ...prev, [trackId]: rest };
        });
      }, 1500);
    }
  };

  const handleAction = (track: SpotifyTrackItem, action: RowAction) => {
    if (track.isLocal) return;
    setStatus(track.trackId, action, 'pending');
    const onDone = () => setStatus(track.trackId, action, 'done');
    const onErr = () => setStatus(track.trackId, action, 'error');

    if (action === 'play') {
      playTrack.mutate(
        { trackUri: track.uri, deviceId: activeDeviceId },
        { onSuccess: onDone, onError: onErr },
      );
    } else {
      queueTrack.mutate(
        { uri: track.uri, deviceId: activeDeviceId },
        { onSuccess: onDone, onError: onErr },
      );
    }
  };

  if (!open) return null;

  const trimmed = debouncedQuery.trim();
  const showResults = trimmed.length >= 2;
  const tracks = search.data?.tracks ?? [];
  const episodes = search.data?.episodes ?? [];
  const hasNoResults = showResults && !search.isLoading && !search.isFetching
    && tracks.length === 0 && episodes.length === 0;

  // Shared Modal (top placement, search header): focus trap, Escape and
  // scroll lock come with it.
  return (
    <Modal
      onClose={onClose}
      placement="top"
      size="lg"
      aria-label="Search Spotify"
      header={
        <>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-th-line">
            <SearchInput
              ref={inputRef}
              variant="bare"
              value={query}
              onChange={setQuery}
              placeholder="Search tracks, podcasts…"
              aria-label="Search tracks and podcasts"
              spellCheck={false}
              className="flex-1"
            />
            {(search.isFetching && showResults) && <Spinner size="sm" label="Searching" className="text-th-hi3" />}
          </div>
          {/* Device hint */}
          {showResults && devices.data && devices.data.length === 0 && (
            <p className="text-th-warn text-3xs px-4 py-1.5 border-b border-th-line">
              Open Spotify on a device to enable playback
            </p>
          )}
        </>
      }
    >
        {/* Results */}
        <div className="-mx-3.5">
          {!showResults && <EmptyState compact title="Type at least 2 characters to search" />}
          {search.isError && (
            <ErrorState compact message="Search failed — try again" onRetry={() => void search.refetch()} retrying={search.isFetching} />
          )}
          {hasNoResults && <EmptyState compact title={`No results for "${trimmed}"`} />}

          {tracks.length > 0 && (
            <>
              <Label className="block text-3xs px-2.5 pt-2 pb-1">
                Tracks
              </Label>
              {tracks.map((t) => (
                <ResultRow
                  key={t.trackId}
                  track={t}
                  playStatus={statusMap[t.trackId]?.play ?? 'idle'}
                  queueStatus={statusMap[t.trackId]?.queue ?? 'idle'}
                  onAction={handleAction}
                />
              ))}
            </>
          )}

          {episodes.length > 0 && (
            <>
              <Label className="block text-3xs px-2.5 pt-3 pb-1">
                Podcasts
              </Label>
              {episodes.map((t) => (
                <ResultRow
                  key={t.trackId}
                  track={t}
                  playStatus={statusMap[t.trackId]?.play ?? 'idle'}
                  queueStatus={statusMap[t.trackId]?.queue ?? 'idle'}
                  onAction={handleAction}
                />
              ))}
            </>
          )}
        </div>
    </Modal>
  );
}
