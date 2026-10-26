import { useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import { useLayoutStore } from '../../store/layoutStore';
import { MenuPopover, MenuTrigger, WidgetPinList } from './primitives';

export function WidgetsMenu({ compact }: { compact: boolean }) {
  const { visibleWidgets, showWidget, hideWidget } = useLayoutStore();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="app-region-no-drag">
      <MenuTrigger
        ref={triggerRef}
        compact={compact}
        open={open}
        name="Widgets"
        icon={(size) => <Layers size={size} />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />

      {/* Wider than the base panel: rows carry two reorder arrows + pin. */}
      <MenuPopover open={open} onOpenChange={setOpen} anchor={triggerRef} label="Widgets" className="min-w-[190px]">
        <WidgetPinList
          visibleWidgets={visibleWidgets}
          showWidget={showWidget}
          hideWidget={hideWidget}
          pinTitle="Show widget"
          unpinTitle="Hide widget"
        />
      </MenuPopover>
    </div>
  );
}
