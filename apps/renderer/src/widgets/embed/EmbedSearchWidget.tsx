import { useState, useRef } from 'react';
import { Search, X, ArrowLeft, ChevronRight, ListVideo } from 'lucide-react';
import { useElementSize } from '../../hooks/useElementSize';
import type { EmbedItem, EmbedFolder, EmbedFoldersState, EmbedServiceAdapter, EmbedBrowse, EmbedSearchState } from './types';
import { Button, EmptyState, ErrorState, IconButton, SkeletonLines, StatusDot, Tabs } from '@nish/ui';
import { SearchInput } from '../../components/nishGaps';

// Stable no-op hooks so BrowseHome can call the (optional) folder hooks
// unconditionally — the selection is fixed per adapter, so hook order is stable.
const NO_FOLDERS: EmbedFoldersState = { folders: undefined, isFetching: false, isError: false };
const NO_ITEMS: EmbedSearchState = { items: undefined, isFetching: false, isError: false };
function useNoFolders(_tabId: string, _enabled: boolean): EmbedFoldersState { return NO_FOLDERS; }
function useNoFolderItems(_folder: EmbedFolder | null): EmbedSearchState { return NO_ITEMS; }

type View = 'home' | 'search';

const CONTROL_BAR_H = 44;

function LiveDot() {
  return <StatusDot tone="loss" size="xs" pulse label="Live" className="shrink-0" />;
}

// ── Home screen ───────────────────────────────────────────────────────────────

