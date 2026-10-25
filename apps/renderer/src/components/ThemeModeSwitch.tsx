import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@nish/ui';
import { useThemeStore } from '../store/themeStore';
import type { ThemeId } from '../themes';

const MODES: { id: ThemeId; label: string; Icon: typeof Sun }[] = [
  { id: 'system', label: 'System', Icon: Monitor },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
];

/** System / Light / Dark segmented control (same look as @nish/ui's ThemeToggle,
 *  but driven by Nishboard's theme store so its presets and Custom stay in the
 *  loop). None is checked while a preset is active. */
export function ThemeModeSwitch({ showLabels = false, className }: { showLabels?: boolean; className?: string }) {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  return (
    <div role="radiogroup" aria-label="Theme" className={cn('inline-flex rounded-lg border border-th-line bg-th-elevated p-0.5', className)}>
      {MODES.map(({ id, label, Icon }) => {
        const on = theme === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => setTheme(id)}
            className={cn(
              'inline-flex h-6 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] transition-colors',
              on ? 'bg-th-surface text-th-hi shadow-card' : 'text-th-hi3 hover:text-th-hi',
            )}
          >
            <Icon size={12} />
            {showLabels && label}
          </button>
        );
      })}
    </div>
  );
}
