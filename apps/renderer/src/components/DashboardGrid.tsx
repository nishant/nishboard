import { useState, useEffect, useMemo } from 'react';
import ReactGridLayout, { WidthProvider } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import { useLayoutStore } from '../store/layoutStore';
import { WidgetShell } from './WidgetShell';
import { WeatherWidget } from '../widgets/weather/WeatherWidget';
import { SpotifyWidget, SpotifyLogoutButton } from '../widgets/spotify/SpotifyWidget';
import { StocksWidget } from '../widgets/stocks/StocksWidget';
import { HardwareWidget } from '../widgets/hardware/HardwareWidget';
import { SoundWidget } from '../widgets/sound/SoundWidget';
import { CalendarWidget } from '../widgets/calendar/CalendarWidget';
import { YoutubeWidget } from '../widgets/youtube/YoutubeWidget';
import { TwitchWidget } from '../widgets/twitch/TwitchWidget';
import { TasksWidget } from '../widgets/tasks/TasksWidget';
import { WorldClockWidget } from '../widgets/worldclock/WorldClockWidget';
import { NotesWidget } from '../widgets/notes/NotesWidget';
import { TITLEBAR_H } from './Titlebar';
import { WIDGET_TITLES } from '../lib/layouts';
import type { WidgetId } from '../lib/layouts';

const GridLayout = WidthProvider(ReactGridLayout);

const MARGIN = 8;
const PADDING = 8;

const WIDGET_COMPONENTS: Record<WidgetId, React.ReactNode> = {
  weather: <WeatherWidget />,
  spotify: <SpotifyWidget />,
  stocks: <StocksWidget />,
  hardware: <HardwareWidget />,
  sound: <SoundWidget />,
  calendar: <CalendarWidget />,
  youtube: <YoutubeWidget />,
  twitch: <TwitchWidget />,
  tasks: <TasksWidget />,
  worldclock: <WorldClockWidget />,
  notes: <NotesWidget />,
};

function useRowHeight(layout: Layout[]): number {
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

  // Solve: availHeight = numRows * rowHeight + (numRows - 1) * MARGIN + 2 * PADDING
  const availHeight = windowHeight - TITLEBAR_H;
  return Math.max(10, (availHeight - (numRows - 1) * MARGIN - 2 * PADDING) / numRows);
}

export function DashboardGrid() {
  const { layout, setLayout, visibleWidgets } = useLayoutStore();

  // Only pass visible items to the grid; hidden items stay in `layout` with
  // their positions intact so they snap back when re-enabled.
  const visibleLayout = useMemo(
    () => layout.filter((item) => visibleWidgets.includes(item.i as WidgetId)),
    [layout, visibleWidgets],
  );

  const rowHeight = useRowHeight(visibleLayout);

  return (
    <GridLayout
      layout={visibleLayout}
      cols={24}
      rowHeight={rowHeight}
      margin={[MARGIN, MARGIN]}
      containerPadding={[PADDING, PADDING]}
      draggableHandle=".widget-drag-handle"
      onLayoutChange={(newVisible) => {
        // Merge incoming positions with stored positions of hidden widgets so
        // drag/resize doesn't wipe out hidden-widget position state.
        const visibleIds = new Set(newVisible.map((i) => i.i));
        const hiddenItems = layout.filter((i) => !visibleIds.has(i.i));
        setLayout([...newVisible, ...hiddenItems]);
      }}
      compactType="vertical"
      isResizable
      isDraggable
      resizeHandles={['se', 'sw', 'ne', 'nw', 'e', 'w', 's', 'n']}
    >
      {visibleLayout.map((item) => {
        const id = item.i as WidgetId;
        return (
          <div key={id}>
            <WidgetShell
              title={WIDGET_TITLES[id]}
              actions={id === 'spotify' ? <SpotifyLogoutButton /> : undefined}
            >
              {WIDGET_COMPONENTS[id]}
            </WidgetShell>
          </div>
        );
      })}
    </GridLayout>
  );
}
