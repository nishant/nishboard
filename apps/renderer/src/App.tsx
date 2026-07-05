import { useEffect, useLayoutEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Titlebar } from './components/Titlebar';
import { DashboardGrid } from './components/DashboardGrid';
import { ToastHost } from './components/ToastHost';
import { CommandPalette } from './components/CommandPalette';
import { useThemeStore } from './store/themeStore';
import { useAppSettingsStore } from './store/settingsStore';
import { usePowerStore } from './store/powerStore';
import { buildCustomVars, CUSTOM_VAR_KEYS } from './lib/colorUtils';
import { initAutoExport } from './lib/autoExport';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Renders nothing — refetches stale queries the moment the window becomes
 *  visible again. Polling pauses entirely while hidden (useGatedInterval
 *  returns false), so without this kick widgets would show stale data until
 *  their next interval after a long minimize. */
function VisibilityKicker() {
  const queryClient = useQueryClient();
  const hidden = usePowerStore((s) => s.hidden);
  const prevHidden = useRef(hidden);
  useEffect(() => {
    if (prevHidden.current && !hidden) {
      void queryClient.refetchQueries({ type: 'active', stale: true });
    }
    prevHidden.current = hidden;
  }, [hidden, queryClient]);
  return null;
}

/** Renders nothing — refetches everything after the main process restarts the
 *  Fastify child (tray "Restart server"), instead of leaving widgets in
 *  connection-refused error states until their next poll. */
function ServerRestartListener() {
  const queryClient = useQueryClient();
  useEffect(() => {
    return window.electron?.onServerRestarted?.(() => {
      void queryClient.invalidateQueries();
    });
  }, [queryClient]);
  useEffect(() => {
    initAutoExport(); // idempotent; no-op outside Electron
  }, []);
  return null;
}

/** Renders nothing — exists so theme/scale changes re-render THIS component
 *  only, applying everything to <html> via effects. If App itself subscribed,
 *  every theme tweak (live color-picker drags included) would re-render the
 *  whole tree, grid and all widgets. The `[data-theme="x"]` CSS-var blocks
 *  match the attribute on <html> and cascade identically. */
function ThemeManager() {
  const theme = useThemeStore((s) => s.theme);
  const customColors = useThemeStore((s) => s.customColors);
  const uiScale = useAppSettingsStore((s) => s.uiScale);

  // UI scale via Electron's renderer zoom (scales everything incl. px sizes + the
  // grid; Chromium handles event coordinates correctly under zoom). No-op in the browser.
  useLayoutEffect(() => {
    window.electron?.setZoom?.(uiScale);
  }, [uiScale]);

  // Tag <html> with the host OS so platform-specific CSS (Windows scrollbars +
  // rounded corners) can target it. Falls back to 'web' outside Electron.
  useLayoutEffect(() => {
    document.documentElement.dataset.platform = window.electron?.platform ?? 'web';
  }, []);

  // Named themes: [data-theme="x"] CSS blocks. Custom theme: no CSS block —
  // JS injects the vars on <html> instead.
  useLayoutEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = theme;
    if (theme === 'custom') {
      const vars = buildCustomVars(
        customColors.primary,
        customColors.secondary,
        customColors.tertiary,
        customColors.text,
      );
      Object.entries(vars).forEach(([k, v]) => el.style.setProperty(k, v));
    } else {
      CUSTOM_VAR_KEYS.forEach((k) => el.style.removeProperty(k));
    }
  }, [theme, customColors]);

  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeManager />
      <VisibilityKicker />
      <ServerRestartListener />
      <div className="app-shell h-screen w-screen bg-th-bg overflow-hidden flex flex-col">
        <Titlebar />
        <div className="flex-1 min-h-0">
          <DashboardGrid />
        </div>
        <ToastHost />
        <CommandPalette />
      </div>
    </QueryClientProvider>
  );
}
