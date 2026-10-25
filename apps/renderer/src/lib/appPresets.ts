// Nishboard's own theme presets, on top of the shared @nish/ui themes (dark,
// light, slate, terminal, mocha, ocean, contrast). Each lists only the colors that
// give it its character; lib/themeVars.ts derives the rest, and
// `pnpm --filter @dash/renderer gen:themes` writes src/styles/app-themes.css.
// Dependency-free: the generator runs this file under plain Node.
import type { ThemeBase } from './themeVars.ts';

export type AppPresetId =
  | 'rose'
  | 'forest'
  | 'sunset'
  | 'dracula'
  | 'nord'
  | 'solarized'
  | 'crimson'
  | 'neon'
  | 'sandstorm'
  | 'arctic';

export interface AppPreset {
  id: AppPresetId;
  name: string;
  /** Preview dot in the theme pickers (a data color, not a UI token). */
  swatch: string;
  base: ThemeBase;
}

export const APP_PRESETS: AppPreset[] = [
  {
    id: 'rose', name: 'Rose', swatch: '#3f1c32',
    base: { scheme: 'dark', bg: '#0f050a', surface: '#1a0a12', elevated: '#2a1020', overlay: '#3c1a2f', hi: '#ffe4f2', hi2: '#f9a8d4', hi3: '#d878af', ghost: '#8c466c', accent: '#f0abfc', invertBg: '#f0abfc', invertText: '#0f050a' },
  },
  {
    id: 'forest', name: 'Forest', swatch: '#14261c',
    base: { scheme: 'dark', bg: '#070f0b', surface: '#0c1812', elevated: '#14261c', overlay: '#1e3628', hi: '#dcfce7', hi2: '#86efac', hi3: '#4a986e', ghost: '#34644a', accent: '#a3e635', invertBg: '#a3e635', invertText: '#070f0b' },
  },
  {
    id: 'sunset', name: 'Sunset', swatch: '#301a0f',
    base: { scheme: 'dark', bg: '#140a06', surface: '#20110a', elevated: '#301a0f', overlay: '#422616', hi: '#ffedd5', hi2: '#fdba74', hi3: '#c88246', ghost: '#825432', accent: '#fb923c', invertBg: '#fb923c', invertText: '#140a06' },
  },
  {
    id: 'dracula', name: 'Dracula', swatch: '#bd93f9',
    base: { scheme: 'dark', bg: '#151224', surface: '#201c34', elevated: '#2e2a46', overlay: '#3e3a5a', line: '#3e3a5a', hi: '#f8f8f2', hi2: '#bd93f9', hi3: '#969cb8', ghost: '#6272a4', accent: '#ff79c6', invertBg: '#bd93f9', invertText: '#201c34' },
  },
  {
    id: 'nord', name: 'Nord', swatch: '#88c0d0',
    base: { scheme: 'dark', bg: '#181e2e', surface: '#242e42', elevated: '#343e54', overlay: '#445068', hi: '#eceff4', hi2: '#d8dee9', hi3: '#8f98aa', ghost: '#4c566a', accent: '#88c0d0', invertBg: '#88c0d0', invertText: '#181e2e' },
  },
  {
    id: 'solarized', name: 'Solarized', swatch: '#fdf6e3',
    base: { scheme: 'light', bg: '#fdf6e3', surface: '#eee8d5', elevated: '#e0dac7', overlay: '#d3cdbb', line: '#d3cdbb', hi: '#073642', hi2: '#586e75', hi3: '#657b83', ghost: '#93a1a1', accent: '#268bd2', invertBg: '#073642', invertText: '#fdf6e3' },
  },
  {
    id: 'crimson', name: 'Crimson', swatch: '#2e1014',
    base: { scheme: 'dark', bg: '#120608', surface: '#1e0a0d', elevated: '#2e1014', overlay: '#40181e', hi: '#fee2e2', hi2: '#fca5a5', hi3: '#c86e6e', ghost: '#824648', accent: '#f87171', invertBg: '#f87171', invertText: '#120608' },
  },
  {
    id: 'neon', name: 'Neon', swatch: '#1a142c',
    base: { scheme: 'dark', bg: '#080610', surface: '#100c1c', elevated: '#1a142c', overlay: '#261e3e', hi: '#f0f0ff', hi2: '#67e8f9', hi3: '#6e82b4', ghost: '#463c6e', accent: '#e879f9', invertBg: '#e879f9', invertText: '#080610' },
  },
  {
    id: 'sandstorm', name: 'Sandstorm', swatch: '#f5f0e6',
    base: { scheme: 'light', bg: '#f5f0e6', surface: '#fffcf5', elevated: '#eae2d2', overlay: '#dcd2be', line: '#dcd2be', hi: '#3c3020', hi2: '#6e5c40', hi3: '#8c7a5c', ghost: '#b4a48a', accent: '#c27828', invertBg: '#3c3020', invertText: '#f5f0e6' },
  },
  {
    id: 'arctic', name: 'Arctic', swatch: '#f0f7ff',
    base: { scheme: 'light', bg: '#f0f7ff', surface: '#ffffff', elevated: '#e0eefc', overlay: '#c8def4', line: '#c8def4', hi: '#0c2240', hi2: '#335582', hi3: '#5a7aa5', ghost: '#96b4d7', accent: '#0e74d7', invertBg: '#0c2240', invertText: '#f0f7ff' },
  },
];
