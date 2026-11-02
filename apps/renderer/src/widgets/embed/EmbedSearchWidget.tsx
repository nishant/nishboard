import { useState, useRef, type ReactNode, type SyntheticEvent } from 'react';
import { Search, X, ArrowLeft, ChevronRight, ListVideo } from 'lucide-react';
import { useElementSize } from '../../hooks/useElementSize';
import type {
  EmbedItem, EmbedFolder, EmbedFoldersState, EmbedServiceAdapter, EmbedBrowse, EmbedSearchState, EmbedThumbShape,
} from './types';
import { Button, EmptyState, ErrorState, IconButton, MediaRow, SkeletonLines, StatusDot, Tabs, SearchInput } from '@nish/ui';

// Stable no-op hooks so BrowseHome can call the (optional) folder hooks
// unconditionally — the selection is fixed per adapter, so hook order is stable.
const NO_FOLDERS: EmbedFoldersState = { folders: undefined, isFetching: false, isError: false };
const NO_ITEMS: EmbedSearchState = { items: undefined, isFetching: false, isError: false };
function useNoFolders(_tabId: string, _enabled: boolean): EmbedFoldersState { return NO_FOLDERS; }
function useNoFolderItems(_folder: EmbedFolder | null, _tabId: string): EmbedSearchState { return NO_ITEMS; }
function useNoSearchFolders(_query: string): EmbedFoldersState { return NO_FOLDERS; }

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
    <MediaRow
      as="div"
      compact
      thumbnailUrl={folder.thumbnailUrl ?? undefined}
      thumbShape={folder.thumbShape ?? 'wide'}
      fallback={<ListVideo size={14} />}
      title={folder.title}
      meta={folder.subtitle}
      chevron
      onClick={onOpen}
    />
  );
}

function SectionLabel({ children }: { children: string }) {
  return <p className="px-3 pt-2 pb-0.5 text-3xs font-medium uppercase tracking-wide text-th-hi3">{children}</p>;
}

// ── Open folder: back header, optional sub-tabs, its items ───────────────────
// Keyed by folder id in BrowseHome, so the sub-tab resets per folder.

function FolderView({
  adapter, browse, folder, onBack, onSearch, onPlay, onOpenFolder,
}: {
  adapter: EmbedServiceAdapter;
  browse: EmbedBrowse;
  folder: EmbedFolder;
  onBack: () => void;
  onSearch: () => void;
  onPlay: (item: EmbedItem) => void;
  /** Opens a row's channel on top of this folder (Back returns here). */
  onOpenFolder: (folder: EmbedFolder) => void;
}) {
  const tabs = browse.folderTabs?.(folder);
  const [tabId, setTabId] = useState(tabs?.[0]?.id ?? '');
  const useFolderItems = browse.useFolderItems ?? useNoFolderItems;
  const { items, isFetching, isError } = useFolderItems(folder, tabId);
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-th-line shrink-0">
        <IconButton label="Back" size="xs" onClick={onBack}>
          <ArrowLeft size={12} />
        </IconButton>
        <span className="text-th-hi2 text-2xs font-medium truncate">{folder.title}</span>
        <IconButton label={adapter.searchPlaceholder} size="xs" onClick={onSearch} className="ml-auto">
          <Search size={12} />
        </IconButton>
      </div>
      {tabs && (
        <div className="px-2 py-1 border-b border-th-line shrink-0">
          <Tabs
            label={folder.title}
            variant="pill"
            size="xs"
            value={tabId}
            onChange={setTabId}
            items={tabs.map((t) => ({ value: t.id, label: t.label }))}
          />
        </div>
      )}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isFetching && !items && <SkeletonLines lines={4} />}
        {isError && <ErrorState compact message={adapter.errorHint} />}
        {items?.map((item) => (
          <ResultRow
            key={item.id}
            item={item}
            thumbShape={adapter.thumbShape}
            onPlay={() => onPlay(item)}
            // A row's channel opens on top, except the channel this folder already is.
            onOpenChannel={
              item.channel && `channel:${item.channel.id}` !== folder.id ? onOpenFolder : undefined
            }
          />
        ))}
        {items?.length === 0 && <EmptyState compact title="Nothing here" />}
      </div>
    </div>
  );
}

