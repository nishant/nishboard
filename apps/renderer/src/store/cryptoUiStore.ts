import { create } from 'zustand';

// Non-persisted — lets the WidgetShell header pencil open the widget-body modal.
interface CryptoUiState {
  editing: boolean;
  setEditing: (editing: boolean) => void;
}

export const useCryptoUiStore = create<CryptoUiState>((set) => ({
  editing: false,
  setEditing: (editing) => set({ editing }),
}));
