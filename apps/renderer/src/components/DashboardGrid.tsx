import { useState, useEffect, useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import ReactGridLayout, { WidthProvider } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import { useLayoutStore, collapsedRowsFor } from '../store/layoutStore';
import { useDiscordStore } from '../store/discordStore';
import { useAppSettingsStore } from '../store/settingsStore';
import { usePopoutStore } from '../store/popoutStore';
import { useWidgetUiStore } from '../store/widgetUiStore';
import { WidgetShell } from './WidgetShell';
import { WeatherWidget, WeatherActions } from '../widgets/weather/WeatherWidget';
import { SpotifyWidget, SpotifyActions } from '../widgets/spotify/SpotifyWidget';
import { StocksWidget, StocksActions } from '../widgets/stocks/StocksWidget';
import { HardwareWidget, HardwareActions } from '../widgets/hardware/HardwareWidget';
import { SoundWidget, SoundActions } from '../widgets/sound/SoundWidget';
import { CalendarWidget, CalendarActions } from '../widgets/calendar/CalendarWidget';
import { YoutubeWidget, YoutubeActions } from '../widgets/youtube/YoutubeWidget';
import { TwitchWidget, TwitchActions } from '../widgets/twitch/TwitchWidget';
import { TasksWidget } from '../widgets/tasks/TasksWidget';
import { WorldClockWidget } from '../widgets/worldclock/WorldClockWidget';
import { NotesWidget } from '../widgets/notes/NotesWidget';
import { TimerWidget } from '../widgets/timer/TimerWidget';
import { CountdownWidget } from '../widgets/countdown/CountdownWidget';
import { NewsWidget, NewsActions } from '../widgets/news/NewsWidget';
import { CryptoWidget, CryptoActions } from '../widgets/crypto/CryptoWidget';
import { LauncherWidget, LauncherActions } from '../widgets/launcher/LauncherWidget';
import { ClipboardWidget, ClipboardActions } from '../widgets/clipboard/ClipboardWidget';
import { ClaudeWidget, ClaudeActions } from '../widgets/claude/ClaudeWidget';
import { NetworkMonitorWidget, NetworkMonitorActions } from '../widgets/netmon/NetworkMonitorWidget';
import { DiscordWidget, DiscordActions } from '../widgets/discord/DiscordWidget';
import { TITLEBAR_H } from './Titlebar';
import { WIDGET_TITLES } from '../lib/layouts';
import type { WidgetId } from '../lib/layouts';
import { cn } from '../lib/utils';
import { HeaderAction } from './HeaderAction';

const GridLayout = WidthProvider(ReactGridLayout);

interface WidgetEntry {
  Component: React.ComponentType;
  /** Rendered in the WidgetShell header's hover-revealed action row. */
  Actions?: React.ComponentType;
}

export const WIDGET_REGISTRY: Record<WidgetId, WidgetEntry> = {
  weather: { Component: WeatherWidget, Actions: WeatherActions },
  spotify: { Component: SpotifyWidget, Actions: SpotifyActions },
  stocks: { Component: StocksWidget, Actions: StocksActions },
  hardware: { Component: HardwareWidget, Actions: HardwareActions },
  sound: { Component: SoundWidget, Actions: SoundActions },
  calendar: { Component: CalendarWidget, Actions: CalendarActions },
  youtube: { Component: YoutubeWidget, Actions: YoutubeActions },
  twitch: { Component: TwitchWidget, Actions: TwitchActions },
  tasks: { Component: TasksWidget },
  worldclock: { Component: WorldClockWidget },
  notes: { Component: NotesWidget },
  timer: { Component: TimerWidget },
  countdown: { Component: CountdownWidget },
  news: { Component: NewsWidget, Actions: NewsActions },
  crypto: { Component: CryptoWidget, Actions: CryptoActions },
  launcher: { Component: LauncherWidget, Actions: LauncherActions },
  clipboard: { Component: ClipboardWidget, Actions: ClipboardActions },
  claude: { Component: ClaudeWidget, Actions: ClaudeActions },
  netmon: { Component: NetworkMonitorWidget, Actions: NetworkMonitorActions },
  // The webview itself lives in the app-lifetime DiscordHost (App.tsx) — this
  // tile only positions it, so unmounting here never drops the session.
  discord: { Component: DiscordWidget, Actions: DiscordActions },
};

/** Rightmost header action on EVERY widget: float it in its own window.
 *  Hidden in the plain browser (no Electron popout API). */
function PopoutAction({ id }: { id: WidgetId }) {
  if (!window.electron?.popout) return null;
  return (
    <HeaderAction title="Pop out" onClick={() => window.electron!.popout.open(id)}>
      <ExternalLink size={12} />
    </HeaderAction>
  );
}

/** Body shown in the grid tile while its widget lives in a popout window —
 *  the real widget renders only there (no double polling / double chimes). */
function PoppedPlaceholder({ id }: { id: WidgetId }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-4">
      <ExternalLink size={18} className="text-th-ghost" />
      <p className="text-th-ghost text-xs">Popped out</p>
      <button
        onClick={() => window.electron?.popout?.close(id)}
        className="px-3 py-1.5 rounded-full bg-th-elevated hover:bg-th-overlay text-th-hi text-[11px] transition-colors"
      >
        Bring back
      </button>
    </div>
  );
}

