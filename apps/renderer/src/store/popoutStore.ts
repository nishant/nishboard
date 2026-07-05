import { create } from 'zustand';

/**
 * Which widgets are currently popped out into their own windows. Fed by the
 * main process (popout:changed broadcasts + an initial popout:list) via
 * PopoutSync in App — NOT persisted: the main process owns the truth.
 */
interface PopoutState {
  popped: string[];
  setPopped: (ids: string[]) => void;
}

export const usePopoutStore = create<PopoutState>()((set) => ({
  popped: [],
  setPopped: (popped) => set({ popped }),
}));
