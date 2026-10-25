import { Monitor, Moon, Sun } from 'lucide-react';
import { cn, Segmented, useTheme, type ThemeChoice } from '@nish/ui';

const MODES: { id: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { id: 'system', label: 'System', Icon: Monitor },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
];

/** System / Light / Dark on @nish/ui's useTheme(), drawn with the shared
 *  Segmented (accent tint + ring on the selected option). Not the shared
 *  ThemeToggle because the Themes menu and Settings want text labels and, in the
 *  menu, a full-width row. ThemeManager copies the choice into the theme store.
 *  None is checked while a preset or Custom is active. */
export function ThemeModeSwitch({ showLabels = false, className }: { showLabels?: boolean; className?: string }) {
  const { choice, setChoice } = useTheme();
  return (
    <Segmented<ThemeChoice>
      label="Theme"
      value={choice}
      onChange={setChoice}
      options={MODES.map(({ id, label, Icon }) => ({
        value: id,
        ariaLabel: label,
        label: (
          <>
            <Icon size={12} />
            {showLabels && label}
          </>
        ),
      }))}
      className={cn('[&>button]:flex-1', className)}
    />
  );
}
