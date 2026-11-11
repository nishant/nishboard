import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type HardwareSection = 'cpu' | 'gpu' | 'ram' | 'disk' | 'network' | 'battery';

interface HardwareState {
  visible: Record<HardwareSection, boolean>;
  setVisible: (section: HardwareSection, value: boolean) => void;
}

export const HARDWARE_SECTIONS: readonly HardwareSection[] = ['cpu', 'gpu', 'ram', 'disk', 'network', 'battery'];

const DEFAULT_VISIBLE: Record<HardwareSection, boolean> = {
  cpu: true,
  gpu: true,
  ram: true,
  disk: true,
  network: true,
  battery: true,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isHardwareSection(v: string): v is HardwareSection {
  return HARDWARE_SECTIONS.some((s) => s === v);
}

export const useHardwareStore = create<HardwareState>()(
  persist(
    (set) => ({
      visible: { ...DEFAULT_VISIBLE },
      setVisible: (section, value) =>
        set((s) => ({ visible: { ...s.visible, [section]: value } })),
    }),
    {
      name: 'hardware-config',
      // persist's default merge is shallow: a stored `visible` would replace the
      // defaults whole, so a section added later would be undefined (hidden).
      // Deep-merge the stored booleans over the defaults instead.
      merge: (persisted, current) => {
        const visible = { ...current.visible };
        if (isRecord(persisted) && isRecord(persisted.visible)) {
          for (const [key, value] of Object.entries(persisted.visible)) {
            if (isHardwareSection(key) && typeof value === 'boolean') visible[key] = value;
          }
        }
        return { ...current, visible };
      },
    },
  ),
);
