import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import {
  Play, Pause, SkipForward, SkipBack,
  Shuffle, Repeat, Repeat1, Volume2, VolumeX,
  Music, ListMusic, ArrowLeft, Monitor, Smartphone, Speaker,
  Heart, RotateCcw, RotateCw, Mic2, Search, LogOut, AlertTriangle,
} from 'lucide-react';
import {
  useSpotifyStatus, useNowPlaying, useSpotifyAuthUrl,
  usePlay, usePause, useNext, usePrevious,
  useSeek, useSpotifyVolume, useShuffle, useRepeat,
  usePlaylistsInfinite, usePlaylistTracksInfinite,
  useDevices, usePlayContext, usePlayTrack, useSpotifyLogout,
} from './useSpotify';
import { SpotifySearchDialog } from './SpotifySearchDialog';
import type { TrackData, SpotifyPlaylist, SpotifyDevice, SpotifyTrackItem } from '@dash/shared';

// ── Size variant ──────────────────────────────────────────────────────────────

// xs  < 200px  compact horizontal, 40px art
// sm  200-300  compact horizontal, 56px art, justify-between to fill
// md  300-400  expanded vertical, art max 110px, compact controls
// lg  400-480  expanded vertical, art max 165px, medium controls
// xl  ≥ 480    expanded vertical, art max 220px, large controls
type SizeVariant = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function DeviceIcon({ type }: { type: string }) {
  if (type === 'Smartphone') return <Smartphone size={11} className="shrink-0" />;
  if (type === 'Speaker') return <Speaker size={11} className="shrink-0" />;
  return <Monitor size={11} className="shrink-0" />;
}

// Infinite scroll sentinel hook
function useIntersectionCallback(cb: () => void, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) cb(); },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

// ── Scrolling text marquee ────────────────────────────────────────────────────
// Only animates when text actually overflows the container.
// Re-measures on text change AND on container resize (SizeVariant transitions).
// Pattern: 2s pause → scroll at 40px/s → 2s pause → instant reset → repeat.

