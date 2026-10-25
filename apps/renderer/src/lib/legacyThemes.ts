// Kept dependency-free: vite.config.ts bakes it into the pre-paint init script.

/** Theme ids from before @nish/ui (store version 0) → their equivalents now.
 *  midnight was the zinc dark default, slate was light here (the shared 'slate'
 *  is a dark theme), ocean/contrast/mocha have shared counterparts; the other
 *  presets kept their ids as app-local presets. */
export const LEGACY_THEME_IDS: Record<string, string> = {
  midnight: 'dark',
  slate: 'light',
};
