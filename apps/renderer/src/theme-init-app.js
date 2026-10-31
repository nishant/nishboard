// Runs right before @nish/ui's theme-init.js, inline at the top of <head>
// (vite.config.ts injects both as one script). It paints nothing itself; it only
// tells the shared script what it cannot know on its own:
//  - Nishboard's own theme ids (window.__nishExtraThemes, also passed to
//    registerThemes in lib/appTheme.ts), including Custom with its saved scheme;
//  - the saved choice. Nishboard's source of truth is its theme store
//    (`dashboard-theme`), which also holds pre-@nish/ui ids (store version 0,
//    e.g. 'midnight'); it is mirrored into `nish-theme` for theme-init.js.
//  - the Custom theme's colors, set inline on <html>.
// The two maps below are filled in by vite.config.ts.
(function () {
  const APP = __APP__; // app-local preset → scheme
  const LEGACY = __LEGACY__; // pre-@nish/ui theme ids → new ids
  const extra = {};
  for (const id in APP) extra[id] = APP[id];
  try {
    const custom = JSON.parse(localStorage.getItem('dashboard-theme-custom-vars') || 'null');
    if (custom) extra.custom = custom.scheme;
    const saved = JSON.parse(localStorage.getItem('dashboard-theme') || 'null');
    let theme = saved && saved.state ? saved.state.theme : null;
    if (theme && (saved.version || 0) < 1 && LEGACY[theme]) theme = LEGACY[theme];
    if (theme === 'custom' && custom) {
      for (const k in custom.vars) document.documentElement.style.setProperty(k, custom.vars[k]);
    }
    if (theme) localStorage.setItem('nish-theme', theme);
  } catch (e) {
    // storage unavailable or corrupt: the shared script falls back to its defaults
  }
  window.__nishExtraThemes = extra;
})();
