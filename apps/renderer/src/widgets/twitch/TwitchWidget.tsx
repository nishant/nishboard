import { useState, useRef, useEffect } from 'react';
import { Search, X, ArrowLeft, ChevronRight } from 'lucide-react';
import { useTwitchSearch } from './useTwitch';
import { embedUrl } from '../../lib/apiClient';
import type { TwitchChannel } from '@dash/shared';

type View = 'home' | 'search';

const CONTROL_BAR_H = 44;

// ── Twitch icon (monochrome, simple-icons glyph) ───────────────────────────────

function TwitchIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
    </svg>
  );
}

// ── Live dot ────────────────────────────────────────────────────────────────────

function LiveDot() {
  return <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0 animate-pulse" />;
}

// ── Home screen ───────────────────────────────────────────────────────────────

function HomeScreen({ onSearch, height }: { onSearch: () => void; height: number }) {
  const iconH = Math.max(14, Math.min(28, Math.round(height * 0.08)));
  const textSize = Math.max(10, Math.min(20, Math.round(iconH * 0.85)));
  const compact = height < 120;

  if (compact) {
    return (
      <div className="flex items-center justify-center h-full gap-3">
        <div className="text-th-ghost">
          <TwitchIcon size={iconH} />
        </div>
        <button
          onClick={onSearch}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-th-line hover:border-th-3 text-th-3 hover:text-th-hi transition-colors text-[10px]"
        >
          <Search size={10} />
          Search
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5">
      <div className="flex items-center gap-2.5 text-th-ghost">
        <TwitchIcon size={iconH} />
        <span className="font-semibold tracking-tight text-th-ghost" style={{ fontSize: textSize }}>
          Twitch
        </span>
      </div>
      <button
        onClick={onSearch}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-th-line hover:border-th-3 hover:bg-th-elevated/50 text-th-3 hover:text-th-hi transition-colors text-[11px]"
      >
        <Search size={12} />
        Search channels
      </button>
    </div>
  );
}

// ── Search bar ────────────────────────────────────────────────────────────────

function SearchBar({
  value, onChange, onSubmit, loading, onBack,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b border-th-line shrink-0">
      <button onClick={onBack} className="text-th-ghost hover:text-th-2 transition-colors shrink-0">
        <ArrowLeft size={12} />
      </button>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
        placeholder="Search Twitch…"
        className="flex-1 bg-transparent text-th-hi text-xs placeholder-zinc-600 outline-none"
        autoFocus
      />
      {value && (
        <button onClick={() => onChange('')} className="text-th-ghost hover:text-th-2 transition-colors">
          <X size={11} />
        </button>
      )}
      <button
        onClick={onSubmit}
        disabled={!value.trim() || loading}
        className="text-th-3 hover:text-th-hi disabled:opacity-30 transition-colors"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

// ── Result row ────────────────────────────────────────────────────────────────

function ResultRow({ channel, onPlay }: { channel: TwitchChannel; onPlay: () => void }) {
  return (
    <button
      onClick={onPlay}
      className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-th-elevated/60 transition-colors text-left"
    >
      <img
        src={channel.thumbnailUrl}
        alt={channel.displayName}
        className="w-9 h-9 object-cover rounded-full shrink-0 bg-th-elevated"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {channel.isLive && <LiveDot />}
          <p className="text-th-hi text-[11px] leading-snug truncate font-medium">{channel.displayName}</p>
        </div>
        <p className="text-th-3 text-[10px] mt-0.5 truncate">
          {channel.isLive ? (channel.gameName || channel.title || 'Live') : 'Offline'}
        </p>
      </div>
    </button>
  );
}

// ── Widget root ───────────────────────────────────────────────────────────────

export function TwitchWidget() {
  const [view, setView] = useState<View>('home');
  const [inputValue, setInputValue] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [selectedChannel, setSelectedChannel] = useState<TwitchChannel | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerEl) return;
    let rafId: number;
    const tryMeasure = () => {
      const h = containerEl.getBoundingClientRect().height;
      if (h > 0) setHeight(h);
      else rafId = requestAnimationFrame(tryMeasure);
    };
    rafId = requestAnimationFrame(tryMeasure);
    const ro = new ResizeObserver(([e]) => setHeight(e.contentRect.height));
    ro.observe(containerEl);
    return () => { cancelAnimationFrame(rafId); ro.disconnect(); };
  }, [containerEl]);

  const { data, isFetching, isError } = useTwitchSearch(submittedQuery);

  // Clears channel and returns to home screen
  const goHome = () => { setSelectedChannel(null); setView('home'); };

  // Plays a channel and switches to player view
  const handlePlay = (channel: TwitchChannel) => { setSelectedChannel(channel); setView('home'); };

  const handleSubmit = () => {
    const q = inputValue.trim();
    if (!q) return;
    setSubmittedQuery(q);
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  };

  const results = (
    <>
      {!submittedQuery && (
        <div className="flex flex-col items-center justify-center h-full gap-2 p-6">
          <Search size={18} className="text-th-ghost" />
          <p className="text-th-ghost text-xs text-center">Search for channels above</p>
        </div>
      )}
      {submittedQuery && isFetching && !data && (
        <p className="text-th-ghost text-xs text-center py-6">Searching…</p>
      )}
      {isError && (
        <p className="text-red-400/70 text-xs text-center py-6">
          Search failed — check TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET in .env
        </p>
      )}
      {data?.items.map((channel) => (
        <ResultRow key={channel.id} channel={channel} onPlay={() => handlePlay(channel)} />
      ))}
      {data?.items.length === 0 && (
        <p className="text-th-ghost text-xs text-center py-6">No results</p>
      )}
    </>
  );

  // ── Playing (or playing + search overlay) ────────────────────────────────────
  if (selectedChannel) {
    const showSearch = view === 'search';
    const iframeH = Math.max(60, height - CONTROL_BAR_H);

    return (
      <div ref={setContainerEl} className="h-full flex flex-col overflow-hidden">
        {/*
          Iframe kept mounted at height=0 while search is open so playback
          position is preserved when the user returns to the player.
        */}
        <div className="shrink-0 overflow-hidden" style={{ height: showSearch ? 0 : iframeH }}>
          <iframe
            key={selectedChannel.login}
            src={embedUrl(`/api/twitch/embed?channel=${selectedChannel.login}`)}
            className="w-full h-full"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
          />
        </div>

        {showSearch ? (
          /* Search overlay while stream stays loaded in background */
          <>
            <SearchBar
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              loading={isFetching}
              onBack={() => setView('home')}
            />
            <div ref={resultsRef} className="flex-1 overflow-y-auto min-h-0">
              {results}
            </div>
          </>
        ) : (
          /* Control bar */
          <div
            className="flex items-center gap-2 px-3 border-t border-th-line shrink-0"
            style={{ height: CONTROL_BAR_H }}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                {selectedChannel.isLive && <LiveDot />}
                <p className="text-th-hi text-[11px] font-medium truncate">{selectedChannel.displayName}</p>
              </div>
              <p className="text-th-ghost text-[10px] truncate">
                {selectedChannel.gameName || selectedChannel.title || (selectedChannel.isLive ? 'Live' : 'Offline')}
              </p>
            </div>
            <button
              onClick={() => setView('search')}
              title="Search"
              className="text-th-ghost hover:text-th-hi transition-colors shrink-0"
            >
              <Search size={13} />
            </button>
            <button
              onClick={goHome}
              title="Close stream"
              className="text-th-ghost hover:text-th-hi transition-colors shrink-0"
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Home ──────────────────────────────────────────────────────────────────────
  if (view === 'home') {
    return (
      <div ref={setContainerEl} className="h-full overflow-hidden">
        <HomeScreen onSearch={() => setView('search')} height={height} />
      </div>
    );
  }

  // ── Search (no stream) ──────────────────────────────────────────────────────────
  return (
    <div ref={setContainerEl} className="h-full flex flex-col overflow-hidden">
      <SearchBar
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        loading={isFetching}
        onBack={goHome}
      />
      <div ref={resultsRef} className="flex-1 overflow-y-auto min-h-0">
        {results}
      </div>
    </div>
  );
}
