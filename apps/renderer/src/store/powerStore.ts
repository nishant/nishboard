import { create } from 'zustand';

/**
 * Runtime power/visibility signals feeding the poll gate (useGatedInterval).
 * Not persisted — both values are observations, not preferences.
 *
 * - `hidden` tracks document visibility (window minimized / hidden to tray).
 * - `onBattery` is fed by the hardware poll (useHardware) and reset to false
 *   when that hook unmounts, so lowPower 'auto' only engages while battery
 *   telemetry is actually flowing (a removed Hardware widget never leaves it
 *   stuck at true).
 */
interface PowerState {
  onBattery: boolean;
  hidden: boolean;
  setOnBattery: (onBattery: boolean) => void;
  setHidden: (hidden: boolean) => void;
}

export const usePowerStore = create<PowerState>()((set) => ({
  onBattery: false,
  hidden: typeof document !== 'undefined' ? document.hidden : false,
  setOnBattery: (onBattery) => set({ onBattery }),
  setHidden: (hidden) => set({ hidden }),
}));

// Single module-level listener — every useGatedInterval call site subscribes
// to the store rather than each adding its own DOM listener.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    usePowerStore.getState().setHidden(document.hidden);
  });
}
