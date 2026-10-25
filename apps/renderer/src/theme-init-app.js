// Runs right after @nish/ui's theme-init.js, inline in <head> before first paint
// (vite.config.ts injects both). @nish/ui's script only knows the shared themes
// and the `nish-theme` key; Nishboard's source of truth is its own persisted
// theme store (`dashboard-theme`), which can also hold an app-local preset or the
// Custom theme. Mirrors lib/appTheme.ts — keep the two in step.
// The three maps below are filled in by vite.config.ts.
(function () {
  var NISH = __NISH__; // shared theme → scheme
  var APP = __APP__; // app-local preset → scheme
  var LEGACY = __LEGACY__; // pre-@nish/ui theme ids → new ids
  var root = document.documentElement;
  var theme = null;
  try {
    var saved = JSON.parse(localStorage.getItem('dashboard-theme') || 'null');
    theme = saved && saved.state ? saved.state.theme : null;
    if (theme && (saved.version || 0) < 1 && LEGACY[theme]) theme = LEGACY[theme];
  } catch (e) {}
  if (!theme) return; // nothing saved: @nish/ui's choice (or the OS) stands
  var scheme;
  if (theme === 'system') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    scheme = NISH[theme];
  } else if (NISH[theme]) {
    scheme = NISH[theme];
  } else if (APP[theme]) {
    scheme = APP[theme];
  } else if (theme === 'custom') {
    try {
      var custom = JSON.parse(localStorage.getItem('dashboard-theme-custom-vars') || 'null');
      if (!custom) return;
      scheme = custom.scheme;
      for (var k in custom.vars) root.style.setProperty(k, custom.vars[k]);
    } catch (e) {
      return;
    }
  } else {
    return;
  }
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-scheme', scheme);
  root.style.colorScheme = scheme;
})();
