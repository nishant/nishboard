# Changelog

All changes organized by pull request, newest first.

---

## feat: bake all API keys into build, hide from Settings UI
**Branch:** `fix/spotify-client-id` → `master`
**Date:** 2026-06-28

### Changed
- `packages/server/build.mjs` — bakes all credential keys (`SPOTIFY_CLIENT_ID`, `YOUTUBE_API_KEY`, `ALPACA_API_KEY`, `ALPACA_API_SECRET`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`) from root `.env` at package time via esbuild `--define`. Values are in the compiled bundle, not in source or git.
- `packages/server/src/routes/youtube.ts`, `stocks.ts`, `twitch.ts`, `spotify.ts` — each route checks runtime env (safeStorage/Settings) first, falls back to `_BUILTIN` value.
- `packages/server/src/index.ts` — added `GET /api/credentials/builtin` endpoint that returns key *names* (never values) of pre-configured keys.
- `apps/renderer/src/components/SettingsModal.tsx` — fetches `/api/credentials/builtin` on open; shows a "Pre-configured" lock indicator instead of an input field for baked-in keys. Users can still override any key via Settings by adding their own value.

---

## fix: Spotify client_id baked in at build time
**Branch:** `fix/spotify-client-id` → `master`
**Date:** 2026-06-28

### Changed
- `packages/server/build.mjs` — new esbuild script (replaces inline CLI) that reads `SPOTIFY_CLIENT_ID` from root `.env` at package time and bakes it into the server bundle via esbuild `--define` as `SPOTIFY_CLIENT_ID_BUILTIN`. The value never appears in source; the variable name is gone from the compiled output.
- `packages/server/package.json` — build script now calls `node build.mjs`.
- `packages/server/src/routes/spotify.ts` — `clientId()` checks runtime env first (`SPOTIFY_CLIENT_ID` from Settings/safeStorage), falls back to the baked-in value.

Users who download the app get Spotify working with no setup. Users who enter their own Client ID in Settings override it.

---

## fix: Spotify "client_id: Not present" on login
**Branch:** `fix/spotify-client-id` → `master`
**Date:** 2026-06-28

### Fixed
- **Spotify login fails with "client_id: Not present"** — `SPOTIFY_CLIENT_ID` was read from `process.env` but was never part of the credentials system, so there was no way for users to set it. Added it to `CREDENTIAL_KEYS` and `CREDENTIAL_DEFS` so it appears in Settings and gets stored/injected like all other keys.
- **Redirect URI was empty** — `redirectUri()` fell back to `''` when `SPOTIFY_REDIRECT_URI` wasn't set. Changed default to `'http://localhost:7432/api/spotify/callback'` — the only valid value for this app.

### Changed
- `packages/shared/src/types/credentials.ts` — added `SPOTIFY_CLIENT_ID` with a hint pointing to developer.spotify.com.
- `packages/server/src/routes/spotify.ts` — `redirectUri()` defaults to `http://localhost:7432/api/spotify/callback`.
- `apps/renderer/src/components/SettingsModal.tsx` — `CredentialRow` now accepts and renders an optional `hint` line below the input; `hint` is wired through the `def.hint` field.

---

## fix: YouTube errors 152–154 via localhost embed proxy
**Branch:** `fix/server-port-conflict-youtube` → `master`
**Date:** 2026-06-28

### Fixed
- **YouTube errors 152–154 on all videos** — the previous `webRequest.onBeforeSendHeaders` interceptor injected `Referer: https://www.youtube.com/` on `*.googlevideo.com` CDN stream requests where no Referer existed. The CDN rejected those modified requests, causing playback errors on every video.
- **Root cause addressed properly** — instead of header spoofing, the YouTube widget now loads `http://localhost:7432/api/youtube/embed?videoId=...` (a new Fastify route) which serves a minimal HTML wrapper page containing the `youtube-nocookie.com` iframe. From YouTube's perspective the embed origin is `http://localhost:7432/` (a valid HTTP origin) rather than `file://`. This eliminates the null-origin rejection without touching any CDN traffic.
- **Removed `webRequest` interceptor** from `apps/main/src/index.ts` — only the UA-stripping fix remains.

### Changed
- `packages/server/src/routes/youtube.ts` — added `GET /api/youtube/embed?videoId=` route; videoId is validated against `/^[A-Za-z0-9_-]{6,16}$/` before injection to prevent XSS.
- `apps/renderer/src/widgets/youtube/YoutubeWidget.tsx` — iframe `src` now points to the local embed proxy instead of youtube-nocookie.com directly.
- `apps/main/src/index.ts` — removed `webRequest.onBeforeSendHeaders` block; kept Electron UA strip.

---

## fix: server port conflict on relaunch + YouTube Error 153 referrer
**Branch:** `fix/server-port-conflict-youtube` → `master`
**Date:** 2026-05-31

### Fixed
- **Every other launch APIs unresponsive** — `apps/main/src/server/spawn.ts`: on launch, `killStaleOnPort()` now runs before spawning the server. If a previous Electron instance crashed or exited before its server child fully died, the new launch clears the port first (`lsof -ti tcp:7432 | kill -9` on mac/linux, `netstat + taskkill` on Windows) so the new server always binds successfully.
- **YouTube Error 153** (second root cause) — `apps/main/src/index.ts`: added a `webRequest.onBeforeSendHeaders` interceptor that injects `Referer: https://www.youtube.com/` on all requests to `*.youtube.com`, `*.youtube-nocookie.com`, and `*.googlevideo.com`. In production the app loads from `file://` which sends a null referer; YouTube's embed player treats that as an unauthorized origin and returns Error 153. Note: if a specific video has embedding explicitly disabled by its uploader, Error 153 will still appear — that's a per-video restriction, not an app issue.

---

## fix: YouTube Error 153 (video player configuration error)
**Branch:** `fix/youtube-error-153` → `master`
**Date:** 2026-05-31

### Fixed
- **`apps/main/src/index.ts`** — strips `Electron/x.x.x` from the default session user-agent before any windows open. YouTube detects the Electron UA string and returns Error 153 "Video player configuration error" for most videos. Removing it makes the browser appear as plain Chrome and playback works normally.

---

## fix: `pnpm package` works on non-admin Windows
**Branch:** `fix/windows-build-cache` → `master`
**Date:** 2026-05-30

### Fixed
- `electron-builder` downloads `winCodeSign-2.6.0.7z` and extracts it with `7za`. The archive contains macOS dylib symlinks; on Windows, creating symlinks requires admin or Developer Mode, so `7za` exits with code 2 and the whole `electron-builder` run aborts before any Windows artifacts are produced. The Windows installer was unbuildable from a normal user account.
- Added **`scripts/prepare-wincodesign.cjs`** — a no-op on macOS/Linux. On Windows, it downloads the archive (if not already cached) and extracts it with `-xr!darwin` so `7za` never touches the symlink entries, then places the result at the cache path electron-builder expects (`%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0`). The darwin dylibs are unused for Windows builds.
- **`package.json`** — `package` script now runs the prep script before `electron-builder` and passes `CSC_IDENTITY_AUTO_DISCOVERY=false` (we don't have a Windows code signing cert).
- **`package.json`** — added `packageManager: "pnpm@11.3.0"` so Turbo 2.9 can resolve the workspace.

### Output
- `release/Nishboard Setup 0.1.0.exe` (79MB, NSIS installer, unsigned). Distributable as-is; end users see Windows SmartScreen "Windows protected your PC" → **More info → Run anyway**.

---

## feat: edit saved custom themes
**Branch:** `feat/edit-custom-themes` → `master`
**Date:** 2026-05-31

### Added
- **`themeStore.ts`** — `updateCustomTheme(id)` action: snapshots current `customColors` into the named saved entry, keeping the same `id` and `name`. Interface updated accordingly.
- **`Titlebar.tsx` `CustomEditor`** — accepts optional `editTarget?: SavedCustomTheme` and `onUpdate?: () => void`. In edit mode renders `Edit "<name>"` header and a single "Save changes" button instead of the name input + Save pair.
- **`Titlebar.tsx` `ThemeMenu`** — clicking a saved custom theme row now applies it (loads its colors) and opens the editor in edit mode. Tweaking colors via the pickers updates `customColors` live (same as before). "Save changes" snapshots current colors back into that entry. Back arrow returns without saving. Delete (X) unchanged.

---

## feat: edit saved custom layouts
**Branch:** `feat/edit-custom-layouts` → `master`
**Date:** 2026-05-30

### Added
- **`layoutStore.ts`** — `updateCustomLayout(id)` action: snapshots current `layout` and `visibleWidgets` into the named saved entry, keeping the same `id` and `name`. Interface updated accordingly.
- **`Titlebar.tsx` `CustomLayoutEditor`** — accepts optional `editTarget?: SavedCustomLayout` and `onUpdate?: () => void`. In edit mode renders `Edit "<name>"` header and a single "Save changes" button instead of the name input + Save pair.
- **`Titlebar.tsx` `LayoutsMenu`** — clicking a saved layout row now applies it immediately to the dashboard (so you can drag/resize) and opens the editor in edit mode. "Save changes" snapshots the current layout + visible widgets back into that entry. Back arrow returns to the custom list without saving. Delete (X) still works as before.

---

## feat: Spotify disconnect button
**Branch:** `feat/spotify-logout` → `master`
**Date:** 2026-05-31

### Added
- **`packages/server/src/routes/spotify.ts`** — `POST /api/spotify/logout`: clears the in-memory token, deletes `~/.dash/spotify_tokens.json`, and clears the now-playing cache. Server is immediately unauthenticated without restart.
- **`useSpotify.ts`** — `useSpotifyLogout` mutation: calls the logout endpoint and flips `spotify-status` query data to `{ authenticated: false }` optimistically.
- **`SpotifyWidget.tsx`** — small `LogOut` icon appears in the top-right corner of the widget on hover (opacity transition). Clicking it disconnects Spotify and returns the widget to the Connect screen.

---

## fix: presets restore visible widgets on apply (Default=all, Home=no twitch)
**Branch:** `fix/preset-visible-widgets` → `master`
**Date:** 2026-05-31

### Changed
- **`layouts.ts`** — `NamedLayout` gains optional `visibleWidgets?: WidgetId[]`. `Default` sets all 8 widgets; `Home` sets all except `twitch`. Other presets leave `visibleWidgets` unchanged (existing behaviour).
- **`layoutStore.ts`** — `applyPreset` now sets `visibleWidgets` to `preset.visibleWidgets` when the preset defines it, then regenerates the layout from that set.

---

## feat: update Home preset to match actual nish layout
**Branch:** `feat/home-preset-v2` → `master`
**Date:** 2026-05-31

### Changed
- **`layouts.ts`** — Home preset updated: YouTube (h=12) spans the full right width at top; Spotify (w=6, h=10) and Weather (w=6, h=10) sit side-by-side below it. Weather is now woven into the BSP tree. Twitch remains absent (falls to bottom-row overflow if toggled on).

## feat: add Home preset layout
**Branch:** `feat/home-preset` → `master`
**Date:** 2026-05-31

### Added
- **`layouts.ts`** — new `Home` built-in preset: Hardware + Sound stacked left (cols 0–5), Stocks + Calendar stacked middle (cols 6–11), YouTube + Spotify stacked right (cols 12–23). Twitch and Weather are absent from the BSP tree; if toggled on they fall to a bottom-row overflow via the existing `generateLayout` fallback.

---

## feat: saveable custom layouts with per-layout pinned tiles
**Branch:** `claude/code-session-connectivity-4ddFC` → `master`
**Date:** 2026-05-31

### Added
- **Custom layouts** — you can now arrange the dashboard (drag/resize tiles, pin/unpin which tiles show) and save it under a name. Saved layouts appear under **Layouts → Custom**, mirroring the existing **Themes → Custom** flow. Applying a saved layout restores both the tile geometry **and** that layout's pinned-tile set, so different layouts can show different widgets.
- **`apps/renderer/src/store/layoutStore.ts`** — new `SavedCustomLayout` type (`{ id, name, layout, visibleWidgets }`) plus `savedCustomLayouts`, `activeCustomLayoutId` state and `saveCustomLayout` / `deleteCustomLayout` / `applyCustomLayout` actions. `saveCustomLayout` snapshots the current `layout` + `visibleWidgets` (deep-copied so later edits don't mutate the saved entry). `applyCustomLayout` restores both. `onRehydrateStorage` back-fills the new fields for older persisted state.
- **`apps/renderer/src/components/Titlebar.tsx`** — `LayoutsMenu` reworked into a three-panel flow (`list` → `custom-list` → `editor`) like `ThemeMenu`. New `CustomLayoutEditor` (in-menu pin/unpin toggles that update `visibleWidgets` live + a *Save as* name field) and `LayoutDeleteModal` (delete confirmation). The editor panel intentionally renders **no backdrop** so the grid behind it stays draggable/resizable while you edit.

### Changed
- **`apps/renderer/src/store/layoutStore.ts`** — `setLayout`, `applyPreset`, `resetToDefault`, `showWidget`, and `hideWidget` now clear `activeCustomLayoutId` so the active-custom highlight only persists while the saved arrangement is unmodified (matching the theme store's `activeCustomId` semantics).

### Notes / gotchas
- `pinnedPresets` (pin a layout to the titlebar bar) is unchanged and still applies to built-in presets only — custom layouts are not bar-pinnable. "Pinned **tiles**" in the editor refers to visible widgets, a separate concept from bar-pinned presets.
- `visibleWidgets` remains global state; applying a custom layout overwrites it with that layout's stored set.
## feat: edit saved custom themes
**Branch:** `feat/edit-custom-themes` → `master`
**Date:** 2026-05-31

### Added
- **`themeStore.ts`** — `updateCustomTheme(id)` action: snapshots current `customColors` into the named saved entry, keeping the same `id` and `name`. Interface updated accordingly.
- **`Titlebar.tsx` `CustomEditor`** — accepts optional `editTarget?: SavedCustomTheme` and `onUpdate?: () => void`. In edit mode renders `Edit "<name>"` header and a single "Save changes" button instead of the name input + Save pair.
- **`Titlebar.tsx` `ThemeMenu`** — clicking a saved custom theme row now applies it (loads its colors) and opens the editor in edit mode. Tweaking colors via the pickers updates `customColors` live (same as before). "Save changes" snapshots current colors back into that entry. Back arrow returns without saving. Delete (X) unchanged.

---

## feat: edit saved custom layouts
**Branch:** `feat/edit-custom-layouts` → `master`
**Date:** 2026-05-30

### Added
- **`layoutStore.ts`** — `updateCustomLayout(id)` action: snapshots current `layout` and `visibleWidgets` into the named saved entry, keeping the same `id` and `name`. Interface updated accordingly.
- **`Titlebar.tsx` `CustomLayoutEditor`** — accepts optional `editTarget?: SavedCustomLayout` and `onUpdate?: () => void`. In edit mode renders `Edit "<name>"` header and a single "Save changes" button instead of the name input + Save pair.
- **`Titlebar.tsx` `LayoutsMenu`** — clicking a saved layout row now applies it immediately to the dashboard (so you can drag/resize) and opens the editor in edit mode. "Save changes" snapshots the current layout + visible widgets back into that entry. Back arrow returns to the custom list without saving. Delete (X) still works as before.

---

## feat: Spotify disconnect button
**Branch:** `feat/spotify-logout` → `master`
**Date:** 2026-05-31

### Added
- **`packages/server/src/routes/spotify.ts`** — `POST /api/spotify/logout`: clears the in-memory token, deletes `~/.dash/spotify_tokens.json`, and clears the now-playing cache. Server is immediately unauthenticated without restart.
- **`useSpotify.ts`** — `useSpotifyLogout` mutation: calls the logout endpoint and flips `spotify-status` query data to `{ authenticated: false }` optimistically.
- **`SpotifyWidget.tsx`** — small `LogOut` icon appears in the top-right corner of the widget on hover (opacity transition). Clicking it disconnects Spotify and returns the widget to the Connect screen.

---

## fix: presets restore visible widgets on apply (Default=all, Home=no twitch)
**Branch:** `fix/preset-visible-widgets` → `master`
**Date:** 2026-05-31

### Changed
- **`layouts.ts`** — `NamedLayout` gains optional `visibleWidgets?: WidgetId[]`. `Default` sets all 8 widgets; `Home` sets all except `twitch`. Other presets leave `visibleWidgets` unchanged (existing behaviour).
- **`layoutStore.ts`** — `applyPreset` now sets `visibleWidgets` to `preset.visibleWidgets` when the preset defines it, then regenerates the layout from that set.

---

## feat: update Home preset to match actual nish layout
**Branch:** `feat/home-preset-v2` → `master`
**Date:** 2026-05-31

### Changed
- **`layouts.ts`** — Home preset updated: YouTube (h=12) spans the full right width at top; Spotify (w=6, h=10) and Weather (w=6, h=10) sit side-by-side below it. Weather is now woven into the BSP tree. Twitch remains absent (falls to bottom-row overflow if toggled on).

## feat: add Home preset layout
**Branch:** `feat/home-preset` → `master`
**Date:** 2026-05-31

### Added
- **`layouts.ts`** — new `Home` built-in preset: Hardware + Sound stacked left (cols 0–5), Stocks + Calendar stacked middle (cols 6–11), YouTube + Spotify stacked right (cols 12–23). Twitch and Weather are absent from the BSP tree; if toggled on they fall to a bottom-row overflow via the existing `generateLayout` fallback.

---

## feat: saveable custom layouts with per-layout pinned tiles
**Branch:** `claude/code-session-connectivity-4ddFC` → `master`
**Date:** 2026-05-31

### Added
- **Custom layouts** — you can now arrange the dashboard (drag/resize tiles, pin/unpin which tiles show) and save it under a name. Saved layouts appear under **Layouts → Custom**, mirroring the existing **Themes → Custom** flow. Applying a saved layout restores both the tile geometry **and** that layout's pinned-tile set, so different layouts can show different widgets.
- **`apps/renderer/src/store/layoutStore.ts`** — new `SavedCustomLayout` type (`{ id, name, layout, visibleWidgets }`) plus `savedCustomLayouts`, `activeCustomLayoutId` state and `saveCustomLayout` / `deleteCustomLayout` / `applyCustomLayout` actions. `saveCustomLayout` snapshots the current `layout` + `visibleWidgets` (deep-copied so later edits don't mutate the saved entry). `applyCustomLayout` restores both. `onRehydrateStorage` back-fills the new fields for older persisted state.
- **`apps/renderer/src/components/Titlebar.tsx`** — `LayoutsMenu` reworked into a three-panel flow (`list` → `custom-list` → `editor`) like `ThemeMenu`. New `CustomLayoutEditor` (in-menu pin/unpin toggles that update `visibleWidgets` live + a *Save as* name field) and `LayoutDeleteModal` (delete confirmation). The editor panel intentionally renders **no backdrop** so the grid behind it stays draggable/resizable while you edit.

### Changed
- **`apps/renderer/src/store/layoutStore.ts`** — `setLayout`, `applyPreset`, `resetToDefault`, `showWidget`, and `hideWidget` now clear `activeCustomLayoutId` so the active-custom highlight only persists while the saved arrangement is unmodified (matching the theme store's `activeCustomId` semantics).

### Notes / gotchas
- `pinnedPresets` (pin a layout to the titlebar bar) is unchanged and still applies to built-in presets only — custom layouts are not bar-pinnable. "Pinned **tiles**" in the editor refers to visible widgets, a separate concept from bar-pinned presets.
- `visibleWidgets` remains global state; applying a custom layout overwrites it with that layout's stored set.

---

## fix: Windows master volume slider snaps to 0 + app mixer empty
**Branch:** `fix/sound-windows-v2` → `master`
**Date:** 2026-05-30

### Fixed
- **Master volume slider snapped to 0 after every commit.** `winGetDeviceData()` parsed `Get-AudioDevice -PlaybackVolume` as a plain number, but the AudioDeviceCmdlets module returns a string with a trailing `%` (e.g. `"42%"`). `Number("42%")` → `NaN`, which JSON-serialized as `null`, which the renderer coerced to `0` via `?? 0`. Now strips the `%`, trims, and throws on non-finite parse so the WASAPI fallback kicks in if the format ever changes.
- **App mixer always empty** despite Discord/Steam/etc. playing audio. Three compounding bugs:
  1. `psRun` used `-EncodedCommand` which base64-encodes the WASAPI script to ~18k chars — well past Windows' 8191-char `CreateProcess` command-line limit. Every session enumeration failed with "The command line is too long" and the `.catch(() => [])` swallowed it. Switched to writing a UTF-16 LE temp `.ps1` and invoking via `-File` (with `-ExecutionPolicy Bypass` since `-File` doesn't auto-bypass like `-EncodedCommand` does).
  2. The WASAPI walk was done in PowerShell with `$obj -as [IFoo]` casts on COM objects. PowerShell's `-as` operator does **not** trigger `QueryInterface` on dynamically-Add-Typed COM interfaces (it returns `$null`), nor does the explicit `[IFoo]$x` cast, nor does dispatch on `System.__ComObject` (no `IDispatch` on WASAPI interfaces). Moved **all** session walking into a single C# `[W]::GetSessions()` static method where C# casts emit QI at compile time. PowerShell only receives the final `string[]` of `pid|name|vol|muted` lines. The C# source is base64-encoded to survive the trip through Node `writeFile` → PowerShell `-File` without here-string quoting fragility.
  3. Every COM interface method declaration needed an explicit `[PreserveSig]` attribute. Without it, .NET auto-translates HRESULT returns: `IsSystemSoundsSession()` silently returned 0 for **every** session, so every app showed as "System Sounds" with the wrong name and `pid=0` lookup. With `[PreserveSig]`, real apps return `S_FALSE (1)` and the actual process name is resolved (Discord, Steam, etc.).

---

## feat: rename to Nishboard; remove YouTube named layout preset
**Branch:** `feat/nishboard-no-youtube` → `master`
**Date:** 2026-05-30

### Changed
- **`electron-builder.yml`** — `productName: Dashboard` → `productName: Nishboard`; `appId` updated to `com.nish.nishboard`. The packaged app will now appear as **Nishboard** in the macOS menu bar, dock, and DMG.
- **`apps/renderer/src/lib/layouts.ts`** — The named **YouTube** preset removed from `PRESETS` and `PRESET_TREES`. The YouTube widget itself is unchanged — it still appears in all other presets (Default, Markets, Media, System, Focus, Chill, Wide) and remains togglable from the Widgets menu.

---

## fix: electron-builder config for monorepo packaging
**Branch:** `fix/electron-builder-packaging` → `master`
**Date:** 2026-05-30

### Fixed
- **`electronVersion: "33.4.11"`** added to `electron-builder.yml` — builder was unable to detect Electron version because it lives in `apps/main/node_modules` (workspace), not the root `node_modules`.
- **`apps/main/package.json`** included in the bundled app root via `files` entry — electron-builder requires `app/package.json` to exist inside `Dashboard.app/Contents/Resources/app/`; tsc doesn't emit it.
- **`package.json`** (root) — added `description` and `author` fields to silence builder warnings.
- Produces `release/Dashboard-0.1.0-arm64.dmg` successfully on macOS arm64.

---

## feat: Twitch widget — channel search + in-tile playback
**Branch:** `feat/twitch-widget` → `master`
**Date:** 2026-05-30

### Added
- **New `twitch` widget** mirroring the YouTube widget: search Twitch channels, select one to play the live stream embedded in the tile, with a search overlay that keeps playback mounted in the background.
- **`packages/shared/src/types/twitch.ts`** — `TwitchChannel` + `TwitchSearchPage` types (exported from `shared/src/index.ts`).
- **`packages/server/src/routes/twitch.ts`** — `GET /api/twitch/search?q=` proxy. Auth uses a cached **client-credentials app access token** (no user OAuth needed for search/playback); token refreshes a minute before expiry and on any 401. Registered under `/api/twitch` in `server/src/index.ts`.
- **`apps/renderer/src/widgets/twitch/`** — `TwitchWidget.tsx` + `useTwitch.ts` hook.
- Registered `twitch` in `lib/layouts.ts` (`WidgetId`, `ALL_WIDGET_IDS`, `WIDGET_TITLES`, `WIDGET_CONSTRAINTS`) and `DashboardGrid.tsx` (`WIDGET_COMPONENTS`).
- **`generateLayout()`** now appends any visible widget missing from a preset's BSP tree as a bottom full-width row, so `twitch` appears across all presets without rewriting the gap-free trees. (Twitch can be woven into the preset trees later for tighter layouts.)
- **`.env.example`** — `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `TWITCH_REDIRECT_URI` (set to the `http://localhost:...` form — Twitch only permits non-https for the literal `localhost` host, not `127.0.0.1`).
- **Media layout** — YouTube + Twitch stacked left (pure video column), Spotify top-right, Stocks/Hardware side-by-side bottom-right, Weather/Calendar/Sound stacked far-right.
- **Settings UI** (`SettingsModal.tsx`) — grouped credential inputs for Alpaca (Stocks) and Twitch. Password fields with show/hide toggle, loading state, idle/saving/saved/error states, Escape to close. Credentials encrypted with OS keychain (`safeStorage`) via IPC; server restarts with new env vars on save.
- **App icon** — 1024×1024 dashboard motif icon (`build/icon.icns` + `build/icon.ico`) with 2×2 widget grid: emerald line chart, hardware progress bars, music waveform, and weather sun. All iconset sizes generated.
- **Packaging fixes** — `electron-builder.yml`: `asar: false` so server can be spawned from disk. Server spawn path corrected to `app.getAppPath()/server/index.js`. `restartServer()` kills + respawns child process with fresh env after credential save.
- **Credential IPC** — `credentials:get-all` / `credentials:save-all` handlers in main process; `safeStorage` read/write in `apps/main/src/credentials.ts`; preload exposes `window.electron.credentials`.
- **Settings button** in Titlebar right-side menu (rightmost position).

### Notes / TODO
- **Playback `parent` param:** the Twitch player iframe requires `parent=<hostname>`. Works in dev (renderer served from `localhost`); a packaged `file://` build has no valid host, so embedded playback won't load there until the renderer is served over a localhost URL.
- `TWITCH_REDIRECT_URI` is currently unused (search/playback are app-token only) — kept for future user-context OAuth (followed channels, etc.).

---

## feat/named-custom-themes — Save and name custom themes
**Branch:** `feat/named-custom-themes` → `master`
**Date:** 2026-05-30

### Added
- **Named custom themes** — users can save any custom color set under a name. Saved themes persist across sessions (Zustand persist).
- **Custom themes submenu** — "Custom" in the main theme list now opens a second panel:
  - "Create new" is always the first item; opens the color editor.
  - Saved themes listed below a divider, each with a color swatch (primary color) and a hover-reveal ✕ delete button.
  - Back arrow returns to the main theme list.
- **Delete confirmation modal** — clicking ✕ on a saved theme shows a fixed modal asking for confirmation before removal. Cancel / Delete buttons.
- **Save as section** in the color editor — name input + Save button at the bottom of the editor. Saving adds the theme to the list and navigates back to the custom submenu.
- `SavedCustomTheme` interface (`{ id, name, colors }`) exported from `themeStore.ts`.
- `saveCustomTheme(name)`, `deleteCustomTheme(id)`, `applyCustomTheme(id)` actions in `themeStore`.
- `activeCustomId` tracked in store — highlights the active saved theme in the submenu.

### Changed
- `setCustomColors` now clears `activeCustomId` (colors are "unsaved" once edited).
- Opening Themes while a custom theme is active goes directly to the custom submenu instead of the main list.
- Applying a saved custom theme sets its colors as `customColors` and marks it active; switching away clears `activeCustomId`.

---

## feat/theming-updates — ThemeMenu label, distinct swatches, custom theme
**Branch:** `feat/theming-updates` → `master`
**Date:** 2026-05-30

### Added
- **Custom theme** — four user-configurable color pickers (Background, Cards, Borders, Text) with live preview. Supports hex (`#rrggbb`, `#rgb`) and `rgb(r,g,b)` input; native color-picker swatch for point-and-click picking. All 13 semantic tokens derived automatically via linear mixing in `src/lib/colorUtils.ts`. Semantic/purposeful colors (green/red stocks, hardware read/write, muted indicators) are untouched.
- **`src/lib/colorUtils.ts`** — `parseHex`, `hexToArr`, `buildCustomVars`, `CUSTOM_VAR_KEYS`. `buildCustomVars` maps 4 user hex colors → all 13 `--t-*` CSS var triples with blended surface/text levels.
- **`CustomColors`** exported from `themeStore.ts` — `{ primary, secondary, tertiary, text }` with defaults matching Midnight; persisted to localStorage.

### Changed
- **ThemeMenu button** now shows `Themes` text alongside the palette icon + active-color bubble.
- **ThemeMenu panel** is now two-panel: theme list → custom editor (with back arrow). Opening while `custom` is active goes straight to the editor. Named theme selection closes the panel; Custom navigates in.
- **Distinct swatches** for previously similar grey themes:
  - Contrast → `#facc15` (yellow accent) instead of `#111111`
  - Dracula → `#bd93f9` (purple accent) instead of `#282a36`
  - Nord → `#88c0d0` (frost cyan) instead of `#3b4252`
- **Nord CSS vars** pushed bluer (`--t-bg: 24 30 46`, `--t-surface: 36 46 66`) — was too grey to distinguish from Midnight.
- **Dracula CSS vars** pushed more purple (`--t-bg: 21 18 36`, `--t-surface: 32 28 52`) — was too grey to distinguish from Midnight.
- **`App.tsx`** applies custom vars via `useLayoutEffect` on `document.documentElement` when `theme === 'custom'`; removes them when switching away. No `[data-theme="custom"]` CSS block needed.

---

## feat: theme menu expansion — 10 additional themes
**Branch:** `claude/theme-menu-expansion-WklmG` → `master`
**Date:** 2026-05-29

### Added
- **10 new themes** in `src/themes.ts` (`ThemeId` union + `THEMES` array) and `src/index.css` (`[data-theme="..."]` custom-property blocks), bringing the total to 15. The `ThemeMenu` already renders from `THEMES`, so no component changes were needed.
  - **Forest** — deep green dark, lime-400 accent
  - **Sunset** — warm orange/amber dark, orange-400 accent
  - **Dracula** — classic purple/pink dark (`#282a36`), pink accent
  - **Nord** — arctic blue-gray dark, frost accent
  - **Solarized** — light tan (`#fdf6e3`) base, blue accent
  - **Crimson** — deep red dark, red-400 accent
  - **Mocha** — warm coffee/caramel dark, caramel accent
  - **Neon** — cyberpunk dark, fuchsia-400 accent on cyan text
  - **Sandstorm** — warm sepia light, burnt-amber accent
  - **Arctic** — cool blue light, blue-600 accent
- Each theme defines all 13 semantic tokens (`--t-bg` … `--t-invert-text`), so existing widgets pick them up with no further changes.

---

## [PR #24] feat: theming system — 5 themes, ThemeMenu
**Branch:** `feat/theming` → `master`
**Date:** 2026-05-27

### Added
- **`tailwind.config.ts`** — 13 semantic color tokens backed by CSS custom properties: `th-bg`, `th-surface`, `th-elevated`, `th-overlay`, `th-line`, `th-hi`, `th-2`, `th-3`, `th-ghost`, `th-accent`, `th-bar`, `th-invert-bg`, `th-invert-text`. All support Tailwind opacity modifiers (`bg-th-surface/50`, etc.) via the `rgb(var(--t-*) / <alpha-value>)` pattern.
- **`src/themes.ts`** — `ThemeId` union + `THEMES` array with name, id, and swatch hex for 5 themes.
- **`src/store/themeStore.ts`** — Zustand persist store; default `'midnight'`.
- **`src/index.css`** — CSS custom property blocks for all 5 themes via `[data-theme="..."]` selectors. Also updated `react-resizable-handle` and `react-grid-placeholder` styles to use theme tokens.
- **5 themes:**
  - **Midnight** — deep zinc dark (default, matches the original look)
  - **Slate** — clean light mode on slate-100/white surfaces, violet accent
  - **Ocean** — deep navy blue, sky-50 text, sky-400 accent
  - **Contrast** — pure black, maximum contrast, yellow-400 accent (WCAG-oriented)
  - **Rose** — warm rose/fuchsia dark, fuchsia-300 accent

### Changed
- **`src/App.tsx`** — applies `data-theme={theme}` to root div; root bg is now `bg-th-bg`.
- **`src/components/Titlebar.tsx`** — added `ThemeMenu` (palette icon + color swatch + dropdown), positioned left of Widgets menu. All colors updated to `th-*` tokens.
- **`src/components/WidgetShell.tsx`** — all `zinc-*` classes replaced with `th-*` tokens.
- **All 8 widget files** — wholistic `zinc-*` → `th-*` token replacement across backgrounds, borders, text, accents, sliders, and interactive states. Semantic data colors (emerald/red/amber for charts and stock movement) intentionally untouched.

---

## [PR #23] feat: dynamic BSP layouts + general UI polish
**Branch:** `feature/general-fixes` → `master`
**Date:** 2026-05-26

### Added
- **`layouts.ts`** — Binary Space Partition (BSP) layout engine.
  - `SplitNode` discriminated union (`leaf | v-split | h-split`) with helper constructors `l / v / h`.
  - `PRESET_TREES` — each of the 8 named presets encoded as a BSP tree, verified column-by-column against the static layouts.
  - `pruneTree(node, visible)` — removes hidden widget leaves; surviving sibling automatically expands to fill the full parent region (gap-free at any widget count).
  - `renderTree(node, x, y, w, h)` — walks pruned tree, computing exact `Layout[]` coords using proportional splits rounded to integer grid units.
  - `generateLayout(presetName, visibleIds)` — public API: returns a gap-free `Layout[]` for any subset of widgets, or `null` if preset unknown / all hidden.

### Changed
- **`layoutStore.ts`** — layout regeneration wired to all visibility-changing actions.
  - `applyPreset` — calls `generateLayout(name, visibleWidgets)` so clicking a preset immediately produces a correct layout for however many widgets are currently visible. Falls back to static `autoFillLayout` if BSP returns null.
  - `hideWidget` — if a preset is active, rerenders the remaining widgets gap-free via `generateLayout`.
  - `showWidget` — if a preset is active, rerenders all visible widgets (including newly added) via `generateLayout`. In custom-layout mode (no active preset), ensures the re-shown widget has a grid slot via `autoFillLayout` fallback (prevents widgets silently disappearing after a hide → drag → show sequence).
  - `resetToDefault` — uses `generateLayout` instead of static layout.

### Notes
- Static `PRESETS[]` array is retained as a fallback and source of truth for BSP tree ratios.
- Titlebar: Layouts / Widgets dropdown menus, pinned preset quick-access buttons, centered clock (ET).
- Stocks widget: market session status dot (green open / amber after-hours+pre-market / red closed), time-based ET detection updated every 60s.
- Hardware widget: defaults to sparks view; polling spinner replaces "updating…" text.

---

## [PR #22] feat: youtube widget UX polish
**Branch:** `feat/youtube-widget` → `master`
**Date:** 2026-05-26

### Changed
- **`YoutubeWidget.tsx`** — full state machine redesign (home / search / playing).
  - **Home screen**: greyscale YouTube icon SVG + "YouTube" wordmark, both scaling dynamically with widget height (14% of height, clamped 20–52px). Below 120px collapses to compact horizontal layout. "Search videos" pill opens search.
  - **Search view**: back arrow (← returns to player if a video is loaded, otherwise home) + search input with `autoFocus` + results list.
  - **Playing view**: iframe fills `height − 44px`. Fixed 44px control bar shows title + channel + search icon (opens search without stopping playback) + X (closes video → home). Scrubber always fully visible.
  - **Resume on back**: clicking search while a video plays keeps the iframe mounted at `height: 0; overflow: hidden` — YouTube preserves the playback position. Clicking back restores the iframe to full height, resuming exactly where playback was. Selecting a new result while something is playing replaces the video correctly.

---

## [PR #21] feat: youtube in all layouts + autoFillLayout
**Branch:** `feat/youtube-widget` → `master`
**Date:** 2026-05-26

### Changed
- **`layouts.ts`** — All 7 non-YouTube presets redesigned to include `youtube` widget. Every preset now covers 7 widgets across 24×22 gap-free cells.
  - Default: 4 small top row (h=8), youtube+sound mid band (h=9), hardware full-width bottom (h=5)
  - Markets: stocks+youtube equal top halves (h=12), info grid below
  - Media: spotify tall left, youtube wide top-right, small widgets bottom-right
  - System: hardware+youtube top halves, 5 widgets below
  - Focus: spotify full-height left, youtube center-top, stocks right, info bottom-right
  - Chill: info stack + stocks left, youtube and spotify as full-height columns right
  - Wide: stocks+youtube equal top row, 5 widgets below
- **`layouts.ts`** — Added `ALL_WIDGET_IDS` constant and `autoFillLayout(layout)` utility. Any widget IDs missing from a stored or custom layout are appended to the bottom row automatically. Future widgets only need to be added to `ALL_WIDGET_IDS` — no manual preset redesign needed.
- **`layoutStore.ts`** — `applyPreset`, initial state, `resetToDefault`, and `onRehydrateStorage` all run `autoFillLayout` so persisted layouts from older versions auto-gain new widgets on next load.

---

## [PR #20] feat: YouTube widget
**Branch:** `feat/youtube-widget` → `master`
**Date:** 2026-05-26

### Added
- **`YoutubeWidget.tsx`** — search + embedded player widget.
  - Search bar triggers on Enter or arrow button; results are cached 5 min (TanStack Query). No auto-search on keystroke — preserves API quota.
  - Clicking a result plays it in a `youtube-nocookie.com/embed/` iframe with `autoplay=1`. Works natively in Electron's Chromium renderer without any extra configuration.
  - Adaptive layout: if the tile height ≤ 280px, shows player full-tile with a close button. Above that, player + search bar + results list stack vertically.
  - Error state shown when `YOUTUBE_API_KEY` is missing or the API returns an error.
- **`packages/server/src/routes/youtube.ts`** — `GET /api/youtube/search?q=&pageToken=`. Calls YouTube Data API v3, decodes HTML entities in titles, returns `YoutubeSearchPage`. Returns 503 if `YOUTUBE_API_KEY` is not set.
- **`packages/shared/src/types/youtube.ts`** — `YoutubeVideo`, `YoutubeSearchPage` types.
- **`useYoutube.ts`** — `useYoutubeSearch(query)` hook; query is only enabled when non-empty.
- **YouTube preset** in `layouts.ts` — all 7 widgets (including youtube). Existing 7 presets remain unchanged (they cover the full grid with 6 widgets; youtube only appears in this preset).
- **`.env`** — `YOUTUBE_API_KEY=` placeholder added.

### Changed
- `WidgetId` extended to include `'youtube'`.
- `DashboardGrid` — youtube added to `WIDGET_TITLES` and `WIDGET_COMPONENTS`.
- `packages/server/src/index.ts` — youtube route registered at `/api/youtube`.

### API key required
YouTube Data API v3 key from Google Cloud Console. Free tier: 10,000 units/day; search costs 100 units (~100 searches/day free). See PR description for setup steps.

---

## [PR #19] fix: weather + hardware scroll broken on Windows (callback ref)
**Branch:** `fix/scroll-callback-ref` → `master`
**Date:** 2026-05-26

### Fixed
- **Root cause** — both `WeatherWidget` and `HardwareWidget` used `useRef` + `useEffect(fn, [])`. The effect fires after the first render, but both components have `isLoading`/`isError` early returns that render before the scrollable element exists. `ref.current` is always null on that first run and the effect never re-runs, so scroll/drag handlers are never attached.
- **Fix** — replaced `useRef` with a `useState` callback ref (`ref={setEl}`). React calls the setter the moment the element mounts, which triggers `useEffect([el])` with the real element.
- **`WeatherWidget`** — hourly strip wheel and drag now work. Also normalises `deltaMode === 1` (Windows line-mode scroll) by multiplying `deltaY × 40` so one wheel notch scrolls a reasonable distance.
- **`HardwareWidget`** — vertical drag-to-scroll now wires up correctly after data loads.

---

## [PR #18] feat: calendar widget
**Branch:** `feat/calendar-widget` → `master`
**Date:** 2026-05-26

### Added
- **`CalendarWidget.tsx`** — pure JS date rendering, no API. Shows one or more months depending on available space. Uses `ResizeObserver` with the callback-ref + retry-RAF pattern (same approach as `SpotifyWidget`) so it measures correctly on first render and after layout changes.
  - Each month renders: name+year header, Su–Sa day-of-week row, 6-row × 7-col date grid (always 6 rows to prevent layout shift)
  - Today gets a white filled circle (`bg-zinc-100 text-zinc-900`)
  - Minimum per month: 155px wide × 195px tall. At that size or larger the widget shows additional months tiled in a CSS grid
  - With 3+ months, the sequence anchors so the current month is second (previous month visible on the left)
- **`calendar`** added to `WidgetId`, `WIDGET_TITLES`, `WIDGET_COMPONENTS`
- All 7 presets in `layouts.ts` updated to include the calendar widget (each preset must cover the full grid — every preset had to be reworked to accommodate the 6th widget)

---

## [PR #17] feat: titlebar with window drag + expanded layout presets
**Branch:** `feat/titlebar-and-layouts` → `master`
**Date:** 2026-05-25

### Added
- **`Titlebar.tsx`** — 32px bar pinned above the grid. Left side shows "nishboard" label. Entire bar carries `-webkit-app-region: drag` (Electron frameless window drag). Right side hosts the layout preset buttons with `-webkit-app-region: no-drag` so clicks register. Replaces the old floating `LayoutToolbar`.
- **Layout presets** — renamed "Stocks Focus" → "Markets"; 3 new presets added to `layouts.ts`:
  - **Focus** — Spotify takes up a tall left column (18 rows), Stocks fills top-right (14 rows), Weather + Sound split the bottom-right, Hardware is a thin strip below Spotify.
  - **Chill** — Weather, Hardware, Sound stacked in a narrow left column; Stocks and Spotify each take a full-height column (all 22 rows) to the right.
  - **Wide** — Two big horizontal rows: Stocks + Spotify split the top 12 rows; Hardware + Weather + Sound split the bottom 10 rows.

### Changed
- **`App.tsx`** — switched to `flex-col` layout; Titlebar sits above a `flex-1` grid container.
- **`DashboardGrid.tsx`** — `useRowHeight` now subtracts `TITLEBAR_H` (32px) from `window.innerHeight` so the grid fills the space below the titlebar exactly.
- **`LayoutToolbar.tsx`** — deleted (replaced by Titlebar).

---

## [PR #16] fix: Spotify widget resize broken on macOS fresh start
**Branch:** `fix/spotify-resize-mac` → `master`
**Date:** 2026-05-25

### Fixed
- **Root cause identified**: `SpotifyWidget` has conditional early returns for loading and auth states. Those views don't render the `ref={containerRef}` div, so `containerRef.current` is `null` when `useLayoutEffect([], [])` fires on first mount. With an empty dep array, the effect never re-runs once the real element appears — the ResizeObserver is never set up and the widget stays at the initial `'sm'` size forever.
- **Fix**: Replaced `useRef` + `useLayoutEffect([])` with a `useState` callback ref (`setContainerEl`) + `useEffect([containerEl])`. React calls the callback ref when the element actually mounts (after loading/auth resolves), which updates the state and re-triggers the effect with the real element.
- **Retained retry RAF loop**: Single RAF wasn't enough on macOS — Chromium can return `0` from `getBoundingClientRect` for multiple frames while the flex grid row is compositing. The retry loop keeps requesting frames until it gets a non-zero height, then hands off to the ResizeObserver for all subsequent updates.

---

## [PR #15] fix: weather hourly strip — hide scrollbar, add wheel + drag-to-scroll
**Branch:** `fix/weather-scrollbar-windows` → `master`
**Date:** 2026-05-25

### Fixed
- **Scrollbar hidden cross-platform** (`index.css`) — added explicit `.scrollbar-none` CSS rules (`::-webkit-scrollbar { display: none }`, `scrollbar-width: none`, `-ms-overflow-style: none`). Previously only the Tailwind class name existed with no backing CSS rule, so macOS overlay scrollbars hid themselves naturally but Windows always showed the native bar.
- **Wheel-to-horizontal-scroll** (`WeatherWidget.tsx`) — `wheel` events on the hourly strip now map vertical delta to `scrollLeft`. Native horizontal scroll (trackpad two-finger swipe) still passes through unchanged.
- **Click-and-drag to pan** (`WeatherWidget.tsx`) — `mousedown`/`mousemove`/`mouseup` handlers on the hourly strip enable click-and-drag scrolling. Cursor changes to `grabbing` while dragging. Listeners on `window` so drag works even if the mouse leaves the strip.

### Changed
- **`CLAUDE.md`** — updated Git Workflow rule 3 to explicitly say "Do NOT auto-merge — wait for Nish to explicitly say 'merge'".

---

## [PR #14] chore: document git workflow + memory protocol in CLAUDE.md
**Branch:** `chore/claude-md-workflow-rules` → `master`
**Date:** 2026-05-25

### Changed
- **`CLAUDE.md`** — added two new sections:
  - **Git Workflow**: branch-first rule, CHANGELOG-before-PR rule, branch naming convention (`feat/` / `fix/`)
  - **Memory Protocol**: new preferences go into both `CLAUDE.md` (committed, travels with repo) and `~/.claude/projects/…/memory/` (local machine memory)

---

## [PR #13] fix: Spotify — conditional text scroll + macOS sizing init
**Branch:** `fix/spotify-scroll-overflow` → `master`
**Date:** 2026-05-25

### Fixed
- **Conditional scroll** (`ScrollingText`) — text now only animates when it actually overflows its container. Added a `ResizeObserver` inside `ScrollingText` so it re-measures on every container width change (catches `SizeVariant` transitions in both directions). 1px sub-pixel rounding tolerance added to prevent spurious animation on near-exact fits.
- **macOS `SizeVariant` init** — `getBoundingClientRect().height` can return `0` inside `useLayoutEffect` on macOS/Chromium before the flex grid row height has been composited. Added a `requestAnimationFrame` re-seed so the correct height is read after the browser's first paint, preventing the widget from staying stuck at `xs`.

---

## [PR #12] feat: Spotify scrolling text marquee + ResizeObserver timing fix
**Branch:** `fix/spotify-bugfixes` → `master`
**Date:** 2026-05-25

### Added
- **Scrolling text** (`SpotifyWidget.tsx`) — track name, artist, and album name now scroll horizontally instead of truncating with `…`. Pattern: 2s pause → smooth scroll at 40px/s → 2s pause → instant reset → repeat. Uses the Web Animations API (`element.animate()`). Short text that fits the container is left static (no animation started).

### Fixed
- **ResizeObserver timing** — replaced `useEffect` with `useLayoutEffect` for the `ResizeObserver` that drives size variants. Also seeds the initial `SizeVariant` immediately from `getBoundingClientRect()` before the first observer callback, preventing a stuck `sm` layout on fresh page load.
- **`xs` empty-space gap** — `justify-between` on the compact layout was leaving a large dead zone when the tile is very short. `xs` now uses `justify-center gap-3` to pack content together; `sm` keeps `justify-between`.

---

## [PR #11] feat: Spotify widget — 5-tier responsive layout
**Branch:** `fix/spotify-bugfixes` → `master`
**Date:** 2026-05-25

### Changed
- **5-tier `SizeVariant`** (`SpotifyWidget.tsx`) — replaced binary `compact / expanded` with `xs | sm | md | lg | xl` driven by a `ResizeObserver` on the widget root:
  - `xs` < 200px — compact horizontal, 40px art
  - `sm` 200–299px — compact horizontal, 56px art, `justify-between` fills height
  - `md` 300–399px — expanded vertical, album art capped at 110px
  - `lg` 400–479px — expanded vertical, album art capped at 165px
  - `xl` ≥ 480px — expanded vertical, album art capped at 220px
- **Per-tier icon scaling** — play button, skip, seek, and shuffle/repeat icons all scale with the tile height so controls feel proportional rather than tiny on large tiles.
- **`VolumeSlider` updated** — `iconSize` and slider width scale with `lg`/`xl` tiers (was still comparing against old `'expanded'` string).

---

## [PR #10] fix: Spotify expanded layout flex pass-through
**Branch:** `fix/spotify-layout-flex` → `master`
**Date:** 2026-05-25

### Fixed
- **Expanded layout not filling height** (`SpotifyWidget.tsx`) — `h-full` on the `NowPlayingView` expanded root could resolve to 0 in Chromium when the parent is a `flex-1 min-h-0` item without an explicit `height` declaration. Fixed by:
  1. Making the intermediate wrapper `flex-1 min-h-0 flex flex-col` (flex pass-through)
  2. Changing the expanded layout root from `h-full flex flex-col` → `flex-1 flex flex-col` so it inherits flex sizing instead of relying on percentage-height resolution

---

## [PR #9] fix: Spotify widget bugfixes — liked songs, volume slider, responsive layout, icon polish
**Branch:** `fix/spotify-bugfixes` → `master`
**Date:** 2026-05-25

### Fixed
- **Liked Songs 400 error** (`packages/server/src/routes/spotify.ts`) — Spotify's `/v1/me/tracks` endpoint caps at 50; server was sending 100. Now clamps liked-songs branch to `Math.min(50, ...)` while regular playlists keep 100.
- **Volume slider jumping back** (`apps/renderer/src/widgets/spotify/useSpotify.ts`) — `useSpotifyVolume.onSettled` was immediately invalidating `['spotify-now-playing']`, triggering a refetch that returned Spotify's stale volume and overwrote the optimistic update. Removed `onSettled`; 3s polling handles eventual sync.
- **Playlist icon color** (`SpotifyWidget.tsx`) — `ListMusic` button was `text-zinc-600` (darker than peers); corrected to `text-zinc-500`.
- **Responsive layout not filling space** (`SpotifyWidget.tsx`) — Expanded mode (≥ 280px height, detected via `ResizeObserver`) now uses a true `h-full flex flex-col` layout: track title + artist pinned top, album art in a `flex-1` grow zone (`max-h-[240px]`, `aspect-square`), progress + controls + volume pinned bottom. Previously only bumped fixed pixel sizes with no vertical fill.

### Changed
- **Header removed** — Green dot and "SPOTIFY" label stripped; reclaims ~32px. Search (🔍) and playlist (🎵) icons moved inline next to track info. Both buttons also present in the "nothing playing" view.

### Notes
- Bug #4 (search 404): no code change — route exists, just requires `pnpm dev` restart to pick up after the PR #8 merge.

---

## [PR #8] feat: Spotify search dialog with play / add-to-queue
**Branch:** `feat/spotify-search` → `master`
**Date:** 2026-05-25

### Added
- **Search dialog** (`apps/renderer/src/widgets/spotify/SpotifySearchDialog.tsx`) — portal'd overlay, opens via 🔍 in widget header. 250ms debounced input, Esc/backdrop closes.
- **Result rows** — thumbnail, track name, artist, duration; **▶ Play** and **+ Queue** action buttons per row with inline ✓/✗ feedback.
- `GET /api/spotify/search?q&limit` (`packages/server/src/routes/spotify.ts`) — proxies Spotify search API (`type=track,episode`); 30s server-side cache keyed by lowercased query, LRU-evicts at 100 entries.
- `POST /api/spotify/queue { uri, deviceId? }` — proxies `POST /v1/me/player/queue`.
- `SpotifySearchResults` type (`packages/shared/src/types/spotify.ts`).
- `useDebouncedValue<T>`, `useSpotifySearch`, `useQueueTrack` hooks (`useSpotify.ts`).
- **Fixed** `.env.example` redirect URI: `http://127.0.0.1:7432/spotify/callback` → `/api/spotify/callback`.

### Notes
- `market=from_token` omitted — requires `user-read-private` scope not present in token. Spotify returns global results without it.
- Queue requires an active playback context; 404 from Spotify if nothing is playing on a device.

---

## [PR #7] feat: Spotify widget — now playing, playlists, track list, podcasts, OAuth
**Branch:** `feature/spotify-widget` → `master`  
**Date:** 2026-05-25

### Added
- `packages/server/src/routes/spotify.ts` — full implementation:
  - **PKCE OAuth:** `GET /api/spotify/auth-url` generates PKCE params, returns auth URL; `GET /api/spotify/callback` exchanges code for tokens
  - Tokens persisted to `~/.dash/spotify_tokens.json`; auto-refresh when < 60s from expiry
  - `GET /api/spotify/auth-status`, `GET /api/spotify/now-playing` (2.5s TTL cache)
  - **Podcast support:** `additional_types=track,episode`; episode maps show name → artist field, show artwork
  - `POST /api/spotify/play`, `/pause`, `/next`, `/previous`, `/seek`, `/volume`, `/shuffle`, `/repeat`
  - `GET /api/spotify/playlists?offset&limit` — paginated (20/page); Liked Songs synthetic item prepended at offset=0 (parallel fetch for badge count); 30s page cache
  - `GET /api/spotify/playlist-tracks?playlistId&offset&limit` — 100/page; handles both regular playlists and `liked-songs` (maps to `GET /me/tracks`); per-page 60s cache; filters local tracks
  - `GET /api/spotify/devices` — 5s cache
  - `POST /api/spotify/play-context { contextUri, deviceId?, shuffle? }` — sets shuffle state before starting if requested
  - `POST /api/spotify/play-track { trackUri, contextUri?, deviceId? }` — plays specific track within context
  - Scopes: `user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`, `playlist-read-private`, `playlist-read-collaborative`, `user-library-read`
- `packages/shared/src/types/spotify.ts` — `TrackData` (+ `type: 'track' | 'episode'`), `SpotifyPlaylist`, `SpotifyDevice`, `SpotifyTrackItem`, `SpotifyPlaylistsPage`, `SpotifyTracksPage`
- `apps/renderer/src/widgets/spotify/useSpotify.ts`:
  - `usePlaylistsInfinite()` — `useInfiniteQuery`, 20/page
  - `usePlaylistTracksInfinite(playlistId)` — `useInfiniteQuery`, 100/page
  - `useDevices()`, `usePlayContext()`, `usePlayTrack()`
  - Optimistic updates on all playback mutations
- `apps/renderer/src/widgets/spotify/SpotifyWidget.tsx`:
  - **Auth:** Connect Spotify → PKCE flow via `shell.openExternal`
  - **Now playing:** album art, track/artist/album, smooth progress bar (1s local ticker between 3s polls), prev / ←15s / play-pause / 15s→ / next controls, shuffle + repeat toggles, volume slider
  - **Volume icon click** → mute toggle; restores pre-mute level on second click
  - **±15s buttons** (`RotateCcw`/`RotateCw`) use ref-tracked local progress for accuracy
  - **Playlist panel** (toggle via `ListMusic` icon or "Browse playlists" button):
    - Infinite scroll playlist list — play button + shuffle button always visible; click row body → track list
    - Infinite scroll track list — click track → starts playback; local files greyed/disabled
    - Device chips at top — click to target playback device; active device auto-selected
    - Liked Songs first with heart icon + indigo→purple gradient
  - **Podcast now-playing:** `Mic2` icon fallback, "Podcast" label, no album line
- `apps/main/src/ipc/index.ts` — `spotify:open-auth` via `shell.openExternal(url)`
- `apps/main/src/preload.ts` — `openSpotifyAuth(url: string)` via contextBridge
- `apps/renderer/src/lib/apiClient.ts` — **fix:** omit `Content-Type` header when body is absent; skip `res.json()` on 204 responses (was causing `FST_ERR_CTP_EMPTY_JSON_BODY` on all no-body POSTs)

### Notes
- **Re-auth required** for new scopes (`playlist-read-private`, `playlist-read-collaborative`, `user-library-read`) — click Connect Spotify; `show_dialog=false` makes it instant
- **Redirect URI:** `SPOTIFY_REDIRECT_URI=http://127.0.0.1:7432/api/spotify/callback` — must also be registered in Spotify Developer Dashboard
- **Token file:** `~/.dash/spotify_tokens.json` — delete to force re-auth
- **`apiClient` fix** also repairs the sound widget's mute/device mutations which had the same silent failure

---

## [PR #6] feat: hardware widget — CPU, GPU, RAM, disk, network with bars/sparklines toggle
**Branch:** `feature/hardware-widget` → `master`  
**Date:** 2026-05-24

### Added
- `packages/server/src/routes/hardware.ts` — full `systeminformation` implementation:
  - All subsystems fetched in parallel via `Promise.all`
  - CPU: brand/cores/physicalCores cached statically (fetched once); live usage + per-core load + temp
  - GPU: picks highest-VRAM controller (dGPU > iGPU on multi-GPU Windows machines); VRAM used/total, utilization %, temp, clock speed — all from nvidia-smi on Windows NVIDIA
  - RAM: uses `mem.active` (actual in-use pages) rather than `mem.used` for accurate macOS figure; swap included
  - Disk I/O: aggregate read/write MB/s via `si.fsStats()` (`rx_sec`/`wx_sec`); per-mount usage from `si.fsSize()` with virtual/snap filesystem filtering
  - Network: bytes→Mbps, loopback excluded, sorted by activity (not filtered) — always shows top 3 real interfaces
  - Battery: shown only when `hasBattery === true` (macOS laptops)
  - Uptime via `os.uptime()`
  - 900ms TTL cache (prevents duplicate systeminformation calls from 1s poll)
- `packages/shared/src/types/hardware.ts` — extended types:
  - `CpuData`: added `brand`, `cores`, `physicalCores`
  - `GpuData`: added `name`, `clockMhz`
  - `HardwareData.ram`: added `swapUsedMb`, `swapTotalMb`
  - New `DiskUsage` interface: `mount`, `usedGb`, `totalGb`, `usePercent`
  - `HardwareData`: added `diskUsage`, `uptime`, `battery`
- `apps/renderer/src/widgets/hardware/useHardware.ts` — 1s refetch hook with 60-entry rolling history buffers (cpuUsage, gpuUsage, ramUsage, netUp, netDown, diskRead, diskWrite)
- `apps/renderer/src/widgets/hardware/HardwareWidget.tsx`:
  - **Bars mode:** animated usage bars for CPU/GPU/RAM; VRAM secondary bar; per-mount disk usage bars
  - **Sparks mode:** Recharts AreaChart sparklines for each metric (60-second history)
  - Toggle button (Bars / Sparks) in widget header
  - Per-core mini bars (color-coded: blue→amber→red by load)
  - Temperature color-coding: green <70°C, amber 70–84°C, red ≥85°C
  - **Configure panel:** gear button in header opens a 2-col checkbox grid; toggles which sections (CPU/GPU/RAM/Disk/Network/Battery) are rendered; all sections on by default
  - GPU always renders (shows "No GPU detected" placeholder if `gpu` is null) — no unmounting on null
  - Battery always renders when section is visible (shows "No battery" placeholder on desktop) — no unmounting
  - Network always renders top-N interfaces regardless of idle traffic — no unmounting on idle
  - Uptime in footer
- `apps/renderer/src/store/hardwareStore.ts` — Zustand `persist` store; section visibility saved to `localStorage` under key `hardware-config`

### Notes
- **Windows gaming:** GPU usage/VRAM/temp/clock require NVIDIA drivers (nvidia-smi); systeminformation calls it automatically
- **macOS:** GPU utilization is not available (Apple Silicon has no systeminformation support for GPU usage); VRAM shows 0/dynamic; battery card appears on MacBook
- **First poll:** `fsStats` disk I/O returns 0 on the very first call (needs baseline); accurate from second poll onward

---

## [PR #5] feat: sound widget — volume, mute, device switching, Windows app mixer
**Branch:** `feature/sound-widget` → `master`  
**Date:** 2026-05-25

### Added
- `packages/server/src/routes/sound.ts` — full implementation:
  - **macOS:** `osascript` for get/set volume + mute; `SwitchAudioSource` for device list/switch (degrades gracefully — `brew install switchaudio-osx`)
  - **Windows:** `AudioDeviceCmdlets` PowerShell module preferred; WASAPI inline C# fallback (`IAudioEndpointVolume` via `MMDeviceEnumerator`) when not installed
  - **Windows app mixer:** `IAudioSessionManager2` + `IAudioSessionEnumerator` + `IAudioSessionControl2` + `ISimpleAudioVolume` to enumerate active audio sessions (one row per PID, deduped); process names resolved via single bulk `Get-Process` call
  - New `POST /api/sound/sessions/volume` — sets volume for all sessions matching a PID
  - 5s TTL cache; `cache.clear()` on any successful mutation
- `packages/shared/src/types/sound.ts` — added `AudioSession` interface; added `sessions: AudioSession[]` to `SoundData`
- `apps/renderer/src/widgets/sound/useSound.ts` — TanStack Query hook (5s poll) + mutations for volume, mute, device, session volume; all slider mutations use synchronous optimistic cache updates
- `apps/renderer/src/widgets/sound/SoundWidget.tsx`:
  - Master volume slider + mute toggle (icon morphs Volume→VolumeX)
  - Output device list with active device highlighted; click to switch
  - App Mixer section (Windows only, hidden when `sessions` is empty) — per-app sliders with process name
  - Sliders use persistent `localValue` state synced from parent only when pointer is not down — eliminates snap-back on release regardless of API latency
- `packages/server/src/cache/SimpleCache.ts` — added `clear()` method

### Notes
- **macOS device switching:** requires `brew install switchaudio-osx`
- **Windows device switching:** requires `Install-Module -Name AudioDeviceCmdlets` (once, as admin); volume/mute work without it via WASAPI fallback
- **Windows app mixer:** works without any extra setup via WASAPI

---

## [PR #4]
**Branch:** `feature/sound-widget` → `master`  
**Date:** 2026-05-25

### Added
- `packages/server/src/routes/sound.ts` — full implementation:
  - **macOS:** `osascript` for get/set volume + mute; `SwitchAudioSource` for device list/switch (degrades gracefully to single "Default Output" if not installed — `brew install switchaudio-osx`)
  - **Windows:** `AudioDeviceCmdlets` PowerShell module for get/set volume, mute, device list, and switching; falls back to WASAPI inline C# (`IAudioEndpointVolume` via `MMDeviceEnumerator`) when module is not installed
  - 5s TTL cache; cache busted on any successful mutation
  - Routes: `GET /api/sound`, `POST /api/sound/volume`, `POST /api/sound/mute`, `POST /api/sound/device`
- `apps/renderer/src/widgets/sound/useSound.ts` — TanStack Query hook (5s poll) + 3 mutations (volume, mute, device)
- `apps/renderer/src/widgets/sound/SoundWidget.tsx` — widget UI:
  - Volume slider (native range, styled) — local state while dragging, commits to API on pointer-up
  - Click speaker icon to toggle mute; icon changes between Volume/Volume1/Volume2/VolumeX by level
  - Device list — active device highlighted with green dot; click non-active device to switch

### Changed
- `packages/server/src/cache/SimpleCache.ts` — added `clear()` method for cache busting on mutations

### Notes (Windows)
- Volume/mute works without any extra setup via WASAPI fallback
- Device listing + switching requires `Install-Module -Name AudioDeviceCmdlets` (run once as admin in PowerShell)

---

## [PR #4] feat: stocks widget — Alpaca REST snapshots, card grid UI, editable watchlist
**Branch:** `feature/stocks-widget` → `master`  
**Date:** 2026-05-24

### Added
- `packages/server/src/routes/stocks.ts` — Alpaca IEX REST implementation:
  - Accepts `?symbols=` query param (comma-separated, max 50); defaults to `SPY,QQQ,AAPL,MSFT,NVDA,TSLA,GOOGL,AMZN`
  - Fetches snapshots + 5-minute bars in parallel; bars non-critical (returns empty on failure)
  - Uses `dailyBar.c` as last price, `prevDailyBar.c` as prev close for stable change calculation
  - Market-hours detection via `Intl.DateTimeFormat` with `America/New_York` timezone
  - 5s in-memory cache per symbol set
- `apps/renderer/src/store/stocksStore.ts` — Zustand persist store for watchlist (localStorage)
- `apps/renderer/src/widgets/stocks/useStocks.ts` — TanStack Query, 5s refetch, passes watchlist as query param
- `apps/renderer/src/widgets/stocks/StocksWidget.tsx` — full widget UI:
  - 2-column card grid matching mockup
  - Each card: triangle indicator, ticker, % change (top), Recharts area sparkline (middle), price + dollar change (bottom)
  - Pencil button in header opens watchlist edit modal (add/remove tickers, persisted)
  - Market Open / Market Closed status with animated dot
  - Green/red theming per card based on daily change

### Changed
- `packages/shared/src/types/stocks.ts` — added `sparkline: number[]` to `StockQuote`

### Removed
- `packages/server/src/services/alpacaWs.ts` — WebSocket approach dropped (replaced by REST-only)
- `packages/server/src/services/stocksService.ts` — consolidated into route file

### Notes
- Alpaca IEX feed: US equities only. Futures (MES=F, MGC=F) and crypto (BTC-USD) are not supported; the watchlist edit modal surfaces this caveat

---

## [PR #3] feat: weather widget — Open-Meteo, 15-min cache, full forecast UI
**Branch:** `feature/weather-widget` → `master`  
**Date:** 2026-05-24

### Added
- `packages/server/src/cache/SimpleCache.ts` — generic in-memory TTL cache used by weather (and future widgets)
- `packages/server/src/routes/weather.ts` — fetches Open-Meteo API, transforms to `WeatherData`, caches 15 min
  - Austin TX hardcoded (lat: 30.2672, lon: -97.7431)
  - Returns: current conditions, next 12 hourly entries from now, 5-day daily forecast
  - Temperature in °F, wind in mph, timezone `America/Chicago`
- `apps/renderer/src/widgets/weather/useWeather.ts` — TanStack Query hook, 15-min `refetchInterval` + `staleTime`
- `apps/renderer/src/widgets/weather/weatherCodes.ts` — WMO weather code → `{ label, icon }` map covering all standard codes
- `apps/renderer/src/widgets/weather/WeatherIcon.tsx` — maps icon key to lucide-react component
- `apps/renderer/src/widgets/weather/WeatherWidget.tsx` — full widget UI:
  - Large current temp + condition label + lucide weather icon
  - 4-stat row: humidity, wind speed, precip chance, UV index
  - Feels-like line
  - Horizontal scrollable hourly strip (next 12h) with precip % shown when >20%
  - 5-day daily strip with precip bar and high/low temps

---

## [PR #2] feat: layout engine — resizable/draggable grid with presets
**Branch:** `feature/layout-engine` → `master`  
**Date:** 2026-05-24

### Added
- `react-grid-layout` v1 replacing the static CSS grid in `App.tsx`
- Each widget is independently resizable from all 8 handles (corners + edges)
- Drag-to-reorder via title bar grip — other widgets reflow automatically on every move/resize
- Layout persisted to `localStorage` via Zustand `persist` middleware — survives app restarts
- 4 premade layout presets tuned for 1920×1080, selectable from a fixed top-right toolbar:
  - **Default** — balanced 5-panel split
  - **Stocks Focus** — stocks large left, others right
  - **Media** — Spotify prominent left, everything else right
  - **System** — hardware monitor dominant, stocks full-width bottom
- `WidgetShell` component — title bar with grip icon as drag handle, content fills remaining space
- `LayoutToolbar` component — highlights active preset, switches layout instantly on click
- `DashboardGrid` component — `WidthProvider(ReactGridLayout)` mapping layout items to widget components
- `layoutStore` (Zustand) — `setLayout` / `applyPreset` / `resetToDefault`
- `src/lib/layouts.ts` — all preset definitions, `WidgetId` type, `NamedLayout` interface
- `clsx`, `tailwind-merge`, `lucide-react` added to renderer deps
- `src/lib/utils.ts` — `cn()` helper (clsx + twMerge)
- Dark-themed resize handles — only visible on hover

### Changed
- `App.tsx` — replaced inline static grid with `<DashboardGrid />` + `<LayoutToolbar />`
- `index.css` — added react-grid-layout and react-resizable base styles; custom dark-theme overrides for placeholder and resize handles
- All 4 presets redesigned to be mathematically gap-free — every grid cell covered by exactly one widget, verified column-by-column (sum of `h` values for any column `x` = `numRows`)
- `compactType='vertical'` added — items compact upward on drag so no holes are left behind
- `rowHeight` changed from fixed `40` to dynamic — computed from window height and current layout's max row extent so the grid always fills 100% of the screen; recalculates on window resize

### Fixed
- `react-resizable` added as direct dep — pnpm strict hoisting blocked importing its CSS as a transitive dep of `react-grid-layout`
- Downgraded `react-grid-layout` from v2 (complete API rewrite, no `WidthProvider`) to v1 (stable, documented API); replaced stub `@types/react-grid-layout@2.1.0` with v1 types (`1.3.5`)
- Default preset had a geometric gap in the bottom-right quadrant — all presets now tile without gaps

---

## [PR #1] feat: monorepo scaffold — Electron + Vite + Fastify + Turborepo
**Branch:** `feature/monorepo-scaffold` → `master`  
**Date:** 2026-05-24

### Added
- Turborepo + pnpm workspaces monorepo with 4 packages:
  - `apps/main` — Electron main process (TypeScript, CommonJS)
  - `apps/renderer` — React 18 + Vite + Tailwind frontend
  - `packages/server` — Fastify API server on `localhost:7432`
  - `packages/shared` — shared TypeScript types, single source of truth
- `apps/main/src/index.ts` — BrowserWindow setup, dev (`loadURL :5173`) vs prod (`loadFile`) branching
- `apps/main/src/preload.ts` — typed `contextBridge` IPC via `ElectronAPI` interface from `@dash/shared`
- `apps/main/src/ipc/index.ts` — IPC handlers: `app:minimize`, `app:close`, `spotify:auth-start`
- `apps/main/src/server/spawn.ts` — spawns compiled Fastify server in prod; in dev waits for it via health-check polling
- `tsc-watch --onSuccess "electron ."` dev loop for main process — restarts Electron on successful compile
- `packages/server/src/index.ts` — Fastify with `@fastify/cors`, dotenv, all 5 route namespaces registered
- Route stubs returning 501 for all 5 widgets: weather, spotify, stocks, hardware, sound
- `packages/shared` types:
  - `WeatherData`, `TrackData`, `SpotifyAuthStatus`
  - `StocksData`, `StockQuote`
  - `HardwareData`, `CpuData`, `GpuData`, `DiskIo`, `NetworkIo`
  - `SoundData`, `AudioDevice`
  - `IpcChannels`, `ElectronAPI`
- `apps/renderer/src/lib/apiClient.ts` — typed `get`/`post` wrappers over `fetch` to `localhost:7432`
- `apps/renderer/src/types/electron.d.ts` — `window.electron` typed via `ElectronAPI`
- Placeholder widget shells for all 5 widgets
- TanStack Query v5 `QueryClient` configured in `App.tsx`
- `CLAUDE.md` — auto-loaded project instructions for Claude Code sessions
- `SPEC.md` — full project specification (source of truth for widget behavior)
- `.env.example` with all required keys
- `electron-builder.yml` — packaging config (Windows NSIS, macOS DMG)
- `turbo.json` — build pipeline with `dependsOn: ["^build"]` for correct ordering
- `tsconfig.base.json` — strict TypeScript base config extended by all packages
- `pnpm-workspace.yaml` — workspace + `onlyBuiltDependencies` for electron/esbuild

### Architecture decisions
- All external API calls route through Fastify — renderer never touches secrets directly
- Shared types in `packages/shared` imported by all packages, never redefined
- In dev, Vite alias points `@dash/shared` directly to TypeScript source (skips build step)
- `tsc paths` in main/server tsconfigs point to shared source for type resolution during `tsx watch`

### Changed (vs initial README-only repo)
- Swapped Polygon.io for Alpaca Markets — free IEX WebSocket feed, `ALPACA_API_KEY` + `ALPACA_API_SECRET`
- Spotify redirect URI set to `http://127.0.0.1:7432/spotify/callback` (localhost blocked by Spotify's form)
- `StocksData.futures` field removed — Alpaca has no futures data
- `ALPACA_BASE_URL` added to env template (`https://data.alpaca.markets/v2`)
