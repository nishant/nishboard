import { buildBackupPayload } from './backup';
import { useLayoutStore } from '../store/layoutStore';
import { useThemeStore } from '../store/themeStore';
import { useAppSettingsStore } from '../store/settingsStore';
import { useStocksStore } from '../store/stocksStore';
import { useCryptoStore } from '../store/cryptoStore';
import { useNotesStore } from '../store/notesStore';
import { useHardwareStore } from '../store/hardwareStore';
import { useTasksStore } from '../store/tasksStore';
import { useTimersStore } from '../store/timersStore';
import { useCountdownStore } from '../store/countdownStore';
import { useWorldClockStore } from '../store/worldClockStore';

// Auto-export: any change to a persisted store schedules a debounced write of
// the (secret-free) settings payload through the main process into the
// user-chosen synced folder. Main no-ops when no folder is configured, so this
// costs one cheap IPC per settle. Changes are user-driven, not per-tick.

const DEBOUNCE_MS = 2000;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const json = JSON.stringify(buildBackupPayload(), null, 2);
    void window.electron?.backup?.write(json);
  }, DEBOUNCE_MS);
}

/** Idempotent; call once from App. No-op outside Electron. */
export function initAutoExport(): void {
  if (started || !window.electron?.backup) return;
  started = true;
  // Every zustand store persisted to localStorage (UI-only stores excluded).
  const stores = [
    useLayoutStore, useThemeStore, useAppSettingsStore, useStocksStore,
    useCryptoStore, useNotesStore, useHardwareStore, useTasksStore,
    useTimersStore, useCountdownStore, useWorldClockStore,
  ];
  for (const store of stores) store.subscribe(schedule);
}
