import { GripHorizontal, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { HeaderAction } from './HeaderAction';

interface WidgetShellProps {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /** Accordion state — when true the body is dropped and only the title bar shows. */
  collapsed?: boolean;
  /** Toggle handler for the chevron. Omit to hide the collapse control. */
  onToggleCollapse?: () => void;
}

export function WidgetShell({ title, children, actions, className, collapsed = false, onToggleCollapse }: WidgetShellProps) {
  // The chevron and the widget's own actions share the hover-revealed row. The
  // chevron is FIRST so its position is stable across widgets.
  const actionRow = (onToggleCollapse || actions) && (
    <div
      // Hover-revealed action row — stays visible while any action has focus
      className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/wsh:opacity-100 focus-within:opacity-100 transition-opacity"
      style={{ cursor: 'default' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {onToggleCollapse && (
        <HeaderAction title={collapsed ? 'Expand' : 'Collapse'} onClick={onToggleCollapse}>
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </HeaderAction>
      )}
      {actions}
    </div>
  );

  return (
    <div className={cn('h-full flex flex-col rounded-lg border border-th-line bg-th-surface overflow-hidden', className)}>
      <div className="widget-drag-handle group/wsh flex items-center gap-2 px-3 py-2 border-b border-th-line cursor-grab active:cursor-grabbing select-none shrink-0">
        <GripHorizontal className="w-3.5 h-3.5 text-th-ghost" />
        <span className="text-xs font-medium text-th-3 uppercase tracking-widest">{title}</span>
        {actionRow}
      </div>
      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-hidden">
          {children}
        </div>
      )}
    </div>
  );
}
