import { useState } from 'react';
import { LayoutGrid, ChevronDown } from 'lucide-react';
import { useLayoutStore } from '../../store/layoutStore';
import { cn } from '../../lib/utils';
import { Backdrop, noDragStyle } from './primitives';

/** Compact left-side quick-switcher: the pinned presets collapsed into a dropdown. */
export function PinnedLayoutsMenu() {
  const { activePreset, applyPreset, pinnedPresets } = useLayoutStore();
  const [open, setOpen] = useState(false);
  if (pinnedPresets.length === 0) return null;

  // Show the active preset's name when it's a pinned one; otherwise a neutral label.
  const label = activePreset && pinnedPresets.includes(activePreset) ? activePreset : 'Layouts';

  return (
    <div className="relative" style={noDragStyle}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded text-[11px] font-medium transition-colors max-w-[140px]',
          open
            ? 'bg-th-elevated text-th-hi'
            : 'text-th-ghost hover:text-th-hi hover:bg-th-elevated/60',
        )}
        title="Switch pinned layout"
      >
        <LayoutGrid size={11} className="shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown size={10} className={cn('shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <>
          <Backdrop onClose={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-50 bg-th-surface border border-th-line rounded-lg shadow-xl py-1 min-w-[140px]">
            {pinnedPresets.map((name) => (
              <button
                key={name}
                onClick={() => { applyPreset(name); setOpen(false); }}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-[11px] transition-colors',
                  activePreset === name
                    ? 'bg-th-elevated text-th-hi'
                    : 'text-th-2 hover:bg-th-elevated/60 hover:text-th-hi',
                )}
              >
                {name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Full-width left side: the pinned presets as inline buttons. */
export function InlinePinnedPresets() {
  const { activePreset, applyPreset, pinnedPresets } = useLayoutStore();
  if (pinnedPresets.length === 0) return null;

  return (
    <div style={noDragStyle} className="flex items-center gap-0.5 min-w-0">
      {pinnedPresets.map((name) => (
        <button
          key={name}
          onClick={() => applyPreset(name)}
          className={cn(
            'px-2 py-0.5 rounded text-[11px] font-medium transition-colors truncate',
            activePreset === name
              ? 'bg-th-elevated text-th-hi'
              : 'text-th-ghost hover:text-th-hi hover:bg-th-elevated/60',
          )}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
