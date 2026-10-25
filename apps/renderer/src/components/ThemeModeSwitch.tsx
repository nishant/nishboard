import { Monitor, Moon, Sun } from 'lucide-react';
import { cn, useTheme, type ThemeChoice } from '@nish/ui';

const MODES: { id: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { id: 'system', label: 'System', Icon: Monitor },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
];

/** System / Light / Dark segmented control on @nish/ui's useTheme(). Its own
 *  rather than the shared ThemeToggle for the text labels and full-width layout
 *  the Themes menu and Settings use. ThemeManager copies the choice into the
 *  theme store. None is checked while a preset or Custom is active. */
export function ThemeModeSwitch({ showLabels = false, className }: { showLabels?: boolean; className?: string }) {
  const { choice, setChoice } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={cn('inline-flex rounded-lg border border-th-line bg-th-elevated p-0.5', className)}>
      {MODES.map(({ id, label, Icon }) => {
        const on = choice === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => setChoice(id)}
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
