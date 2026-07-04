import { create } from 'zustand';

// Non-persisted UI state shared between the StocksWidget body and its
// WidgetShell header actions (the watchlist-edit pencil lives in the shell row).
interface StocksUiState {
  editing: boolean;
  setEditing: (v: boolean) => void;
}

export const useStocksUiStore = create<StocksUiState>((set) => ({
  editing: false,
  setEditing: (editing) => set({ editing }),
}));
