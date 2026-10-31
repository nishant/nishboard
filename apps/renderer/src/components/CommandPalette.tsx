import { useEffect, useRef, useState } from 'react';
import { CommandPalette as UiCommandPalette } from '@nish/ui';
import { buildRows, collectActions, refreshSources } from '../lib/commandRegistry';
import type { PaletteAction } from '../lib/commandRegistry';
import { useOverlayStore } from '../store/overlayStore';

// In-app command palette (per scope: NOT a global shortcut), rendered by the
// shared @nish/ui CommandPalette in function mode. Open with mod+K or
// double-Shift (<300ms). Recents float on an empty query.

const DOUBLE_SHIFT_MS = 300;

/** Global open shortcuts — mounted once (inside CommandPalette). */
function useOpenShortcuts() {
  const setPaletteOpen = useOverlayStore((s) => s.setPaletteOpen);
  useEffect(() => {
    let lastShiftDown = 0;
    let shiftChordBroken = false;
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = navigator.platform.toLowerCase().includes('mac') ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!useOverlayStore.getState().paletteOpen);
        return;
      }
      if (e.key === 'Shift') {
        if (e.repeat) return;
        const now = performance.now();
        if (!shiftChordBroken && now - lastShiftDown < DOUBLE_SHIFT_MS) {
          lastShiftDown = 0;
          setPaletteOpen(true);
        } else {
          lastShiftDown = now;
          shiftChordBroken = false;
        }
      } else {
        // Any other key between the two Shifts (e.g. Shift+A typing) breaks the chord.
        shiftChordBroken = true;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setPaletteOpen]);
}

export function CommandPalette() {
  useOpenShortcuts();
  const open = useOverlayStore((s) => s.paletteOpen);
  const setOpen = useOverlayStore((s) => s.setPaletteOpen);
  const actionsRef = useRef<PaletteAction[]>([]);
  const typedRef = useRef(false);
  const [remountKey, setRemountKey] = useState(0);

  // Snapshot actions on every open (sources reflect live state). Launcher items
  // live behind async IPC: once the refreshers settle, re-collect and, if the
  // user has not typed yet, remount the ui palette so the new rows show.
  useEffect(() => {
    if (!open) return;
    actionsRef.current = collectActions();
    typedRef.current = false;
    let cancelled = false;
    void refreshSources().then(() => {
      if (cancelled) return;
      actionsRef.current = collectActions();
      if (!typedRef.current) setRemountKey((k) => k + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <UiCommandPalette
      key={remountKey}
      open={open}
      onOpenChange={setOpen}
      hotkey={false}
      placeholder="Type a command…"
      emptyText="No matching commands"
      onQuery={(q) => {
        typedRef.current = q !== '';
      }}
      items={(q) => buildRows(q, actionsRef.current)}
      footer={
        <p className="text-th-hi3 text-3xs">
          ↑↓ navigate · Enter run · type &quot;timer 25m&quot;, &quot;task …&quot;, &quot;volume 40&quot;
        </p>
      }
    />
  );
}
