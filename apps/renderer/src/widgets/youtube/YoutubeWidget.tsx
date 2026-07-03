import { useState, useRef, useEffect } from 'react';
import { Search, X, ArrowLeft, ChevronRight } from 'lucide-react';
import { useYoutubeSearch } from './useYoutube';
import { embedUrl } from '../../lib/apiClient';
import type { YoutubeVideo } from '@dash/shared';

type View = 'home' | 'search';

const CONTROL_BAR_H = 44;

// ── YouTube icon (monochrome) ──────────────────────────────────────────────────

function YoutubeIcon({ size }: { size: number }) {
  return (
    <svg width={Math.round(size * 1.4286)} height={size} viewBox="0 0 20 14" fill="none">
      <rect width="20" height="14" rx="3.1" fill="currentColor" />
      <path d="M8 3.5L8 10.5L14 7L8 3.5Z" fill="white" />
    </svg>
  );
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
          <YoutubeIcon size={iconH} />
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
        <YoutubeIcon size={iconH} />
        <span className="font-semibold tracking-tight text-th-ghost" style={{ fontSize: textSize }}>
          YouTube
        </span>
      </div>
      <button
        onClick={onSearch}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-th-line hover:border-th-3 hover:bg-th-elevated/50 text-th-3 hover:text-th-hi transition-colors text-[11px]"
      >
        <Search size={12} />
        Search videos
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
        placeholder="Search YouTube…"
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

function ResultRow({ video, onPlay }: { video: YoutubeVideo; onPlay: () => void }) {
  return (
    <button
      onClick={onPlay}
      className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-th-elevated/60 transition-colors text-left"
    >
      <img
        src={video.thumbnailUrl}
        alt={video.title}
        className="w-16 h-9 object-cover rounded shrink-0 bg-th-elevated"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <p className="text-th-hi text-[11px] leading-snug line-clamp-2 font-medium">{video.title}</p>
        <p className="text-th-3 text-[10px] mt-0.5 truncate">{video.channelTitle}</p>
      </div>
    </button>
  );
}

// ── Widget root ───────────────────────────────────────────────────────────────

export function YoutubeWidget() {
  const [view, setView] = useState<View>('home');
  const [inputValue, setInputValue] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [selectedVideo, setSelectedVideo] = useState<YoutubeVideo | null>(null);
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

  const { data, isFetching, isError } = useYoutubeSearch(submittedQuery);

  // Clears video and returns to home screen
  const goHome = () => { setSelectedVideo(null); setView('home'); };

  // Plays a video and switches to player view
  const handlePlay = (video: YoutubeVideo) => { setSelectedVideo(video); setView('home'); };

  const handleSubmit = () => {
    const q = inputValue.trim();
    if (!q) return;
    setSubmittedQuery(q);
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  };

  // ── Playing (or playing + search overlay) ────────────────────────────────────
  if (selectedVideo) {
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
            key={selectedVideo.videoId}
            src={embedUrl(`/api/youtube/embed?videoId=${selectedVideo.videoId}`)}
            className="w-full h-full"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
          />
        </div>

        {showSearch ? (
          /* Search overlay while video stays loaded in background */
          <>
            <SearchBar
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              loading={isFetching}
              onBack={() => setView('home')}
            />
            <div ref={resultsRef} className="flex-1 overflow-y-auto min-h-0">
              {!submittedQuery && (
                <div className="flex flex-col items-center justify-center h-full gap-2 p-6">
                  <Search size={18} className="text-th-ghost" />
                  <p className="text-th-ghost text-xs text-center">Search for videos above</p>
                </div>
              )}
              {submittedQuery && isFetching && !data && (
                <p className="text-th-ghost text-xs text-center py-6">Searching…</p>
              )}
              {isError && (
                <p className="text-red-400/70 text-xs text-center py-6">
                  Search failed — check YOUTUBE_API_KEY in .env
                </p>
              )}
              {data?.items.map((video) => (
                <ResultRow key={video.videoId} video={video} onPlay={() => handlePlay(video)} />
              ))}
              {data?.items.length === 0 && (
                <p className="text-th-ghost text-xs text-center py-6">No results</p>
              )}
            </div>
          </>
        ) : (
          /* Control bar */
          <div
            className="flex items-center gap-2 px-3 border-t border-th-line shrink-0"
            style={{ height: CONTROL_BAR_H }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-th-hi text-[11px] font-medium truncate">{selectedVideo.title}</p>
              <p className="text-th-ghost text-[10px] truncate">{selectedVideo.channelTitle}</p>
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
              title="Close video"
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

  // ── Search (no video) ─────────────────────────────────────────────────────────
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
        {!submittedQuery && (
          <div className="flex flex-col items-center justify-center h-full gap-2 p-6">
            <Search size={18} className="text-th-ghost" />
            <p className="text-th-ghost text-xs text-center">Search for videos above</p>
          </div>
        )}
        {submittedQuery && isFetching && !data && (
          <p className="text-th-ghost text-xs text-center py-6">Searching…</p>
        )}
        {isError && (
          <p className="text-red-400/70 text-xs text-center py-6">
            Search failed — check YOUTUBE_API_KEY in .env
          </p>
        )}
        {data?.items.map((video) => (
          <ResultRow key={video.videoId} video={video} onPlay={() => handlePlay(video)} />
        ))}
        {data?.items.length === 0 && (
          <p className="text-th-ghost text-xs text-center py-6">No results</p>
        )}
      </div>
    </div>
  );
}
