import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { ThemeManager } from '../App';
import { WIDGET_REGISTRY } from './DashboardGrid';
import { DiscordHost } from '../widgets/discord/DiscordHost';
import { HeaderAction } from './HeaderAction';
import { WIDGET_TITLES } from '../lib/layouts';
import type { WidgetId } from '../lib/layouts';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * The entire UI of a popout window (?widget=<id>): a micro-titlebar (drag
 * region + the widget's own header actions + close) above the bare widget.
 * Deliberately NOT mounted here: the grid, command palette, and the alert
 * notifiers — those live only in the main window so notifications can't
 * double-fire.
 */
export function PopoutShell({ widgetId }: { widgetId: WidgetId }) {
  const { Component, Actions } = WIDGET_REGISTRY[widgetId];

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeManager />
      <div className="app-shell h-screen w-screen bg-th-bg overflow-hidden flex flex-col">
        <div className="app-region-drag flex items-center gap-2 px-3 py-1.5 border-b border-th-line bg-th-surface select-none shrink-0">
          <span className="text-[10px] font-medium text-th-3 uppercase tracking-widest truncate">
            {WIDGET_TITLES[widgetId]}
          </span>
          <div className="app-region-no-drag ml-auto flex items-center gap-0.5">
            {Actions && <Actions />}
            <HeaderAction
              title="Close popout"
              onClick={() => window.electron?.popout?.close(widgetId)}
            >
              <X size={12} />
            </HeaderAction>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden bg-th-surface">
          <Component />
        </div>
        {/* A popped-out Discord gets its own host in THIS window (separate
            renderer — the main window's host hides meanwhile). */}
        {widgetId === 'discord' && <DiscordHost />}
      </div>
    </QueryClientProvider>
  );
}