function ScrollingText({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const animRef = useRef<Animation | null>(null);

  // Stable reflow function — cancels any running animation and re-evaluates overflow
  const reflow = useCallback(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    // Cancel previous animation (fill: 'none' default → transform auto-resets)
    if (animRef.current) {
      animRef.current.cancel();
      animRef.current = null;
    }

    const overflow = textEl.scrollWidth - container.clientWidth;
    if (overflow <= 1) return; // fits (1px tolerance for sub-pixel rounding)

    const PAUSE_MS = 2000;
    const scrollMs = (overflow / 40) * 1000; // 40px/s
    const totalMs = PAUSE_MS + scrollMs + PAUSE_MS;
    const p1 = PAUSE_MS / totalMs;
    const p2 = (PAUSE_MS + scrollMs) / totalMs;

    animRef.current = textEl.animate(
      [
        { transform: 'translateX(0)',              offset: 0  },
        { transform: 'translateX(0)',              offset: p1 },
        { transform: `translateX(-${overflow}px)`, offset: p2 },
        { transform: `translateX(-${overflow}px)`, offset: 1  },
      ],
      { duration: totalMs, iterations: Infinity, easing: 'linear' },
    );
  }, []); // stable — reads refs at call time, no captured values

  // Re-measure when text changes
  useLayoutEffect(() => {
    reflow();
    return () => {
      animRef.current?.cancel();
      animRef.current = null;
    };
  }, [text, reflow]);

  // Re-measure when container width changes (covers SizeVariant transitions)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(reflow);
    ro.observe(container);
    return () => ro.disconnect();
  }, [reflow]);

  return (
    <div ref={containerRef} className="overflow-hidden w-full">
      <span ref={textRef} className={`inline-block whitespace-nowrap ${className ?? ''}`}>
        {text}
      </span>
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({
  progressMs, durationMs, isPlaying, onSeek, onTick,
}: {
  progressMs: number;
  durationMs: number;
  isPlaying: boolean;
  onSeek: (ms: number) => void;
  onTick?: (ms: number) => void;
}) {
  const [localMs, setLocalMs] = useState(progressMs);
  const dragging = useRef(false);

  useEffect(() => {
    if (!dragging.current) setLocalMs(progressMs);
  }, [progressMs]);

  // Advance 1s/s while playing so the bar doesn't jump every 3s
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      if (!dragging.current) {
        setLocalMs((prev) => {
          const next = Math.min(prev + 1000, durationMs);
          onTick?.(next);
          return next;
        });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying, durationMs, onTick]);

  const pct = durationMs > 0 ? (localMs / durationMs) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <span className="text-th-3 text-[10px] w-7 text-right tabular-nums">{fmtMs(localMs)}</span>
      <div className="flex-1 relative h-1 group cursor-pointer">
        <input
          type="range" min={0} max={durationMs} value={localMs}
          onChange={(e) => { dragging.current = true; setLocalMs(Number(e.target.value)); }}
          onPointerUp={(e) => {
            dragging.current = false;
            onSeek(Number((e.target as HTMLInputElement).value));
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
        <div className="w-full h-full rounded-full bg-th-overlay">
          <div
            className="h-full rounded-full bg-th-hi group-hover:bg-[#1DB954] transition-colors"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className="text-th-3 text-[10px] w-7 tabular-nums">{fmtMs(durationMs)}</span>
    </div>
  );
}

// ── Volume slider (icon click = mute toggle) ──────────────────────────────────

function VolumeSlider({
  value, onChange, size,
}: {
  value: number;
  onChange: (v: number) => void;
  size: SizeVariant;
}) {
  const [local, setLocal] = useState(value);
  const pointerDown = useRef(false);
  const prevVolume = useRef(value > 0 ? value : 50);

  useEffect(() => {
    if (!pointerDown.current) setLocal(value);
    if (value > 0) prevVolume.current = value;
  }, [value]);

  const handleMuteToggle = () => {
    if (local > 0) {
      prevVolume.current = local;
      setLocal(0);
      onChange(0);
    } else {
      const restore = prevVolume.current > 0 ? prevVolume.current : 50;
      setLocal(restore);
      onChange(restore);
    }
  };

  const iconSize = (size === 'xl' || size === 'lg') ? 14 : 12;
  const sliderW = (size === 'xl' || size === 'lg') ? 'w-24' : 'w-16';

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handleMuteToggle}
        className="text-th-3 hover:text-th-hi transition-colors"
        title={local === 0 ? 'Unmute' : 'Mute'}
      >
        {local === 0
          ? <VolumeX size={iconSize} className="shrink-0" />
          : <Volume2 size={iconSize} className="shrink-0" />}
      </button>
      <input
        type="range" min={0} max={100} value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerDown={() => { pointerDown.current = true; }}
        onPointerUp={() => { pointerDown.current = false; onChange(local); }}
        className={`${sliderW} h-1 rounded-full appearance-none cursor-pointer bg-th-overlay accent-th-accent`}
      />
    </div>
  );
}

// ── Device bar ────────────────────────────────────────────────────────────────

