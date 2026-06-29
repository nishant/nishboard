import { useLayoutEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Titlebar } from './components/Titlebar';
import { DashboardGrid } from './components/DashboardGrid';
import { useThemeStore } from './store/themeStore';
import { buildCustomVars, CUSTOM_VAR_KEYS } from './lib/colorUtils';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  const theme = useThemeStore((s) => s.theme);
  const customColors = useThemeStore((s) => s.customColors);

  // Tag <html> with the host OS so platform-specific CSS (Windows scrollbars +
  // rounded corners) can target it. Falls back to 'web' outside Electron.
  useLayoutEffect(() => {
    document.documentElement.dataset.platform = window.electron?.platform ?? 'web';
  }, []);

  // Apply / remove custom CSS vars on <html> so they cascade to all widgets.
  // Named themes are handled by [data-theme="x"] CSS selectors on the root div;
  // the custom theme has no CSS block — JS injects the vars instead.
  useLayoutEffect(() => {
    const el = document.documentElement;
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

  return (
    <QueryClientProvider client={queryClient}>
      <div
        data-theme={theme}
        className="app-shell h-screen w-screen bg-th-bg overflow-hidden flex flex-col"
      >
        <Titlebar />
        <div className="flex-1 min-h-0">
          <DashboardGrid />
        </div>
      </div>
    </QueryClientProvider>
  );
}
