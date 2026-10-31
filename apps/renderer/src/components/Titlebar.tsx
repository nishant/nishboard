import { useState, useEffect } from 'react';
import { X, Minus, Square, Settings } from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { ThemeMenu } from './menus/ThemeMenu';
import { WidgetsMenu } from './menus/WidgetsMenu';
import { LayoutsMenu } from './menus/LayoutsMenu';
import { PinnedLayoutsMenu, InlinePinnedLayouts } from './menus/PinnedLayouts';
import { dragStyle, noDragStyle } from './menus/primitives';
import { Button, IconButton } from '@nish/ui';
import { useAppSettingsStore } from '../store/settingsStore';
import { useOverlayStore } from '../store/overlayStore';
import { useWeather } from '../widgets/weather/useWeather';
import { hourFormat } from '../lib/time';

/** Touch screens get a taller bar so the 44px IconButton hit areas fit inside it.
 *  Read once at load (the primary pointer does not change at runtime); the grid
 *  height maths in DashboardGrid reads this same value. */
export const TITLEBAR_H =
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 44 : 32;

// ── Clock ─────────────────────────────────────────────────────────────────────

function formatClock(d: Date, clock24h: boolean, short = false): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...hourFormat(clock24h),
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const time = `${get('hour')}:${get('minute')}`;
  const base = short ? `${get('weekday')} ${time}` : `${get('weekday')} ${get('month')} ${get('day')} ${time}`;
  return clock24h ? base : `${base} ${get('dayPeriod')}`;
}

function useClock(clock24h: boolean, short: boolean) {
  const [str, setStr] = useState(() => formatClock(new Date(), clock24h, short));
  useEffect(() => {
    setStr(formatClock(new Date(), clock24h, short)); // re-render immediately on format toggle
    const id = setInterval(() => setStr(formatClock(new Date(), clock24h, short)), 1000);
    return () => clearInterval(id);
  }, [clock24h, short]);
  return str;
}

// ── Responsive width ──────────────────────────────────────────────────────────

// Below this window width the titlebar auto-compacts (icon-only menus + pinned
// layouts collapse into a dropdown) so the left/right content stops crowding the
// centered clock. Above it, the full labeled titlebar is shown.
const COMPACT_BREAKPOINT = 900;

function useIsNarrow(threshold: number): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < threshold,
  );
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < threshold);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [threshold]);
  return narrow;
}

// ── Titlebar ──────────────────────────────────────────────────────────────────

export function Titlebar() {
  const clock24h = useAppSettingsStore((s) => s.clock24h);
  const showTempInClock = useAppSettingsStore((s) => s.showTempInClock);
  const forceCompact = useAppSettingsStore((s) => s.compactTitlebar);
  const narrow = useIsNarrow(COMPACT_BREAKPOINT);
  const clock = useClock(clock24h, useIsNarrow(600));
  const compact = forceCompact || narrow;
  const weather = useWeather(showTempInClock);
  const temp = weather.data?.current?.temp;
  // Store, not local state — the command palette's "Open Settings" needs it too.
  const settingsOpen = useOverlayStore((s) => s.settingsOpen);
  const setSettingsOpen = useOverlayStore((s) => s.setSettingsOpen);

  return (
    <div
      style={dragStyle}
      className="h-8 relative z-40 flex items-center px-3 bg-th-bg border-b border-th-line/50 shrink-0 select-none"
    >
      {/* Left: brand + pinned layouts (inline when wide, dropdown when compact) */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-th-hi3 text-2xs font-semibold tracking-[0.2em] uppercase shrink-0 max-[520px]:hidden">
          nishboard
        </span>
        {compact ? <PinnedLayoutsMenu /> : <InlinePinnedLayouts />}
      </div>

      {/* Center: clock — absolute so it's always perfectly centred. In a popout-
          narrow window there is no room for that: the brand hides and the clock
          joins the row, so it can never sit under the menu buttons. */}
      <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none max-[520px]:static max-[520px]:translate-x-0 max-[520px]:flex-1 max-[520px]:min-w-0 max-[520px]:px-2 max-[520px]:text-center max-[520px]:truncate">
        <span className="text-th-hi3 text-2xs tabular-nums whitespace-nowrap">
          {clock}{showTempInClock && temp != null ? ` · ${temp}°` : ''}
        </span>
      </div>

      {/* Right: theme + widget + layout menus + settings */}
      <div className="ml-auto flex items-center gap-1 shrink-0">
        <ThemeMenu compact={compact} />
        <WidgetsMenu compact={compact} />
        <LayoutsMenu compact={compact} />
        <div style={noDragStyle} className="flex items-center gap-1">
          {compact ? (
            <IconButton label="Settings" size="xs" onClick={() => setSettingsOpen(true)}>
              <Settings size={13} />
            </IconButton>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              icon={<Settings size={11} />}
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              className="text-th-hi3 font-normal"
            >
              Settings
            </Button>
          )}
          {/* Below 600px the bar has no room for them (touch targets grow to 44px):
              minimize/maximize hide, Close stays. */}
          <div className="w-px h-3 bg-th-line mx-1 max-[599px]:hidden" />
          <div className="contents max-[599px]:hidden">
            <IconButton label="Minimize" size="xs" onClick={() => window.electron?.minimize()}>
              <Minus size={13} />
            </IconButton>
            <IconButton label="Maximize" size="xs" onClick={() => window.electron?.toggleMaximize()}>
              <Square size={11} />
            </IconButton>
          </div>
          <IconButton label="Close" size="xs" tone="danger" onClick={() => window.electron?.close()}>
            <X size={13} />
          </IconButton>
        </div>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