function DeviceBar({
  devices, selectedId, onSelect,
}: {
  devices: SpotifyDevice[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  if (devices.length === 0) return (
    <p className="text-amber-500/70 text-[10px] px-3 pb-1.5">
      Open Spotify on a device to enable playback
    </p>
  );
  return (
    <div className="flex items-center gap-1 flex-wrap px-3 pb-1.5">
      {devices.map((dev) => (
        <button
          key={dev.id}
          onClick={() => onSelect(dev.id)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
            selectedId === dev.id
              ? 'bg-[#1DB954]/15 border-[#1DB954]/40 text-[#1DB954]'
              : 'bg-th-elevated border-th-line text-th-2 hover:text-th-hi'
          }`}
        >
          <DeviceIcon type={dev.type} />
          <span className="max-w-[80px] truncate">{dev.name}</span>
          {dev.isActive && <span className="w-1 h-1 rounded-full bg-[#1DB954] shrink-0" />}
        </button>
      ))}
    </div>
  );
}

// ── Playlist list item ────────────────────────────────────────────────────────

function PlaylistRow({
  playlist,
  onOpen,
  onPlay,
  onShuffle,
}: {
  playlist: SpotifyPlaylist;
  onOpen: () => void;
  onPlay: () => void;
  onShuffle: () => void;
}) {
  const isLiked = playlist.id === 'liked-songs';

  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-th-elevated group transition-colors">
      {/* Thumbnail — click opens track list */}
      <button onClick={onOpen} className="shrink-0 rounded overflow-hidden">
        {isLiked ? (
          <div className="w-10 h-10 rounded flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600">
            <Heart size={16} className="text-white fill-white" />
          </div>
        ) : playlist.imageUrl ? (
          <img src={playlist.imageUrl} alt={playlist.name} className="w-10 h-10 object-cover" />
        ) : (
          <div className="w-10 h-10 rounded bg-th-overlay flex items-center justify-center">
            <Music size={14} className="text-th-3" />
          </div>
        )}
      </button>

      {/* Name + count — click opens track list */}
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className="text-xs text-th-hi truncate font-medium leading-tight">{playlist.name}</p>
        <p className="text-[10px] text-th-3">
          {playlist.trackCount >= 0 ? `${playlist.trackCount} tracks` : ''}
        </p>
      </button>

      {/* Action buttons — always visible */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onShuffle(); }}
          className="p-1 rounded text-th-3 hover:text-[#1DB954] hover:bg-th-overlay transition-colors"
          title="Shuffle play"
        >
          <Shuffle size={11} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onPlay(); }}
          className="p-1 rounded text-th-3 hover:text-[#1DB954] hover:bg-th-overlay transition-colors"
          title="Play"
        >
          <Play size={11} />
        </button>
      </div>
    </div>
  );
}

// ── Track list row ────────────────────────────────────────────────────────────

function TrackRow({
  track,
  index,
  onPlay,
}: {
  track: SpotifyTrackItem;
  index: number;
  onPlay: () => void;
}) {
  return (
    <button
      onClick={onPlay}
      disabled={track.isLocal}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors group ${
        track.isLocal ? 'opacity-40 cursor-not-allowed' : 'hover:bg-th-elevated'
      }`}
    >
      <span className="text-th-ghost text-[10px] w-5 text-right shrink-0 tabular-nums">{index + 1}</span>
      {track.imageUrl ? (
        <img src={track.imageUrl} alt={track.trackName} className="w-7 h-7 rounded shrink-0 object-cover" />
      ) : (
        <div className="w-7 h-7 rounded bg-th-elevated flex items-center justify-center shrink-0">
          {track.type === 'episode'
            ? <Mic2 size={10} className="text-th-ghost" />
            : <Music size={10} className="text-th-ghost" />}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-th-hi truncate leading-tight">{track.trackName}</p>
        <p className="text-[10px] text-th-3 truncate">{track.artistName}</p>
      </div>
      <span className="text-th-ghost text-[10px] tabular-nums shrink-0">{fmtMs(track.durationMs)}</span>
    </button>
  );
}

// ── Playlist panel ────────────────────────────────────────────────────────────

function PlaylistPanel({
  onBack,
}: {
  onBack: () => void;
}) {
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylist | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);
  const [playError, setPlayError] = useState<string | null>(null);

  const playlists = usePlaylistsInfinite(true);
  const tracks = usePlaylistTracksInfinite(selectedPlaylist?.id ?? null);
  const devices = useDevices(true);
  const playContext = usePlayContext();
  const playTrack = usePlayTrack();

  // Auto-select active device
  useEffect(() => {
    const active = devices.data?.find((d) => d.isActive);
    if (active) setSelectedDeviceId((prev) => prev ?? active.id);
  }, [devices.data]);

  // Infinite scroll sentinels
  const playlistSentinel = useIntersectionCallback(() => {
    if (playlists.hasNextPage && !playlists.isFetchingNextPage) {
      void playlists.fetchNextPage();
    }
  }, [playlists.hasNextPage, playlists.isFetchingNextPage]);

  const trackSentinel = useIntersectionCallback(() => {
    if (tracks.hasNextPage && !tracks.isFetchingNextPage) {
      void tracks.fetchNextPage();
    }
  }, [tracks.hasNextPage, tracks.isFetchingNextPage]);

  const allPlaylists = playlists.data?.pages.flatMap((p) => p.items) ?? [];
  const allTracks = tracks.data?.pages.flatMap((p) => p.items) ?? [];

  const onPlayError = (e: unknown) =>
    setPlayError(e instanceof Error ? e.message : 'Playback failed');

  const handlePlayContext = (pl: SpotifyPlaylist, shuffle = false) => {
    setPlayError(null);
    playContext.mutate(
      { contextUri: pl.uri, deviceId: selectedDeviceId, shuffle },
      { onSuccess: onBack, onError: onPlayError },
    );
  };

  const handlePlayTrack = (track: SpotifyTrackItem) => {
    setPlayError(null);
    playTrack.mutate(
      { trackUri: track.uri, contextUri: selectedPlaylist?.uri, deviceId: selectedDeviceId },
      { onSuccess: onBack, onError: onPlayError },
    );
  };

  const showingTracks = selectedPlaylist !== null;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 shrink-0">
        <button
          onClick={() => { if (showingTracks) setSelectedPlaylist(null); else onBack(); }}
          className="text-th-3 hover:text-th-hi transition-colors"
        >
          <ArrowLeft size={13} />
        </button>
        <span className="text-th-2 text-xs font-medium truncate">
          {showingTracks ? selectedPlaylist!.name : 'Your Playlists'}
        </span>
        {showingTracks && (
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <button
              onClick={() => handlePlayContext(selectedPlaylist!, true)}
              className="p-1 rounded text-th-3 hover:text-[#1DB954] hover:bg-th-overlay transition-colors"
              title="Shuffle play"
            >
              <Shuffle size={12} />
            </button>
            <button
              onClick={() => handlePlayContext(selectedPlaylist!, false)}
              className="p-1 rounded text-th-3 hover:text-[#1DB954] hover:bg-th-overlay transition-colors"
              title="Play from beginning"
            >
              <Play size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Device bar */}
      {devices.data && (
        <DeviceBar
          devices={devices.data}
          selectedId={selectedDeviceId}
          onSelect={setSelectedDeviceId}
        />
      )}

      {/* Playback error (e.g. no active device) */}
      {playError && (
        <p className="text-amber-500/80 text-[10px] px-3 pb-1.5">{playError}</p>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0 px-1 pb-2">
        {!showingTracks ? (
          <>
            {playlists.isLoading && (
              <p className="text-th-ghost text-xs text-center py-4">Loading…</p>
            )}
            {playlists.isError && (
              <p className="text-red-400/70 text-xs text-center py-4">Failed — re-auth if scopes changed</p>
            )}
            {allPlaylists.map((pl) => (
              <PlaylistRow
                key={pl.id}
                playlist={pl}
                onOpen={() => setSelectedPlaylist(pl)}
                onPlay={() => handlePlayContext(pl, false)}
                onShuffle={() => handlePlayContext(pl, true)}
              />
            ))}
            <div ref={playlistSentinel} className="h-2" />
            {playlists.isFetchingNextPage && (
              <p className="text-th-ghost text-[10px] text-center pb-1">Loading more…</p>
            )}
          </>
        ) : (
          <>
            {tracks.isLoading && (
              <p className="text-th-ghost text-xs text-center py-4">Loading tracks…</p>
            )}
            {tracks.isError && (
              <p className="text-red-400/70 text-xs text-center py-4">Failed to load tracks</p>
            )}
            {allTracks.map((track, i) => (
              <TrackRow
                key={`${track.trackId}-${i}`}
                track={track}
                index={i}
                onPlay={() => handlePlayTrack(track)}
              />
            ))}
            <div ref={trackSentinel} className="h-2" />
            {tracks.isFetchingNextPage && (
              <p className="text-th-ghost text-[10px] text-center pb-1">Loading more…</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Repeat icon ───────────────────────────────────────────────────────────────

function RepeatIcon({ state }: { state: TrackData['repeatState'] }) {
  if (state === 'track') return <Repeat1 size={14} />;
  return <Repeat size={14} />;
}

function nextRepeatState(current: TrackData['repeatState']): TrackData['repeatState'] {
  if (current === 'off') return 'context';
  if (current === 'context') return 'track';
  return 'off';
}

// ── Now playing ───────────────────────────────────────────────────────────────

function NowPlayingView({
  data,
  size,
  onOpenPlaylists,
  onOpenSearch,
}: {
  data: TrackData;
  size: SizeVariant;
  onOpenPlaylists: () => void;
  onOpenSearch: () => void;
}) {
  const play = usePlay();
  const pause = usePause();
  const next = useNext();
  const previous = usePrevious();
  const seek = useSeek();
  const volume = useSpotifyVolume();
  const shuffle = useShuffle();
  const repeat = useRepeat();

  // Track local progress for ±15s without causing re-renders
  const localProgressRef = useRef(data.progressMs);
  useEffect(() => { localProgressRef.current = data.progressMs; }, [data.progressMs]);

  const handlePlayPause = useCallback(() => {
    if (data.isPlaying) pause.mutate(); else play.mutate();
  }, [data.isPlaying, play, pause]);

  const handleRewind = () => seek.mutate(Math.max(0, localProgressRef.current - 15_000));
  const handleSkipFwd = () => seek.mutate(Math.min(data.durationMs, localProgressRef.current + 15_000));

  const activeClass = (flag: boolean) =>
    flag ? 'text-[#1DB954]' : 'text-th-3 hover:text-th-hi';

  const isPodcast = data.type === 'episode';

  // ── Per-tier sizing tokens ────────────────────────────────────────────────────
  const isExpanded = size === 'md' || size === 'lg' || size === 'xl';

  // Control icon sizes scale up with the tile
  const playBtnCls  = size === 'xl' ? 'w-12 h-12' : size === 'lg' ? 'w-10 h-10' : 'w-9 h-9';
  const playIconSz  = size === 'xl' ? 20 : size === 'lg' ? 18 : 16;
  const skipSz      = size === 'xl' ? 22 : size === 'lg' ? 20 : 17;
  const seekSz      = size === 'xl' ? 18 : size === 'lg' ? 16 : 15;
  const srSz        = size === 'xl' ? 17 : size === 'lg' ? 15 : 14;

  // Art cap for expanded tiers — image is h-full inside a flex-1 container,
  // so this just prevents it from becoming enormous on very tall tiles
  const artMaxH = size === 'xl' ? 'max-h-[220px]' : size === 'lg' ? 'max-h-[165px]' : 'max-h-[110px]';

  // Compact art size
  const compactArtCls = size === 'xs' ? 'w-10 h-10' : 'w-14 h-14';
  const compactMusicSz = size === 'xs' ? 16 : 20;

  // ── Shared action icons ───────────────────────────────────────────────────────
  const actionIcons = (
    <div className="flex items-center gap-1 shrink-0">
      <button onClick={onOpenPlaylists}
        className="text-th-3 hover:text-th-hi transition-colors p-0.5" title="Browse playlists">
        <ListMusic size={14} />
      </button>
      <button onClick={onOpenSearch}
        className="text-th-3 hover:text-th-hi transition-colors p-0.5" title="Search">
        <Search size={13} />
      </button>
    </div>
  );

  // ── Shared controls row ───────────────────────────────────────────────────────
  const controls = (
    <div className="flex items-center justify-between">
      <button onClick={() => shuffle.mutate(!data.shuffleState)}
        className={`transition-colors ${activeClass(data.shuffleState)}`} title="Shuffle">
        <Shuffle size={srSz} />
      </button>
      <div className="flex items-center gap-3">
        <button onClick={handleRewind}
          className="text-th-3 hover:text-th-hi transition-colors relative" title="Rewind 15s">
          <RotateCcw size={seekSz} />
          <span className="absolute inset-0 flex items-center justify-center text-[6px] font-bold text-current mt-1.5 ml-0.5">15</span>
        </button>
        <button onClick={() => previous.mutate()}
          className="text-th-2 hover:text-th-hi transition-colors" title="Previous">
          <SkipBack size={skipSz} />
        </button>
        <button onClick={handlePlayPause}
          className={`${playBtnCls} rounded-full bg-th-hi hover:bg-th-hi/80 text-th-bg flex items-center justify-center`}
          title={data.isPlaying ? 'Pause' : 'Play'}>
          {data.isPlaying
            ? <Pause size={playIconSz} fill="currentColor" />
            : <Play size={playIconSz} fill="currentColor" className="ml-0.5" />}
        </button>
        <button onClick={() => next.mutate()}
          className="text-th-2 hover:text-th-hi transition-colors" title="Next">
          <SkipForward size={skipSz} />
        </button>
        <button onClick={handleSkipFwd}
          className="text-th-3 hover:text-th-hi transition-colors relative" title="Skip forward 15s">
          <RotateCw size={seekSz} />
          <span className="absolute inset-0 flex items-center justify-center text-[6px] font-bold text-current mt-1.5 mr-0.5">15</span>
        </button>
      </div>
      <button onClick={() => repeat.mutate(nextRepeatState(data.repeatState))}
        className={`transition-colors ${activeClass(data.repeatState !== 'off')}`}
        title={`Repeat: ${data.repeatState}`}>
        <RepeatIcon state={data.repeatState} />
      </button>
    </div>
  );

  const progressBar = (
    <ProgressBar
      progressMs={data.progressMs}
      durationMs={data.durationMs}
      isPlaying={data.isPlaying}
      onSeek={(ms) => { localProgressRef.current = ms; seek.mutate(ms); }}
      onTick={(ms) => { localProgressRef.current = ms; }}
    />
  );

  // ── Expanded layout (md / lg / xl) ───────────────────────────────────────────
  // Title pinned top, album art in flex-1 grow zone, controls pinned bottom
  if (isExpanded) {
    return (
      <div className="flex-1 flex flex-col px-4 pt-3 pb-4 gap-2">
        {/* Title + artist + action icons */}
        <div className="flex items-start gap-2 shrink-0">
          <div className="min-w-0 flex-1">
            <ScrollingText
              text={data.trackName || '—'}
              className={`font-medium text-th-hi leading-tight ${size === 'xl' ? 'text-base' : 'text-sm'}`}
            />
            <div className="mt-0.5">
              <ScrollingText text={data.artistName} className="text-xs text-th-2" />
            </div>
          </div>
          {actionIcons}
        </div>

        {/* Album art — flex-1 so it grows to fill remaining space */}
        <div className="flex-1 flex items-center justify-center min-h-0">
          {data.albumArtUrl ? (
            <img
              src={data.albumArtUrl}
              alt={data.trackName}
              className={`h-full ${artMaxH} aspect-square object-cover rounded-lg shadow-lg`}
            />
          ) : (
            <div className={`h-full ${artMaxH} aspect-square rounded-lg bg-th-elevated flex items-center justify-center`}>
              {isPodcast
                ? <Mic2 size={size === 'xl' ? 48 : 32} className="text-th-ghost" />
                : <Music size={size === 'xl' ? 48 : 32} className="text-th-ghost" />}
            </div>
          )}
        </div>

        {/* Album / podcast label */}
        {!isPodcast && data.albumName && (
          <p className="text-th-ghost text-[10px] truncate text-center shrink-0 -mt-1">{data.albumName}</p>
        )}
        {isPodcast && (
          <p className="text-[10px] text-purple-400/70 text-center shrink-0 -mt-1">Podcast</p>
        )}

        <div className="shrink-0">{progressBar}</div>
        <div className="shrink-0">{controls}</div>
        <div className="flex justify-end shrink-0">
          <VolumeSlider size={size} value={data.volumePercent} onChange={(v) => volume.mutate(v)} />
        </div>
      </div>
    );
  }

  // ── Compact layout (xs / sm) ─────────────────────────────────────────────────
  // justify-between pushes info to top and progress+controls to bottom,
  // filling the container height naturally at any compact size
  const artEl = data.albumArtUrl ? (
    <img src={data.albumArtUrl} alt={data.trackName}
      className={`${compactArtCls} rounded-md object-cover shrink-0`} />
  ) : (
    <div className={`${compactArtCls} rounded-md bg-th-elevated shrink-0 flex items-center justify-center`}>
      {isPodcast
        ? <Mic2 size={compactMusicSz} className="text-th-ghost" />
        : <Music size={compactMusicSz} className="text-th-ghost" />}
    </div>
  );

  // xs: pack everything together in the centre — no wasted gap
  // sm: justify-between fills the taller height naturally
  const compactJustify = size === 'xs' ? 'justify-center gap-3' : 'justify-between';

  return (
    <div className={`flex-1 flex flex-col ${compactJustify} px-4 pb-4 pt-2`}>
      {/* Top: art + track info */}
      <div className="flex gap-3 items-center min-w-0">
        {artEl}
        <div className="min-w-0 flex-1">
          <ScrollingText text={data.trackName || '—'} className="text-th-hi text-sm font-medium leading-tight" />
          <div className="mt-0.5">
            <ScrollingText text={data.artistName} className="text-th-2 text-xs" />
          </div>
          {!isPodcast && data.albumName && (
            <ScrollingText text={data.albumName} className="text-th-ghost text-xs" />
          )}
          {isPodcast && <p className="text-[10px] text-purple-400/70 mt-0.5">Podcast</p>}
        </div>
        <div className="self-start mt-0.5">{actionIcons}</div>
      </div>

      {/* Bottom: progress + controls + volume */}
      <div className="flex flex-col gap-2">
        {progressBar}
        {controls}
        <div className="flex justify-end">
          <VolumeSlider size={size} value={data.volumePercent} onChange={(v) => volume.mutate(v)} />
        </div>
      </div>
    </div>
  );
}

// ── Nothing playing ───────────────────────────────────────────────────────────

function NotPlayingView({
  onOpenPlaylists,
  onOpenSearch,
}: {
  onOpenPlaylists: () => void;
  onOpenSearch: () => void;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-6">
      <div className="w-12 h-12 rounded-lg bg-th-elevated flex items-center justify-center">
        <Music size={20} className="text-th-ghost" />
      </div>
      <p className="text-th-3 text-xs">Nothing playing</p>
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenPlaylists}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-th-elevated hover:bg-th-overlay text-th-hi text-xs transition-colors"
        >
          <ListMusic size={12} />
          Browse playlists
        </button>
        <button
          onClick={onOpenSearch}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-th-elevated hover:bg-th-overlay text-th-hi text-xs transition-colors"
        >
          <Search size={12} />
          Search
        </button>
      </div>
    </div>
  );
}

// ── Logout button (rendered in WidgetShell header via DashboardGrid) ──────────

export function SpotifyLogoutButton() {
  const { data: status } = useSpotifyStatus();
  const logout = useSpotifyLogout();
  const [confirming, setConfirming] = useState(false);

  if (!status?.authenticated) return null;

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        title="Disconnect Spotify"
        className="p-1 rounded text-th-ghost hover:text-red-400 hover:bg-red-400/10 transition-colors"
      >
        <LogOut size={11} />
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setConfirming(false)}
        >
          <div
            className="bg-th-surface border border-th-line rounded-xl p-6 w-80 shadow-2xl flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <AlertTriangle size={18} className="text-red-400 shrink-0" />
              <p className="text-th-hi text-sm font-medium">Disconnect Spotify?</p>
            </div>
            <p className="text-th-3 text-xs leading-relaxed">
              This will clear your saved tokens. You'll need to reconnect to see what's playing.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirming(false)}
                className="px-3 py-1.5 text-xs rounded-lg border border-th-line text-th-3 hover:text-th-hi hover:border-th-hi transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { logout.mutate(); setConfirming(false); }}
                disabled={logout.isPending}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Connect ───────────────────────────────────────────────────────────────────

function ConnectView({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-6">
      <div className="w-14 h-14 rounded-full bg-[#1DB954]/10 flex items-center justify-center">
        <Music size={24} className="text-[#1DB954]" />
      </div>
      <div className="text-center">
        <p className="text-th-hi font-medium text-sm">Spotify</p>
        <p className="text-th-3 text-xs mt-1">Connect your account to see what's playing</p>
      </div>
      <button
        onClick={onConnect}
        className="px-4 py-2 rounded-full bg-[#1DB954] hover:bg-[#1ed760] text-black text-xs font-bold transition-colors"
      >
        Connect Spotify
      </button>
    </div>
  );
}

// ── Widget root ───────────────────────────────────────────────────────────────

export function SpotifyWidget() {
  const status = useSpotifyStatus();
  // Only poll now-playing once authenticated — avoids a 401/502 every 3s on the
  // login screen before the user has connected.
  const nowPlaying = useNowPlaying(status.data?.authenticated === true);
  const authUrlQuery = useSpotifyAuthUrl();
  const [showPlaylists, setShowPlaylists] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Responsive sizing via a callback ref + useEffect([containerEl]).
  //
  // WHY not useRef + useLayoutEffect([]): the component has conditional early
  // returns for loading/auth states. Those views don't render the container div,
  // so containerRef.current is null on first mount. useLayoutEffect([]) fires
  // once — on null — and never re-runs once the real element appears.
  //
  // Callback ref (setContainerEl) is called by React whenever the element
  // mounts/unmounts, updating the state and re-triggering the effect with the
  // real element.
  //
  // WHY retry RAF loop instead of a single RAF: Chromium on macOS can return 0
  // from getBoundingClientRect for multiple frames while the flex grid row is
  // compositing. We keep retrying until we get a real height, then hand off
  // to the ResizeObserver for all future updates.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<SizeVariant>('sm');

  const classify = (h: number): SizeVariant => {
    if (h < 200) return 'xs';
    if (h < 300) return 'sm';
    if (h < 400) return 'md';
    if (h < 480) return 'lg';
    return 'xl';
  };

  useEffect(() => {
    if (!containerEl) return;

    let rafId: number;
    const tryMeasure = () => {
      const h = containerEl.getBoundingClientRect().height;
      if (h > 0) {
        setSize(classify(h));
      } else {
        rafId = requestAnimationFrame(tryMeasure); // retry until layout settles
      }
    };
    rafId = requestAnimationFrame(tryMeasure);

    const ro = new ResizeObserver(([entry]) => {
      setSize(classify(entry.contentRect.height));
    });
    ro.observe(containerEl);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [containerEl]);

  const handleConnect = useCallback(async () => {
    const result = await authUrlQuery.refetch();
    if (result.data?.url) window.electron.openSpotifyAuth(result.data.url);
  }, [authUrlQuery]);

  if (status.isLoading) {
    return (
      <div className="rounded-lg border border-th-line bg-th-surface h-full flex items-center justify-center">
        <span className="text-th-ghost text-xs">Connecting…</span>
      </div>
    );
  }

  if (!status.data?.authenticated) {
    return (
      <div className="rounded-lg border border-th-line bg-th-surface h-full">
        <ConnectView onConnect={handleConnect} />
      </div>
    );
  }

  const track = nowPlaying.data;
  const hasTrack = Boolean(track?.trackId);

  return (
    <>
      <div
        ref={setContainerEl}
        className="rounded-lg border border-th-line bg-th-surface h-full flex flex-col overflow-hidden"
      >
        <div className="flex-1 min-h-0 flex flex-col">
          {showPlaylists ? (
            <PlaylistPanel onBack={() => setShowPlaylists(false)} />
          ) : hasTrack ? (
            <NowPlayingView
              data={track!}
              size={size}
              onOpenPlaylists={() => setShowPlaylists(true)}
              onOpenSearch={() => setShowSearch(true)}
            />
          ) : (
            <NotPlayingView
              onOpenPlaylists={() => setShowPlaylists(true)}
              onOpenSearch={() => setShowSearch(true)}
            />
          )}
        </div>
      </div>

      <SpotifySearchDialog open={showSearch} onClose={() => setShowSearch(false)} />
    </>
  );
}
