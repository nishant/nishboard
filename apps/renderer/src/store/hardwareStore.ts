import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type HardwareSection = 'cpu' | 'gpu' | 'ram' | 'disk' | 'network' | 'battery';

interface HardwareState {
  visible: Record<HardwareSection, boolean>;
  setVisible: (section: HardwareSection, value: boolean) => void;
}

export const useHardwareStore = create<HardwareState>()(
  persist(
    (set) => ({
      visible: {
        cpu: true,
        gpu: true,
        ram: true,
        disk: true,
        network: true,
        battery: true,
      },
      setVisible: (section, value) =>
        set((s) => ({ visible: { ...s.visible, [section]: value } })),
    }),
    { name: 'hardware-config' },
  ),
);