function useRowHeight(layout: Layout[], gap: number): number {
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);

  useEffect(() => {
    const onResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const numRows = useMemo(
    () => Math.max(...layout.map((item) => item.y + item.h), 1),
    [layout],
  );

  // Solve: availHeight = numRows * rowHeight + (numRows - 1) * gap [margin] + 2 * gap [padding]
  const availHeight = windowHeight - TITLEBAR_H;
  return Math.max(10, (availHeight - (numRows - 1) * gap - 2 * gap) / numRows);
}

export function DashboardGrid() {
  const { layout, syncLayout, markUserEdited, visibleWidgets, setWidgetCollapsed } = useLayoutStore();
  // ANY tile's drag/resize gesture flips this: the Discord host freezes its
  // size and mutes pointer events for the duration (the webview otherwise
  // relayouts per mousemove and eats the grid's drag events). Simplest to set
  // it for every gesture — harmless when the Discord tile isn't around.
  const setDiscordInteracting = useDiscordStore((s) => s.setInteracting);
  const density = useAppSettingsStore((s) => s.density);
  const disabledWidgets = useAppSettingsStore((s) => s.disabledWidgets);
  const popped = usePopoutStore((s) => s.popped);
  const collapsed = useWidgetUiStore((s) => s.collapsed);
  const setCollapsedFlag = useWidgetUiStore((s) => s.setCollapsed);
  const gap = density === 'compact' ? 4 : 8;

  // RGL's stock CSS animates every position change — including the initial
  // layout pass, which makes tiles fly in from the corner on launch. Suppress
  // transitions until the first layout has settled.
  const [animReady, setAnimReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAnimReady(true), 350);
    return () => clearTimeout(t);
  }, []);

  // Only pass visible items to the grid; hidden items stay in `layout` with
  // their positions intact so they snap back when re-enabled. Disabled widgets
  // (Settings → Widgets) are excluded too — covers stale persisted
  // visibleWidgets that still contain a disabled id.
  const visibleLayout = useMemo(
    () =>
      layout.filter(
        (item) =>
          visibleWidgets.includes(item.i as WidgetId) &&
          !disabledWidgets.includes(item.i as WidgetId),
      ),
    [layout, visibleWidgets, disabledWidgets],
  );

  const rowHeight = useRowHeight(visibleLayout, gap);

  // Reconcile collapsed-item heights with the live, viewport-derived rowHeight.
  // Covers two cases the store can't handle alone: (1) reload — onRehydrateStorage
  // re-locks collapsed items but keeps their stale h; (2) window resize changes
  // rowHeight, so the rows needed to show just a title bar changes. Patch the lock
  // directly via syncLayout — NOT setWidgetCollapsed, which would clobber the real
  // savedHeights entry with the already-collapsed height.
  useEffect(() => {
    const target = collapsedRowsFor(rowHeight, gap);
    const store = useLayoutStore.getState();
    const needsPatch = store.layout.some(
      (it) => collapsed[it.i as WidgetId] && it.h !== target,
    );
    if (!needsPatch) return;
    store.syncLayout(
      store.layout.map((it) =>
        collapsed[it.i as WidgetId]
          ? { ...it, h: target, minH: target, maxH: target, isResizable: false }
          : it,
      ),
    );
  }, [rowHeight, gap, collapsed]);

  return (
    <GridLayout
      className={cn(!animReady && 'rgl-no-anim')}
      layout={visibleLayout}
      cols={24}
      rowHeight={rowHeight}
      margin={[gap, gap]}
      containerPadding={[gap, gap]}
      draggableHandle=".widget-drag-handle"
      onLayoutChange={(newVisible) => {
        // Merge incoming positions with stored positions of hidden widgets so
        // drag/resize doesn't wipe out hidden-widget position state. This also
        // fires on mount and after applyPreset, so it must only sync geometry —
        // clearing the active-preset markers here would wipe the highlight on
        // every launch. Real edits are detected by the gesture handlers below.
        const visibleIds = new Set(newVisible.map((i) => i.i));
        const hiddenItems = layout.filter((i) => !visibleIds.has(i.i));
        syncLayout([...newVisible, ...hiddenItems]);
      }}
      onDragStart={() => setDiscordInteracting(true)}
      onResizeStart={() => setDiscordInteracting(true)}
      onDragStop={() => {
        setDiscordInteracting(false);
        markUserEdited();
      }}
      onResizeStop={() => {
        setDiscordInteracting(false);
        markUserEdited();
      }}
      compactType="vertical"
      isResizable
      isDraggable
      resizeHandles={['se', 'sw', 'ne', 'nw', 'e', 'w', 's', 'n']}
    >
      {visibleLayout.map((item) => {
        const id = item.i as WidgetId;
        const { Component, Actions } = WIDGET_REGISTRY[id];
        const isPopped = popped.includes(id);
        const isCollapsed = collapsed[id] ?? false;
        return (
          <div key={id}>
            <WidgetShell
              title={WIDGET_TITLES[id]}
              collapsed={isCollapsed}
              onToggleCollapse={() => {
                const next = !isCollapsed;
                // Keep the two stores in lockstep: the boolean drives the body,
                // the layout action drives the height lock.
                setCollapsedFlag(id, next);
                setWidgetCollapsed(id, next, rowHeight, gap);
              }}
              actions={
                <>
                  {Actions && <Actions />}
                  <PopoutAction id={id} />
                </>
              }
            >
              {isPopped ? <PoppedPlaceholder id={id} /> : <Component />}
            </WidgetShell>
          </div>
        );
      })}
    </GridLayout>
  );
}
