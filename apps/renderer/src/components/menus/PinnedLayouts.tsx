import { useState } from 'react';
import { LayoutGrid, ChevronDown } from 'lucide-react';
import { useLayoutStore } from '../../store/layoutStore';
import { cn } from '../../lib/utils';
import { Backdrop, noDragStyle } from './primitives';

/** One titlebar quick-switch chip — a pinned preset (name-keyed) or a pinned
 *  saved custom layout (id-keyed). */
interface PinnedEntry {
  key: string;
  label: string;
  active: boolean;
  apply: () => void;
}

/** Presets first, then custom layouts, each in their pin order. Pinned ids
 *  whose layout was deleted are filtered store-side, but stay defensive. */
function usePinnedEntries(): PinnedEntry[] {
  const {
    activePreset, applyPreset, pinnedPresets,
    pinnedCustomLayouts, savedCustomLayouts, activeCustomLayoutId, applyCustomLayout,
  } = useLayoutStore();

  const presets: PinnedEntry[] = pinnedPresets.map((name) => ({
    key: `preset:${name}`,
    label: name,
    active: activePreset === name,
    apply: () => applyPreset(name),
  }));

  const customs: PinnedEntry[] = pinnedCustomLayouts.flatMap((id) => {
    const cl = savedCustomLayouts.find((l) => l.id === id);
    if (!cl) return [];
    return [{
      key: `custom:${id}`,
      label: cl.name,
      active: activeCustomLayoutId === id,
      apply: () => applyCustomLayout(id),
    }];
  });

  return [...presets, ...customs];
}

/** Compact left-side quick-switcher: the pinned layouts collapsed into a dropdown. */
export function PinnedLayoutsMenu() {
  const entries = usePinnedEntries();
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;

  // Show the active layout's name when it's a pinned one; otherwise a neutral label.
  const label = entries.find((e) => e.active)?.label ?? 'Layouts';

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
            {entries.map((e) => (
              <button
                key={e.key}
                onClick={() => { e.apply(); setOpen(false); }}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-[11px] transition-colors',
                  e.active
                    ? 'bg-th-elevated text-th-hi'
                    : 'text-th-2 hover:bg-th-elevated/60 hover:text-th-hi',
                )}
              >
                {e.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Full-width left side: the pinned layouts (presets + customs) as inline buttons. */
export function InlinePinnedLayouts() {
  const entries = usePinnedEntries();
  if (entries.length === 0) return null;

  return (
    <div style={noDragStyle} className="flex items-center gap-0.5 min-w-0">
      {entries.map((e) => (
        <button
          key={e.key}
          onClick={e.apply}
          className={cn(
            'px-2 py-0.5 rounded text-[11px] font-medium transition-colors truncate',
            e.active
              ? 'bg-th-elevated text-th-hi'
              : 'text-th-ghost hover:text-th-hi hover:bg-th-elevated/60',
          )}
        >
          {e.label}
        </button>
      ))}
    </div>
  );
}