function HomeScreen({
  adapter, onSearch, height,
}: {
  adapter: EmbedServiceAdapter;
  onSearch: () => void;
  height: number;
}) {
  const iconH = Math.max(14, Math.min(28, Math.round(height * 0.08)));
  const textSize = Math.max(10, Math.min(20, Math.round(iconH * 0.85)));
  const compact = height < 120;

  if (compact) {
    return (
      <div className="flex items-center justify-center h-full gap-3">
        <div className="text-th-hi3">
          <adapter.Icon size={iconH} />
        </div>
        <Button size="xs" icon={<Search size={10} />} onClick={onSearch} className="rounded-full">
          Search
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5">
      <div className="flex items-center gap-2.5 text-th-hi3">
        <adapter.Icon size={iconH} />
        <span className="font-semibold tracking-tight text-th-hi3" style={{ fontSize: textSize }}>
          {adapter.serviceName}
        </span>
      </div>
      <Button size="xs" icon={<Search size={12} />} onClick={onSearch} className="rounded-full">
        {adapter.homeCta}
      </Button>
    </div>
  );
}

// ── Browse home (tab strip + rows) ───────────────────────────────────────────
// Rendered instead of the hero when the adapter has a browse extension and the
// tile is tall enough for rows to be useful.

function FolderRow({ folder, onOpen }: { folder: EmbedFolder; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-th-elevated transition-colors text-left"
    >
      {folder.thumbnailUrl ? (
        <img
          src={folder.thumbnailUrl}
          alt={folder.title}
          className="w-16 h-9 object-cover rounded shrink-0 bg-th-elevated"
          loading="lazy"
        />
      ) : (
        <div className="w-16 h-9 rounded shrink-0 bg-th-elevated flex items-center justify-center">
          <ListVideo size={14} className="text-th-hi3" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-th-hi text-[11px] leading-snug line-clamp-2 font-medium">{folder.title}</p>
        {folder.subtitle && <p className="text-th-hi3 text-[10px] mt-0.5 truncate">{folder.subtitle}</p>}
      </div>
      <ChevronRight size={13} className="text-th-hi3 shrink-0" />
    </button>
  );
}

function BrowseHome({
  adapter, browse, onSearch, onPlay, folder, onOpenFolder,
}: {
  adapter: EmbedServiceAdapter;
  browse: EmbedBrowse;
  onSearch: () => void;
  onPlay: (item: EmbedItem) => void;
  folder: EmbedFolder | null;
  onOpenFolder: (folder: EmbedFolder | null) => void;
}) {
  const [tabId, setTabId] = useState(browse.tabs[0]?.id ?? '');
  const activeTab = browse.tabs.find((t) => t.id === tabId);
  const isFolderTab = activeTab?.kind === 'folders';

  // Optional hooks resolved to stable no-ops — selection never changes for a
  // given adapter, so this preserves hook order.
  const useFolders = browse.useFolders ?? useNoFolders;
  const useFolderItems = browse.useFolderItems ?? useNoFolderItems;

  const videoState = browse.useBrowse(tabId, tabId !== '' && !isFolderTab && folder === null);
  const foldersState = useFolders(tabId, isFolderTab && folder === null);
  const folderItems = useFolderItems(folder);

  // ── Open folder: back header + its items ──────────────────────────────────
  if (folder !== null) {
    const { items, isFetching, isError } = folderItems;
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-th-line shrink-0">
          <IconButton label="Back" size="xs" onClick={() => onOpenFolder(null)}>
            <ArrowLeft size={12} />
          </IconButton>
          <span className="text-th-hi2 text-[11px] font-medium truncate">{folder.title}</span>
          <IconButton label={adapter.searchPlaceholder} size="xs" onClick={onSearch} className="ml-auto">
            <Search size={12} />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {isFetching && !items && <SkeletonLines lines={4} />}
          {isError && <ErrorState compact message={adapter.errorHint} />}
          {items?.map((item) => (
            <ResultRow key={item.id} item={item} thumbShape={adapter.thumbShape} onPlay={() => onPlay(item)} />
          ))}
          {items?.length === 0 && <EmptyState compact title="Nothing here" />}
        </div>
      </div>
    );
  }

  const items = isFolderTab ? undefined : videoState.items;
  const folders = isFolderTab ? foldersState.folders : undefined;
  const isFetching = isFolderTab ? foldersState.isFetching : videoState.isFetching;
  const isError = isFolderTab ? foldersState.isError : videoState.isError;
  const hint = isFolderTab ? foldersState.hint : videoState.hint;
  const empty = isFolderTab ? folders?.length === 0 : items?.length === 0;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-th-line shrink-0">
        <Tabs
          label="Browse"
          variant="pill"
          size="sm"
          value={tabId}
          onChange={setTabId}
          items={browse.tabs.map((t) => ({ value: t.id, label: t.label }))}
          className="min-w-0 flex-1"
        />
        <IconButton label={adapter.searchPlaceholder} size="xs" onClick={onSearch} className="ml-auto">
          <Search size={12} />
        </IconButton>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {!items && !folders && !isFetching && !isError && hint && <EmptyState compact title={hint} />}
        {isFetching && !items && !folders && <SkeletonLines lines={4} />}
        {isError && <ErrorState compact message={adapter.errorHint} />}
        {folders?.map((f) => (
          <FolderRow key={f.id} folder={f} onOpen={() => onOpenFolder(f)} />
        ))}
        {items?.map((item) => (
          <ResultRow
            key={item.id}
            item={item}
            thumbShape={adapter.thumbShape}
            onPlay={() => onPlay(item)}
            onOpenChannel={browse.useFolderItems ? onOpenFolder : undefined}
          />
        ))}
        {empty && <EmptyState compact title="Nothing here right now" />}
      </div>
    </div>
  );
}

// ── Search bar ────────────────────────────────────────────────────────────────

function SearchBar({
  placeholder, value, onChange, onSubmit, loading, onBack,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-th-line shrink-0">
      <IconButton label="Back" size="xs" onClick={onBack}>
        <ArrowLeft size={12} />
      </IconButton>
      <SearchInput
        size="xs"
        variant="bare"
        value={value}
        onChange={onChange}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex-1"
        autoFocus
      />
      <IconButton label="Search" size="xs" onClick={onSubmit} disabled={!value.trim() || loading}>
        <ChevronRight size={14} />
      </IconButton>
    </div>
  );
}

// ── Result row ────────────────────────────────────────────────────────────────

function ResultRow({
  item, thumbShape, onPlay, onOpenChannel,
}: {
  item: EmbedItem;
  thumbShape: 'wide' | 'round';
  onPlay: () => void;
  /** When set and the item carries a channel, the subtitle opens the channel's
   *  uploads folder instead of playing the row. */
  onOpenChannel?: (folder: EmbedFolder) => void;
}) {
  const channelClickable = onOpenChannel !== undefined && item.channel !== undefined;
  return (
    <button
      onClick={onPlay}
      className="flex items-center gap-2.5 w-full px-3 py-2 hover:bg-th-elevated transition-colors text-left"
    >
      <img
        src={item.thumbnailUrl}
        alt={item.title}
        className={
          thumbShape === 'wide'
            ? 'w-16 h-9 object-cover rounded shrink-0 bg-th-elevated'
            : 'w-9 h-9 object-cover rounded-full shrink-0 bg-th-elevated'
        }
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {item.isLive && <LiveDot />}
          <p className="text-th-hi text-[11px] leading-snug line-clamp-2 font-medium">{item.title}</p>
        </div>
        {channelClickable ? (
          <span
            role="link"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onOpenChannel!({ id: `channel:${item.channel!.id}`, title: item.channel!.title });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                onOpenChannel!({ id: `channel:${item.channel!.id}`, title: item.channel!.title });
              }
            }}
            className="inline-block text-th-hi3 text-[10px] mt-0.5 truncate max-w-full hover:text-th-hi hover:underline"
            title={`${item.channel!.title} — videos`}
          >
            {item.subtitle}
          </span>
        ) : (
          <p className="text-th-hi3 text-[10px] mt-0.5 truncate">{item.subtitle}</p>
        )}
      </div>
    </button>
  );
}

