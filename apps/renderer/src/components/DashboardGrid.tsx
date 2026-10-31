import { useState, useEffect, useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import ReactGridLayout, { WidthProvider } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import { useLayoutStore, collapsedRowsFor } from '../store/layoutStore';
import { useDiscordStore } from '../store/discordStore';
import { useAppSettingsStore } from '../store/settingsStore';
import { usePopoutStore } from '../store/popoutStore';
import { useWidgetUiStore } from '../store/widgetUiStore';
import { WidgetShell } from './WidgetShell';
import { TITLEBAR_H } from './Titlebar';
import { WIDGET_TITLES, NARROW_ROW_HEIGHT, gridColumnsFor, deriveNarrowLayout } from '../lib/layouts';
import { WIDGET_REGISTRY } from '../widgets/registry';
import { useElementSize } from '../hooks/useElementSize';
import type { WidgetId } from '../lib/layouts';
import { HeaderAction } from './HeaderAction';
import { Button, EmptyState, cn } from '@nish/ui';

const GridLayout = WidthProvider(ReactGridLayout);

/** Rightmost header action on EVERY widget: float it in its own window.
 *  Hidden in the plain browser (no Electron popout API). */
function PopoutAction({ id }: { id: WidgetId }) {
  if (!window.electron?.popout) return null;
  return (
    <HeaderAction title="Pop out" onClick={() => window.electron!.popout.open(id)}>
      <ExternalLink size={12} />
    </HeaderAction>
  );
}

/** Body shown in the grid tile while its widget lives in a popout window —
 *  the real widget renders only there (no double polling / double chimes). */
function PoppedPlaceholder({ id }: { id: WidgetId }) {
  return (
    <EmptyState
      compact
      className="h-full"
      icon={<ExternalLink size={18} />}
      title="Popped out"
      action={
        <Button size="sm" variant="subtle" onClick={() => window.electron?.popout?.close(id)}>
          Bring back
        </Button>
      }
    />
  );
}

function useRowHeight(layout: Layout[], gap: number): number {
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);

  useEffect(() => {
    const onResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const numRows = useMemo(
    () => Math.max(...layout.map((item) => item.y + item.h), 1),
    [layout],
  );

  // Solve: availHeight = numRows * rowHeight + (numRows - 1) * gap [margin] + 2 * gap [padding]
  const availHeight = windowHeight - TITLEBAR_H;
  return Math.max(10, (availHeight - (numRows - 1) * gap - 2 * gap) / numRows);
}

export function DashboardGrid() {
  const { layout, syncLayout, markUserEdited, visibleWidgets, setWidgetCollapsed } = useLayoutStore();
  // ANY tile's drag/resize gesture flips this: the Discord host freezes its
  // size and mutes pointer events for the duration (the webview otherwise
  // relayouts per mousemove and eats the grid's drag events). Simplest to set
  // it for every gesture — harmless when the Discord tile isn't around.
  const setDiscordInteracting = useDiscordStore((s) => s.setInteracting);
  const density = useAppSettingsStore((s) => s.density);
  const disabledWidgets = useAppSettingsStore((s) => s.disabledWidgets);
  const popped = usePopoutStore((s) => s.popped);
  const collapsed = useWidgetUiStore((s) => s.collapsed);
  const setCollapsedFlag = useWidgetUiStore((s) => s.setCollapsed);
  const gap = density === 'compact' ? 4 : 8;

  // RGL's stock CSS animates every position change — including the initial
  // layout pass, which makes tiles fly in from the corner on launch. Suppress
  // transitions until the first layout has settled.
  const [animReady, setAnimReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAnimReady(true), 350);
    return () => clearTimeout(t);
  }, []);

  // Only pass visible items to the grid; hidden items stay in `layout` with
  // their positions intact so they snap back when re-enabled. Disabled widgets
  // (Settings → Widgets) are excluded too — covers stale persisted
  // visibleWidgets that still contain a disabled id.
  const visibleLayout = useMemo(
    () =>
      layout.filter(
        (item) =>
          visibleWidgets.includes(item.i as WidgetId) &&
          !disabledWidgets.includes(item.i as WidgetId),
      ),
    [layout, visibleWidgets, disabledWidgets],
  );

  const rowHeight = useRowHeight(visibleLayout, gap);

  // Reconcile collapsed-item heights with the live, viewport-derived rowHeight.
  // Covers two cases the store can't handle alone: (1) reload — onRehydrateStorage
  // re-locks collapsed items but keeps their stale h; (2) window resize changes
  // rowHeight, so the rows needed to show just a title bar changes. Patch the lock
  // directly via syncLayout — NOT setWidgetCollapsed, which would clobber the real
  // savedHeights entry with the already-collapsed height.
  useEffect(() => {
    const target = collapsedRowsFor(rowHeight, gap);
    const store = useLayoutStore.getState();
    const needsPatch = store.layout.some(
      (it) => collapsed[it.i as WidgetId] && it.h !== target,
    );
    if (!needsPatch) return;
    store.syncLayout(
      store.layout.map((it) =>
        collapsed[it.i as WidgetId]
          ? { ...it, h: target, minH: target, maxH: target, isResizable: false }
          : it,
      ),
    );
  }, [rowHeight, gap, collapsed]);

  // Below 1200px of grid width the grid renders a layout derived from the desktop
  // one (never saved): fixed row height, no drag/resize, the page scrolls. Until
  // the first measure lands we assume the window width so desktop doesn't flash narrow.
  const { ref: setWrapperEl, width: measuredWidth } = useElementSize<HTMLDivElement>();
  const cols = gridColumnsFor(measuredWidth > 0 ? measuredWidth : window.innerWidth);
  const narrow = cols !== 24;
  const collapsedIds = useMemo(
    () => new Set(Object.keys(collapsed).filter((id) => collapsed[id as WidgetId])),
    [collapsed],
  );
  const gridLayout = useMemo(
    () =>
      cols === 24
        ? visibleLayout
        : deriveNarrowLayout(visibleLayout, cols, collapsedIds, collapsedRowsFor(NARROW_ROW_HEIGHT, gap)),
    [cols, visibleLayout, collapsedIds, gap],
  );

  return (
    <div
      ref={setWrapperEl}
      className={cn('h-full', narrow ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden')}
    >
    <GridLayout
      className={cn(!animReady && 'rgl-no-anim')}
      layout={gridLayout}
      cols={cols}
      rowHeight={narrow ? NARROW_ROW_HEIGHT : rowHeight}
      margin={[gap, gap]}
      containerPadding={[gap, gap]}
      draggableHandle=".widget-drag-handle"
      onLayoutChange={narrow ? undefined : (newVisible) => {
        // Merge incoming positions with stored positions of hidden widgets so
        // drag/resize doesn't wipe out hidden-widget position state. This also
        // fires on mount and after applyPreset, so it must only sync geometry —
        // clearing the active-preset markers here would wipe the highlight on
        // every launch. Real edits are detected by the gesture handlers below.
        const visibleIds = new Set(newVisible.map((i) => i.i));
        const hiddenItems = layout.filter((i) => !visibleIds.has(i.i));
        syncLayout([...newVisible, ...hiddenItems]);
      }}
      onDragStart={narrow ? undefined : () => setDiscordInteracting(true)}
      onResizeStart={narrow ? undefined : () => setDiscordInteracting(true)}
      onDragStop={narrow ? undefined : () => {
        setDiscordInteracting(false);
        markUserEdited();
      }}
      onResizeStop={narrow ? undefined : () => {
        setDiscordInteracting(false);
        markUserEdited();
      }}
      compactType="vertical"
      isResizable={!narrow}
      isDraggable={!narrow}
      resizeHandles={['se', 'sw', 'ne', 'nw', 'e', 'w', 's', 'n']}
    >
      {gridLayout.map((item) => {
        const id = item.i as WidgetId;
        const { Component, Actions } = WIDGET_REGISTRY[id];
        const isPopped = popped.includes(id);
        const isCollapsed = collapsed[id] ?? false;
        return (
          <div key={id}>
            <WidgetShell
              title={WIDGET_TITLES[id]}
              collapsed={isCollapsed}
              onToggleCollapse={() => {
                const next = !isCollapsed;
                // Keep the two stores in lockstep: the boolean drives the body,
                // the layout action drives the height lock.
                setCollapsedFlag(id, next);
                setWidgetCollapsed(id, next, rowHeight, gap);
              }}
              actions={
                <>
                  {Actions && <Actions />}
                  <PopoutAction id={id} />
                </>
              }
            >
              {isPopped ? <PoppedPlaceholder id={id} /> : <Component />}
            </WidgetShell>
          </div>
        );
      })}
    </GridLayout>
    </div>
  );
}
