import { useState } from 'react';
import { LayoutGrid, ChevronDown } from 'lucide-react';
import { useLayoutStore } from '../../store/layoutStore';
import { Button, DropdownMenu, MenuItem, cn } from '@nish/ui';

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
    <div className="app-region-no-drag">
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
        aria-label="Pinned layouts"
        className="app-region-no-drag min-w-[140px]"
        trigger={
          <Button
            variant="ghost"
            size="xs"
            title="Switch pinned layout"
            className={cn('max-w-[140px] gap-1 pl-1.5 pr-1', open ? 'bg-th-elevated text-th-hi' : 'text-th-hi3')}
          >
            <LayoutGrid size={11} className="shrink-0" />
            <span className="truncate">{label}</span>
            <ChevronDown size={10} className={cn('shrink-0 transition-transform', open && 'rotate-180')} />
          </Button>
        }
      >
        {entries.map((e) => (
          <MenuItem key={e.key} active={e.active} onSelect={e.apply} className="text-2xs">
            {e.label}
          </MenuItem>
        ))}
      </DropdownMenu>
    </div>
  );
}

/** Full-width left side: the pinned layouts (presets + customs) as inline buttons. */
export function InlinePinnedLayouts() {
  const entries = usePinnedEntries();
  if (entries.length === 0) return null;

  return (
    <div className="app-region-no-drag flex items-center gap-0.5 min-w-0">
      {entries.map((e) => (
        <Button
          key={e.key}
          variant="ghost"
          size="xs"
          onClick={e.apply}
          aria-pressed={e.active}
          className={cn('truncate', e.active ? 'bg-th-elevated text-th-hi' : 'text-th-hi3')}
        >
          {e.label}
        </Button>
      ))}
    </div>
  );
}