function BrowseHome({
  adapter, browse, onSearch, onPlay, folder, onOpenFolder, onBackFolder,
}: {
  adapter: EmbedServiceAdapter;
  browse: EmbedBrowse;
  onSearch: () => void;
  onPlay: (item: EmbedItem) => void;
  folder: EmbedFolder | null;
  /** push: open on top of the current folder (Back returns to it). */
  onOpenFolder: (folder: EmbedFolder, push?: boolean) => void;
  onBackFolder: () => void;
}) {
  const [tabId, setTabId] = useState(browse.tabs[0]?.id ?? '');
  const activeTab = browse.tabs.find((t) => t.id === tabId);
  const isFolderTab = activeTab?.kind === 'folders';

  // Optional hooks resolved to stable no-ops — selection never changes for a
  // given adapter, so this preserves hook order.
  const useFolders = browse.useFolders ?? useNoFolders;

  const videoState = browse.useBrowse(tabId, tabId !== '' && !isFolderTab && folder === null);
  const foldersState = useFolders(tabId, isFolderTab && folder === null);

  if (folder !== null) {
    return (
      <FolderView
        key={folder.id}
        adapter={adapter}
        browse={browse}
        folder={folder}
        onBack={onBackFolder}
        onSearch={onSearch}
        onPlay={onPlay}
        onOpenFolder={(f) => onOpenFolder(f, true)}
      />
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
          size="xs"
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
            onOpenChannel={browse.useFolderItems ? (f) => onOpenFolder(f) : undefined}
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
  thumbShape: EmbedThumbShape;
  onPlay: () => void;
  /** When set and the item carries a channel, the subtitle opens the channel's
   *  uploads folder instead of playing the row. */
  onOpenChannel?: (folder: EmbedFolder) => void;
}) {
  const channel = onOpenChannel ? item.channel : undefined;
  let meta: ReactNode = item.subtitle || undefined;
  if (channel && onOpenChannel) {
    const open = (e: SyntheticEvent) => {
      e.stopPropagation();
      onOpenChannel({ id: `channel:${channel.id}`, title: channel.title });
    };
    meta = (
      <span
        role="link"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter') open(e); }}
        className="hover:text-th-hi hover:underline"
        title={`${channel.title} — videos`}
      >
        {item.subtitle}
      </span>
    );
  }
  return (
    <MediaRow
      as="div"
      compact
      thumbnailUrl={item.thumbnailUrl}
      thumbShape={item.thumbShape ?? thumbShape}
      title={item.title}
      meta={meta}
      live={item.isLive ? true : undefined}
      onClick={onPlay}
    />
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
  // Open folders, innermost last (a game, then one of its channels); Back pops one.
  const [folderStack, setFolderStack] = useState<EmbedFolder[]>([]);
  const folder = folderStack.at(-1) ?? null;
  const { ref: setContainerEl, height } = useElementSize<HTMLDivElement>();
  const resultsRef = useRef<HTMLDivElement>(null);

  const { items, isFetching, isError, note, onRefresh } = adapter.useSearch(submittedQuery);
  // Fixed per adapter, so hook order is stable.
  const useSearchFolders = adapter.useSearchFolders ?? useNoSearchFolders;
  const searchFolders = useSearchFolders(submittedQuery).folders;

  const goHome = () => { setSelectedItem(null); setView('home'); };
  const handlePlay = (item: EmbedItem) => { setSelectedItem(item); setView('home'); };
  // Opening a folder (channel uploads / playlist / game) always lands on the
  // browse home — including from search results or the playing overlay (closes
  // player). `push` stacks it on the open folder; otherwise it replaces them.
  const openFolder = (f: EmbedFolder, push = false) => {
    setFolderStack((stack) => (push ? [...stack, f] : [f]));
    setSelectedItem(null);
    setView('home');
  };
  const backFolder = () => setFolderStack((stack) => stack.slice(0, -1));
  const channelClicks = adapter.browse?.useFolderItems ? (f: EmbedFolder) => openFolder(f) : undefined;
  const hasFolderResults = searchFolders !== undefined && searchFolders.length > 0;

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
      {note && items && (
        <div className="flex items-center gap-2 px-3 pt-1.5 text-3xs text-th-hi3">
          <span>{note}</span>
          {onRefresh && (
            <Button size="xs" variant="ghost" onClick={onRefresh} disabled={isFetching} className="ml-auto">
              Refresh
            </Button>
          )}
        </div>
      )}
      {hasFolderResults && (
        <>
          {adapter.searchFoldersLabel && <SectionLabel>{adapter.searchFoldersLabel}</SectionLabel>}
          {searchFolders.map((f) => (
            <FolderRow key={f.id} folder={f} onOpen={() => openFolder(f)} />
          ))}
          {adapter.searchItemsLabel && items && items.length > 0 && (
            <SectionLabel>{adapter.searchItemsLabel}</SectionLabel>
          )}
        </>
      )}
      {items?.map((item) => (
        <ResultRow
          key={item.id}
          item={item}
          thumbShape={adapter.thumbShape}
          onPlay={() => handlePlay(item)}
          onOpenChannel={channelClicks}
        />
      ))}
      {items?.length === 0 && !hasFolderResults && <EmptyState compact title="No results" />}
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
                <p className="text-th-hi text-2xs font-medium truncate">{selectedItem.title}</p>
              </div>
              <p className="text-th-hi3 text-3xs truncate">{selectedItem.subtitle}</p>
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
            onBackFolder={backFolder}
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
