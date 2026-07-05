import { useState, useEffect } from 'react';
import { X, Minus, Settings } from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { ThemeMenu } from './menus/ThemeMenu';
import { WidgetsMenu } from './menus/WidgetsMenu';
import { LayoutsMenu } from './menus/LayoutsMenu';
import { PinnedLayoutsMenu, InlinePinnedPresets } from './menus/PinnedLayouts';
import { menuBtn, dragStyle, noDragStyle } from './menus/primitives';
import { useAppSettingsStore } from '../store/settingsStore';
import { useOverlayStore } from '../store/overlayStore';
import { useWeather } from '../widgets/weather/useWeather';
import { hourFormat } from '../lib/time';

export const TITLEBAR_H = 32;

// ── Clock ─────────────────────────────────────────────────────────────────────

function formatClock(d: Date, clock24h: boolean): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...hourFormat(clock24h),
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const base = `${get('weekday')} ${get('month')} ${get('day')} ${get('hour')}:${get('minute')}`;
  return clock24h ? base : `${base} ${get('dayPeriod')}`;
}

function useClock(clock24h: boolean) {
  const [str, setStr] = useState(() => formatClock(new Date(), clock24h));
  useEffect(() => {
    setStr(formatClock(new Date(), clock24h)); // re-render immediately on format toggle
    const id = setInterval(() => setStr(formatClock(new Date(), clock24h)), 1000);
    return () => clearInterval(id);
  }, [clock24h]);
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
  const clock = useClock(clock24h);
  const showTempInClock = useAppSettingsStore((s) => s.showTempInClock);
  const forceCompact = useAppSettingsStore((s) => s.compactTitlebar);
  const narrow = useIsNarrow(COMPACT_BREAKPOINT);
  const compact = forceCompact || narrow;
  const weather = useWeather(showTempInClock);
  const temp = weather.data?.current.temp;
  // Store, not local state — the command palette's "Open Settings" needs it too.
  const settingsOpen = useOverlayStore((s) => s.settingsOpen);
  const setSettingsOpen = useOverlayStore((s) => s.setSettingsOpen);

  return (
    <div
      style={dragStyle}
      className="h-8 relative flex items-center px-3 bg-th-bar border-b border-th-line/50 shrink-0 select-none"
    >
      {/* Left: brand + pinned layouts (inline when wide, dropdown when compact) */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-th-ghost text-[11px] font-semibold tracking-[0.2em] uppercase shrink-0">
          nishboard
        </span>
        {compact ? <PinnedLayoutsMenu /> : <InlinePinnedPresets />}
      </div>

      {/* Center: clock — absolute so it's always perfectly centred */}
      <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none">
        <span className="text-th-3 text-[11px] tabular-nums">
          {clock}{showTempInClock && temp != null ? ` · ${temp}°` : ''}
        </span>
      </div>

      {/* Right: theme + widget + layout menus + settings */}
      <div className="ml-auto flex items-center gap-1 shrink-0">
        <ThemeMenu compact={compact} />
        <WidgetsMenu compact={compact} />
        <LayoutsMenu compact={compact} />
        <div style={noDragStyle} className="flex items-center gap-1">
          <button
            onClick={() => setSettingsOpen(true)}
            className={menuBtn(false, compact)}
            title="Settings"
          >
            <Settings size={compact ? 13 : 11} />
            {!compact && 'Settings'}
          </button>
          <div className="w-px h-3 bg-th-line mx-1" />
          <button
            onClick={() => window.electron?.minimize()}
            className="flex items-center justify-center w-6 h-6 rounded text-th-ghost hover:text-th-hi hover:bg-th-elevated/60 transition-colors"
            title="Minimize"
          >
            <Minus size={13} />
          </button>
          <button
            onClick={() => window.electron?.close()}
            className="flex items-center justify-center w-6 h-6 rounded text-th-ghost hover:text-red-400 hover:bg-th-elevated/60 transition-colors"
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
