import { useState } from 'react';
import { Layers } from 'lucide-react';
import { useLayoutStore } from '../../store/layoutStore';
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
          <div className={menuPanel} style={noDragStyle}>
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