// ── Widget root ───────────────────────────────────────────────────────────────
// One state machine for every search-and-embed service (YouTube, Twitch):
// home ↔ search, plus a playing state where the iframe is KEPT MOUNTED at
// height 0 while the search overlay is open so playback position survives.

export function EmbedSearchWidget({ adapter }: { adapter: EmbedServiceAdapter }) {
  const [view, setView] = useState<View>('home');
  const [inputValue, setInputValue] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<EmbedItem | null>(null);
  const [folder, setFolder] = useState<EmbedFolder | null>(null);
  const { ref: setContainerEl, height } = useElementSize<HTMLDivElement>();
  const resultsRef = useRef<HTMLDivElement>(null);

  const { items, isFetching, isError } = adapter.useSearch(submittedQuery);

  const goHome = () => { setSelectedItem(null); setView('home'); };
  const handlePlay = (item: EmbedItem) => { setSelectedItem(item); setView('home'); };
  // Opening a folder (channel uploads / playlist) always lands on the browse
  // home — including from search results or the playing overlay (closes player).
  const openFolder = (f: EmbedFolder | null) => {
    setFolder(f);
    if (f !== null) { setSelectedItem(null); setView('home'); }
  };
  const channelClicks = adapter.browse?.useFolderItems ? openFolder : undefined;

  const handleSubmit = () => {
    const q = inputValue.trim();
    if (!q) return;
    setSubmittedQuery(q);
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  };

  const results = (
    <>
      {!submittedQuery && (
        <EmptyState compact className="h-full" icon={<Search size={18} />} title={adapter.emptyHint} />
      )}
      {submittedQuery && isFetching && !items && <SkeletonLines lines={4} />}
      {isError && <ErrorState compact message={adapter.errorHint} />}
      {items?.map((item) => (
        <ResultRow
          key={item.id}
          item={item}
          thumbShape={adapter.thumbShape}
          onPlay={() => handlePlay(item)}
          onOpenChannel={channelClicks}
        />
      ))}
      {items?.length === 0 && <EmptyState compact title="No results" />}
    </>
  );

  // ── Playing (or playing + search overlay) ────────────────────────────────────
  if (selectedItem) {
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
            key={selectedItem.id}
            src={adapter.embedUrl(selectedItem)}
            className="w-full h-full"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
          />
        </div>

        {showSearch ? (
          /* Search overlay while playback stays loaded in background */
          <>
            <SearchBar
              placeholder={adapter.searchPlaceholder}
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
                {selectedItem.isLive && <LiveDot />}
                <p className="text-th-hi text-[11px] font-medium truncate">{selectedItem.title}</p>
              </div>
              <p className="text-th-hi3 text-[10px] truncate">{selectedItem.subtitle}</p>
            </div>
            <IconButton label="Search" size="xs" onClick={() => setView('search')}>
              <Search size={13} />
            </IconButton>
            <IconButton label={adapter.closeLabel} size="xs" onClick={goHome}>
              <X size={13} />
            </IconButton>
          </div>
        )}
      </div>
    );
  }

  // ── Home ──────────────────────────────────────────────────────────────────────
  if (view === 'home') {
    // Browse feed when available and the tile is tall enough for rows;
    // height === 0 is the pre-measurement first paint — assume browse so a
    // tall tile doesn't flash the hero (and fetch state lives in the query cache).
    const showBrowse = adapter.browse && (height === 0 || height >= 120);
    return (
      <div ref={setContainerEl} className="h-full overflow-hidden">
        {showBrowse && adapter.browse ? (
          <BrowseHome
            adapter={adapter}
            browse={adapter.browse}
            onSearch={() => setView('search')}
            onPlay={handlePlay}
            folder={folder}
            onOpenFolder={openFolder}
          />
        ) : (
          <HomeScreen adapter={adapter} onSearch={() => setView('search')} height={height} />
        )}
      </div>
    );
  }

  // ── Search (nothing playing) ──────────────────────────────────────────────────
  return (
    <div ref={setContainerEl} className="h-full flex flex-col overflow-hidden">
      <SearchBar
        placeholder={adapter.searchPlaceholder}
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
