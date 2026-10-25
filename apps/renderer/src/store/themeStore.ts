import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isThemeId, migrateThemeId, type ThemeId } from '../themes';

export interface CustomColors {
  primary:   string; // '#rrggbb' — page background
  secondary: string; // '#rrggbb' — card / tile background
  tertiary:  string; // '#rrggbb' — borders, small elements
  text:      string; // '#rrggbb' — primary text
}

export interface SavedCustomTheme {
  id: string;
  name: string;
  colors: CustomColors;
}

// The Custom editor's starting point: user data (the colors they then edit),
// not UI colors — the same neutral dark the old default theme used.
const DEFAULT_CUSTOM: CustomColors = {
  primary:   '#18181b',
  secondary: '#27272a',
  tertiary:  '#3f3f46',
  text:      '#ffffff',
};

interface ThemeState {
  theme: ThemeId;
  customColors: CustomColors;
  savedCustomThemes: SavedCustomTheme[];
  activeCustomId: string | null; // id of the saved theme that's active, or null if unsaved

  setTheme: (theme: ThemeId) => void;
  /** Update working colors. Clears activeCustomId (colors are now "unsaved"). */
  setCustomColors: (colors: CustomColors) => void;
  /** Save current customColors under a name; sets theme='custom' and activeCustomId. */
  saveCustomTheme: (name: string) => void;
  /** Remove a saved theme by id. */
  deleteCustomTheme: (id: string) => void;
  /** Load a saved theme's colors into customColors and activate it. */
  applyCustomTheme: (id: string) => void;
  /** Overwrite an existing saved theme's colors with the current customColors. */
  updateCustomTheme: (id: string) => void;
}

/** First run (nothing saved yet): adopt a choice already made through @nish/ui
 *  (`nish-theme`), else follow the OS ('system'), which is also what the pre-paint
 *  script shows, so a fresh install never flips light → dark on load. A saved
 *  choice always wins over this (persist rehydrates over it). */
function initialTheme(): ThemeId {
  try {
    const shared = localStorage.getItem('nish-theme');
    return isThemeId(shared) ? shared : 'system';
  } catch {
    return 'system';
  }
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: initialTheme(),
      customColors: DEFAULT_CUSTOM,
      savedCustomThemes: [],
      activeCustomId: null,

      setTheme: (theme) => set({ theme }),

      setCustomColors: (customColors) => set({ customColors, activeCustomId: null }),

      saveCustomTheme: (name) =>
        set((s) => {
          const id = crypto.randomUUID();
          return {
            savedCustomThemes: [...s.savedCustomThemes, { id, name, colors: s.customColors }],
            activeCustomId: id,
            theme: 'custom',
          };
        }),

      deleteCustomTheme: (id) =>
        set((s) => ({
          savedCustomThemes: s.savedCustomThemes.filter((t) => t.id !== id),
          activeCustomId: s.activeCustomId === id ? null : s.activeCustomId,
        })),

      applyCustomTheme: (id) =>
        set((s) => {
          const found = s.savedCustomThemes.find((t) => t.id === id);
          if (!found) return s;
          return { theme: 'custom', customColors: found.colors, activeCustomId: id };
        }),

      updateCustomTheme: (id) =>
        set((s) => ({
          savedCustomThemes: s.savedCustomThemes.map((t) =>
            t.id === id ? { ...t, colors: { ...s.customColors } } : t,
          ),
          activeCustomId: id,
          theme: 'custom',
        })),
    }),
    {
      name: 'dashboard-theme',
      // v1: themes moved onto @nish/ui. midnight → dark, slate (light here) →
      // light; ocean/contrast/mocha keep their ids (now the shared presets);
      // the other presets keep theirs as app-local presets.
      version: 1,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<ThemeState>;
        if (version < 1) return { ...state, theme: migrateThemeId(state.theme) };
        return state;
      },
    },
  ),
);
