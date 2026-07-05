import { useState, useEffect, useMemo } from 'react';
import ReactGridLayout, { WidthProvider } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import { useLayoutStore } from '../store/layoutStore';
import { useAppSettingsStore } from '../store/settingsStore';
import { WidgetShell } from './WidgetShell';
import { WeatherWidget, WeatherActions } from '../widgets/weather/WeatherWidget';
import { SpotifyWidget, SpotifyActions } from '../widgets/spotify/SpotifyWidget';
import { StocksWidget, StocksActions } from '../widgets/stocks/StocksWidget';
import { HardwareWidget, HardwareActions } from '../widgets/hardware/HardwareWidget';
import { SoundWidget, SoundActions } from '../widgets/sound/SoundWidget';
import { CalendarWidget } from '../widgets/calendar/CalendarWidget';
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
import { TITLEBAR_H } from './Titlebar';
import { WIDGET_TITLES } from '../lib/layouts';
import type { WidgetId } from '../lib/layouts';
import { cn } from '../lib/utils';

const GridLayout = WidthProvider(ReactGridLayout);

interface WidgetEntry {
  Component: React.ComponentType;
  /** Rendered in the WidgetShell header's hover-revealed action row. */
  Actions?: React.ComponentType;
}

const WIDGET_REGISTRY: Record<WidgetId, WidgetEntry> = {
  weather: { Component: WeatherWidget, Actions: WeatherActions },
  spotify: { Component: SpotifyWidget, Actions: SpotifyActions },
  stocks: { Component: StocksWidget, Actions: StocksActions },
  hardware: { Component: HardwareWidget, Actions: HardwareActions },
  sound: { Component: SoundWidget, Actions: SoundActions },
  calendar: { Component: CalendarWidget },
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
};

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
  const { layout, syncLayout, markUserEdited, visibleWidgets } = useLayoutStore();
  const density = useAppSettingsStore((s) => s.density);
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
  // their positions intact so they snap back when re-enabled.
  const visibleLayout = useMemo(
    () => layout.filter((item) => visibleWidgets.includes(item.i as WidgetId)),
    [layout, visibleWidgets],
  );

  const rowHeight = useRowHeight(visibleLayout, gap);

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
      onDragStop={markUserEdited}
      onResizeStop={markUserEdited}
      compactType="vertical"
      isResizable
      isDraggable
      resizeHandles={['se', 'sw', 'ne', 'nw', 'e', 'w', 's', 'n']}
    >
      {visibleLayout.map((item) => {
        const id = item.i as WidgetId;
        const { Component, Actions } = WIDGET_REGISTRY[id];
        return (
          <div key={id}>
            <WidgetShell
              title={WIDGET_TITLES[id]}
              actions={Actions ? <Actions /> : undefined}
            >
              <Component />
            </WidgetShell>
          </div>
        );
      })}
    </GridLayout>
  );
}
