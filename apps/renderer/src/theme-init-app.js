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
  var APP = __APP__; // app-local preset → scheme
  var LEGACY = __LEGACY__; // pre-@nish/ui theme ids → new ids
  var extra = {};
  for (var id in APP) extra[id] = APP[id];
  try {
    var custom = JSON.parse(localStorage.getItem('dashboard-theme-custom-vars') || 'null');
    if (custom) extra.custom = custom.scheme;
    var saved = JSON.parse(localStorage.getItem('dashboard-theme') || 'null');
    var theme = saved && saved.state ? saved.state.theme : null;
    if (theme && (saved.version || 0) < 1 && LEGACY[theme]) theme = LEGACY[theme];
    if (theme === 'custom' && custom) {
      for (var k in custom.vars) document.documentElement.style.setProperty(k, custom.vars[k]);
    }
    if (theme) localStorage.setItem('nish-theme', theme);
  } catch (e) {}
  window.__nishExtraThemes = extra;
})();
