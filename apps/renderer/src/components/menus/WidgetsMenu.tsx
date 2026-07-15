import { useState } from 'react';
import { Layers } from 'lucide-react';
import { useLayoutStore } from '../../store/layoutStore';
import { cn } from '../../lib/utils';
import { Backdrop, menuBtn, menuPanel, noDragStyle, WidgetPinList } from './primitives';

export function WidgetsMenu({ compact }: { compact: boolean }) {
  const { visibleWidgets, showWidget, hideWidget } = useLayoutStore();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative" style={noDragStyle}>
      <button onClick={() => setOpen((o) => !o)} className={menuBtn(open, compact)} title="Widgets">
        <Layers size={compact ? 13 : 11} />
        {!compact && 'Widgets'}
      </button>

      {open && (
        <>
          <Backdrop onClose={() => setOpen(false)} />
          {/* Wider than the base panel: rows carry two reorder arrows + pin. */}
          <div className={cn(menuPanel, 'min-w-[190px]')} style={noDragStyle}>
            <WidgetPinList
              visibleWidgets={visibleWidgets}
              showWidget={showWidget}
              hideWidget={hideWidget}
              pinTitle="Show widget"
              unpinTitle="Hide widget"
            />
          </div>
        </>
      )}
    </div>
  );
}
