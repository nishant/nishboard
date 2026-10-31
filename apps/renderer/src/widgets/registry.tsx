import { lazy, Suspense } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { SkeletonLines } from '@nish/ui';
import type { WidgetId } from '../lib/layouts';

export interface WidgetEntry {
  Component: ComponentType;
  /** Rendered in the WidgetShell header's hover-revealed action row. */
  Actions?: ComponentType;
}

function WidgetFallback() {
  return (
    <div className="p-3">
      <SkeletonLines lines={3} />
    </div>
  );
}

/** Wraps a dynamic import in React.lazy + Suspense so each widget is its own chunk. */
function lazyWidget<P extends object>(
  load: () => Promise<ComponentType<P>>,
  fallback: ReactNode = <WidgetFallback />,
): ComponentType<P> {
  const Lazy = lazy(() => load().then((C) => ({ default: C })));
  function LazyWidget(props: P) {
    return (
      <Suspense fallback={fallback}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  return LazyWidget;
}

/** Header actions share the widget's module (one chunk) but render no skeleton. */
function lazyActions(load: () => Promise<ComponentType>): ComponentType {
  return lazyWidget(load, null);
}

export const WIDGET_REGISTRY: Record<WidgetId, WidgetEntry> = {
  weather: {
    Component: lazyWidget(() => import('./weather/WeatherWidget').then((m) => m.WeatherWidget)),
    Actions: lazyActions(() => import('./weather/WeatherWidget').then((m) => m.WeatherActions)),
  },
  spotify: {
    Component: lazyWidget(() => import('./spotify/SpotifyWidget').then((m) => m.SpotifyWidget)),
    Actions: lazyActions(() => import('./spotify/SpotifyWidget').then((m) => m.SpotifyActions)),
  },
  stocks: {
    Component: lazyWidget(() => import('./stocks/StocksWidget').then((m) => m.StocksWidget)),
    Actions: lazyActions(() => import('./stocks/StocksWidget').then((m) => m.StocksActions)),
  },
  hardware: {
    Component: lazyWidget(() => import('./hardware/HardwareWidget').then((m) => m.HardwareWidget)),
    Actions: lazyActions(() => import('./hardware/HardwareWidget').then((m) => m.HardwareActions)),
  },
  sound: {
    Component: lazyWidget(() => import('./sound/SoundWidget').then((m) => m.SoundWidget)),
    Actions: lazyActions(() => import('./sound/SoundWidget').then((m) => m.SoundActions)),
  },
  calendar: {
    Component: lazyWidget(() => import('./calendar/CalendarWidget').then((m) => m.CalendarWidget)),
    Actions: lazyActions(() => import('./calendar/CalendarWidget').then((m) => m.CalendarActions)),
  },
  youtube: {
    Component: lazyWidget(() => import('./youtube/YoutubeWidget').then((m) => m.YoutubeWidget)),
    Actions: lazyActions(() => import('./youtube/YoutubeWidget').then((m) => m.YoutubeActions)),
  },
  twitch: {
    Component: lazyWidget(() => import('./twitch/TwitchWidget').then((m) => m.TwitchWidget)),
    Actions: lazyActions(() => import('./twitch/TwitchWidget').then((m) => m.TwitchActions)),
  },
  tasks: {
    Component: lazyWidget(() => import('./tasks/TasksWidget').then((m) => m.TasksWidget)),
  },
  worldclock: {
    Component: lazyWidget(() => import('./worldclock/WorldClockWidget').then((m) => m.WorldClockWidget)),
  },
  notes: {
    Component: lazyWidget(() => import('./notes/NotesWidget').then((m) => m.NotesWidget)),
  },
  timer: {
    Component: lazyWidget(() => import('./timer/TimerWidget').then((m) => m.TimerWidget)),
  },
  countdown: {
    Component: lazyWidget(() => import('./countdown/CountdownWidget').then((m) => m.CountdownWidget)),
  },
  news: {
    Component: lazyWidget(() => import('./news/NewsWidget').then((m) => m.NewsWidget)),
    Actions: lazyActions(() => import('./news/NewsWidget').then((m) => m.NewsActions)),
  },
  crypto: {
    Component: lazyWidget(() => import('./crypto/CryptoWidget').then((m) => m.CryptoWidget)),
    Actions: lazyActions(() => import('./crypto/CryptoWidget').then((m) => m.CryptoActions)),
  },
  inbox: {
    Component: lazyWidget(() => import('./inbox/InboxWidget').then((m) => m.InboxWidget)),
    Actions: lazyActions(() => import('./inbox/InboxWidget').then((m) => m.InboxActions)),
  },
  launcher: {
    Component: lazyWidget(() => import('./launcher/LauncherWidget').then((m) => m.LauncherWidget)),
    Actions: lazyActions(() => import('./launcher/LauncherWidget').then((m) => m.LauncherActions)),
  },
  clipboard: {
    Component: lazyWidget(() => import('./clipboard/ClipboardWidget').then((m) => m.ClipboardWidget)),
    Actions: lazyActions(() => import('./clipboard/ClipboardWidget').then((m) => m.ClipboardActions)),
  },
  claude: {
    Component: lazyWidget(() => import('./claude/ClaudeWidget').then((m) => m.ClaudeWidget)),
    Actions: lazyActions(() => import('./claude/ClaudeWidget').then((m) => m.ClaudeActions)),
  },
  netmon: {
    Component: lazyWidget(() => import('./netmon/NetworkMonitorWidget').then((m) => m.NetworkMonitorWidget)),
    Actions: lazyActions(() => import('./netmon/NetworkMonitorWidget').then((m) => m.NetworkMonitorActions)),
  },
  // The webview itself lives in the app-lifetime DiscordHost (App.tsx) - this
  // tile only positions it, so unmounting here never drops the session.
  discord: {
    Component: lazyWidget(() => import('./discord/DiscordWidget').then((m) => m.DiscordWidget)),
    Actions: lazyActions(() => import('./discord/DiscordWidget').then((m) => m.DiscordActions)),
  },
};
