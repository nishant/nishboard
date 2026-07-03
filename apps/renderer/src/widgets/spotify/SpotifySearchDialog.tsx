import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { Search, Play, Plus, X, Music, Mic2, Check, Loader2 } from 'lucide-react';
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

const ResultRow = memo(function ResultRow({
  track, playStatus, queueStatus, onAction,
}: ResultRowProps) {
  const ActionButton = ({
    action, status, icon, title,
  }: {
    action: RowAction;
    status: ActionStatus;
    icon: React.ReactNode;
    title: string;
  }) => (
    <button
      onClick={(e) => { e.stopPropagation(); onAction(track, action); }}
      disabled={track.isLocal || status === 'pending'}
      className={`p-1.5 rounded transition-colors ${
        status === 'done'
          ? 'text-[#1DB954]'
          : status === 'error'
          ? 'text-red-400'
          : 'text-th-3 hover:text-[#1DB954] hover:bg-th-elevated'
      } ${track.isLocal ? 'opacity-30 cursor-not-allowed' : ''}`}
      title={title}
    >
      {status === 'pending'
        ? <Loader2 size={13} className="animate-spin" />
        : status === 'done'
        ? <Check size={13} />
        : icon}
    </button>
  );

  return (
    <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-th-elevated/60 group">
      {track.imageUrl ? (
        <img src={track.imageUrl} alt="" className="w-9 h-9 rounded shrink-0 object-cover" loading="lazy" />
      ) : (
        <div className="w-9 h-9 rounded bg-th-elevated flex items-center justify-center shrink-0">
          {track.type === 'episode'
            ? <Mic2 size={12} className="text-th-ghost" />
            : <Music size={12} className="text-th-ghost" />}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-th-hi truncate leading-tight">{track.trackName}</p>
        <p className="text-[10px] text-th-3 truncate">{track.artistName}</p>
      </div>
      <span className="text-th-ghost text-[10px] tabular-nums shrink-0">{fmtMs(track.durationMs)}</span>
      <div className="flex items-center gap-0.5 shrink-0">
        <ActionButton action="play" status={playStatus} icon={<Play size={13} />} title="Play now" />
        <ActionButton action="queue" status={queueStatus} icon={<Plus size={13} />} title="Add to queue" />
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

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-th-line bg-th-surface shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-th-line shrink-0">
          <Search size={16} className="text-th-3 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tracks, podcasts…"
            className="flex-1 bg-transparent text-th-hi text-sm placeholder:text-th-ghost focus:outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          {(search.isFetching && showResults) && (
            <Loader2 size={14} className="text-th-3 animate-spin shrink-0" />
          )}
          <button
            onClick={onClose}
            className="text-th-3 hover:text-th-hi transition-colors shrink-0"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Device hint */}
        {showResults && devices.data && devices.data.length === 0 && (
          <p className="text-amber-500/70 text-[10px] px-4 py-1.5 border-b border-th-line/50 shrink-0">
            Open Spotify on a device to enable playback
          </p>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto min-h-0 p-1.5">
          {!showResults && (
            <p className="text-th-ghost text-xs text-center py-8">
              Type at least 2 characters to search
            </p>
          )}
          {search.isError && (
            <p className="text-red-400/70 text-xs text-center py-8">
              Search failed — try again
            </p>
          )}
          {hasNoResults && (
            <p className="text-th-ghost text-xs text-center py-8">No results for "{trimmed}"</p>
          )}

          {tracks.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-wider text-th-ghost px-2.5 pt-2 pb-1 font-medium">
                Tracks
              </p>
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
              <p className="text-[10px] uppercase tracking-wider text-th-ghost px-2.5 pt-3 pb-1 font-medium">
                Podcasts
              </p>
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
      </div>
    </div>,
    document.body,
  );
}
