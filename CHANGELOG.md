# Changelog

All changes organized by pull request, newest first. Format is documented under **Changelog Format** in [CLAUDE.md](./CLAUDE.md).

---

## [PR #49] fix: dev server no longer killed on Electron restart
**Branch:** `fix/dev-server-kill-race` → `master`
**Date:** 2026-06-29

### Context
In `pnpm dev`, the Electron main process restarts whenever a main/shared file recompiles (and during a launch race). `spawnServer()` ran `killStaleOnPort(7432)` **unconditionally** — including in dev — which killed the externally-managed `tsx watch` dev server, leaving the whole API dead (`Server on :7432 did not start within 15000ms`, widgets stuck on "Failed to load").

### Fixed
- `apps/main/src/server/spawn.ts` — `killStaleOnPort(port)` now runs **only in production**, right before spawning our own server child. In dev the server is owned by `concurrently`/`tsx watch`, so Electron just waits for it. Verified: the dev server (same PID) survives repeated Electron restarts, and the packaged-app port cleanup from #42 is unchanged.

---

## [PR #48] feat: weather location override, settings tabs, clock temperature
**Branch:** `fix/weather-location` → `master`
**Date:** 2026-06-29

### Context
The weather widget hardcoded the "Austin, TX" label and offered no way to change location, and there was no home for non-secret app preferences. This makes location real and overridable, splits Settings into App/Developer tabs, adds an optional clock temperature, and lets the widget scroll.

### Added
- **App settings store** — `apps/renderer/src/store/settingsStore.ts`: Zustand + persist (`dashboard-app-settings`) holding `weatherZip` and `showTempInClock`. First non-secret, renderer-only preference store (distinct from layout/theme stores and from credentials).
- **Settings tabs** — `SettingsModal.tsx` now has **App** and **Developer** tabs. App: weather ZIP override + "Show temperature next to clock" toggle (auto-persist, no Save button). Developer: the existing credentials UI (pre-configured rows in packaged builds, editable inputs in local dev) + Save button.
- **Clock temperature** — `Titlebar.tsx`: optional current temperature next to the centered clock, gated on the toggle; shares the ZIP-scoped weather query.
- **ZIP geocoding** — `packages/server/src/routes/weather.ts`: optional `?zip=` resolved via zippopotam.us (free, no key), cached per-ZIP; Open-Meteo infers the timezone for ZIP lookups.

### Changed
- **`WeatherData`** (`packages/shared`) — added `location: { name; region? }`, populated from ip-api (auto) or zippopotam (ZIP) and surfaced in the response; the per-location weather cache is now keyed by ZIP/`auto`.
- **`WeatherWidget.tsx`** — shows the real resolved city instead of the hardcoded "Austin, TX"; root is now `overflow-y-auto` (5-day list `shrink-0`) so the widget scrolls vertically when short.
- **`useWeather(enabled)`** — reads `weatherZip` (in the query key, so changing it refetches) and accepts an `enabled` gate so the titlebar only fetches when the temperature is shown.

### Fixed
- Weather location is no longer hardcoded — it follows IP geolocation by default and a ZIP override otherwise, with the real city/region shown.

---

## [PR #47] docs: audit CLAUDE.md + rewrite CHANGELOG & README
**Branch:** `chore/docs-audit` → `master`
**Date:** 2026-06-29

### Context
The project docs had drifted from the code and accumulated rot: CLAUDE.md's widget/secret descriptions were stale, the CHANGELOG had duplicated blocks and PR numbers that didn't match GitHub, and README was a two-line stub. This PR brings all three back in sync and codifies the changelog/PR conventions.

### Changed
- **`CLAUDE.md`** — corrected the Widgets & APIs table (added YouTube/Twitch/Calendar; fixed Stocks to IEX REST; fixed the Spotify-token storage description); added **Secrets & Credentials** and **Embedding & Platform Gotchas** sections; documented build-time key baking; added the **Changelog Format** spec and `chore`/`docs` branch naming.
- **`CHANGELOG.md`** — removed duplicated entry blocks and a stray duplicate `[PR #4]`; re-derived every section's number from the real merged-PR history (joined by branch) and added the `[PR #N]` prefix everywhere; consolidated multi-entry PRs (#20, #42, #43) into one section each; standardized every entry to the canonical structure.
- **`README.md`** — rewrote from a stub into a full guide: badge hero, table of contents, features, tech stack, monorepo layout, architecture + data-flow diagram, getting started, configuration table, scripts, macOS + Windows build instructions, conventions, gotchas, and an annotated project tree.

---

## [PR #46] fix: Spotify playback — auto-activate device + surface real errors
**Branch:** `fix/spotify-device-activation` → `master`
**Date:** 2026-06-28

### Context
The app is a remote control for an external Spotify device (no Web Playback SDK — stock Electron lacks Widevine, so it can't play DRM audio itself). After sign-in with no active device, `PUT /me/player/play` returned 404 and the UI showed nothing. A separate continuous 502 on `now-playing` (Windows) was actually an upstream Spotify error (401/403/429) hidden behind a generic 502.

### Fixed
- **404 on play-track / play-context with no active device** — `packages/server/src/routes/spotify.ts`: new `startPlayback()` retries once against the first *available* device (via `firstAvailableDeviceId()`) when Spotify reports no active device. Having Spotify merely open in the background is now enough. Only when zero devices exist does it return 404 with a clearer message.
- **now-playing 502 hid the real cause** — `fetchNowPlaying()` now throws a typed `SpotifyApiError` carrying the upstream status. The route passes 401/403/429 straight through so the client shows the actual cause instead of a blanket 502. (403 = the account isn't on the Spotify app's Development-Mode allowlist, which caps at 25 users.)
- **Stale token → endless 502 loop** — the cached token at `~/.dash/spotify_tokens.json` survives reinstalls; a refresh token is bound to the client_id that minted it, so once the client_id was baked in, old tokens failed every refresh. `getValidToken()` now clears the token on a failed refresh, so `/auth-status` flips to false and the widget shows "Connect" again. (Existing users: Disconnect → Connect once.)
- **502 spam on the login screen** — before connecting, `now-playing` threw "Not authenticated" → 502 every 3s. The route now returns a clean 401, and `useNowPlaying()` is gated on `auth-status` so it doesn't poll until authenticated.

### Changed
- `apps/renderer/src/lib/apiClient.ts` — `get`/`post` extract the server's `{ error }` message so the UI shows the real reason.
- `apps/renderer/src/widgets/spotify/SpotifyWidget.tsx` — `PlaylistPanel` surfaces a playback error inline and only navigates back on success.
- `apps/renderer/src/widgets/spotify/useSpotify.ts` — `useNowPlaying(enabled)` accepts a gate; the widget passes `status.data?.authenticated === true`.

---

## [PR #44] fix: Twitch video playback + close button
**Branch:** `fix/twitch-video-close-button` → `master`
**Date:** 2026-06-28

### Fixed
- **Twitch live stream shows blank player** — same root cause as the YouTube fix: in the packaged app the renderer loads from `file://`, so `window.location.hostname` is empty and the Twitch player's `parent` param didn't match the origin. Fix: added `GET /api/twitch/embed?channel=` to Fastify (same proxy pattern as YouTube), so the embed is served from `http://localhost:7432` where `parent=localhost` is accurate.
- **Twitch CSP frame-ancestors block** — the player document returns `Content-Security-Policy: frame-ancestors http://localhost:*`, which validates the *entire* ancestor chain; the top-level `file://` violated it even with the localhost proxy. `apps/main/src/index.ts` now strips the CSP header from `player.twitch.tv` responses via `webRequest.onHeadersReceived`, scoped to the player document only (the video CDN is untouched).

### Added
- **Close button** — the frameless window had no way to close. Added an X button to the right of Settings in the titlebar (with a divider); hover turns red; calls `window.electron.close()` (existing `app:close` IPC).

### Changed
- `packages/server/src/routes/twitch.ts` — added `/embed` route; channel validated against `/^[A-Za-z0-9_]{1,25}$/`.
- `apps/renderer/src/widgets/twitch/TwitchWidget.tsx` — iframe src → `http://localhost:7432/api/twitch/embed?channel=…`; removed `PLAYER_PARENT`.
- `apps/renderer/src/components/Titlebar.tsx` — close button after Settings.

---

## [PR #43] fix: Spotify login + bake all API keys at build time
**Branch:** `fix/spotify-client-id` → `master`
**Date:** 2026-06-28

### Context
Spotify login failed with "client_id: Not present", and a distributed build had no way for users to supply keys. This PR added the missing credential, fixed the redirect URI, then baked all API keys into the build so a shipped DMG/EXE works with no setup.

### Fixed
- **"client_id: Not present"** — `SPOTIFY_CLIENT_ID` was read from `process.env` but was never part of the credentials system. Added to `CREDENTIAL_KEYS`/`CREDENTIAL_DEFS` so it appears in Settings and is stored/injected like the other keys.
- **Empty redirect URI** — `redirectUri()` fell back to `''`; default is now `http://localhost:7432/api/spotify/callback`.

### Changed
- `packages/server/build.mjs` — new esbuild script (replaces the inline CLI) bakes all credential keys (`SPOTIFY_CLIENT_ID`, `YOUTUBE_API_KEY`, `ALPACA_API_KEY`, `ALPACA_API_SECRET`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`) from the root `.env` at package time via esbuild `--define` as `*_BUILTIN`. Values land in the compiled bundle only — never in source or git.
- `packages/server/package.json` — build script now runs `node build.mjs`.
- `packages/server/src/routes/{spotify,youtube,stocks,twitch}.ts` — each route checks runtime env (safeStorage/Settings) first, falls back to the baked `_BUILTIN` value.
- `packages/server/src/index.ts` — added `GET /api/credentials/builtin` returning baked key *names* only (never values).
- `apps/renderer/src/components/SettingsModal.tsx` — shows a "Pre-configured" lock indicator instead of an input for baked-in keys; `CredentialRow` renders an optional `hint` line.
- `packages/shared/src/types/credentials.ts` — added `SPOTIFY_CLIENT_ID` with a hint pointing to developer.spotify.com.

### Notes
Users who download the app get Spotify working with no setup; entering their own key in Settings overrides the baked-in value.

---

## [PR #42] fix: server port conflict on relaunch + YouTube embed proxy
**Branch:** `fix/server-port-conflict-youtube` → `master`
**Date:** 2026-06-28

### Context
Two issues on one branch: APIs were dead on every other launch (a stale server still bound to :7432), and YouTube playback errored under the packaged `file://` origin.

### Fixed
- **Every other launch unresponsive** — `apps/main/src/server/spawn.ts`: `killStaleOnPort()` now runs before spawning the server, clearing a crashed previous instance off :7432 (`lsof`/`kill` on mac/linux, `netstat`/`taskkill` on Windows) so the new server always binds.
- **YouTube errors 152–154** — the original `webRequest` interceptor injected `Referer` on `*.googlevideo.com` CDN requests, which the CDN rejected, breaking every video. Replaced header-spoofing with a **localhost embed proxy**: the widget loads `http://localhost:7432/api/youtube/embed?videoId=…` (Fastify serves a minimal HTML wrapper around the `youtube-nocookie` iframe), so YouTube sees a valid `http://localhost` origin instead of `file://`. The `onBeforeSendHeaders` interceptor was removed; only the Electron UA strip remains.

### Changed
- `packages/server/src/routes/youtube.ts` — added `GET /api/youtube/embed?videoId=` (videoId validated `/^[A-Za-z0-9_-]{6,16}$/`).
- `apps/renderer/src/widgets/youtube/YoutubeWidget.tsx` — iframe `src` → local embed proxy.
- `apps/main/src/index.ts` — removed the Referer interceptor; kept the Electron UA strip.

---

## [PR #41] fix: YouTube Error 153 (video player configuration error)
**Branch:** `fix/youtube-error-153` → `master`
**Date:** 2026-05-31

### Fixed
- **`apps/main/src/index.ts`** — strips `Electron/x.x.x` from the default session user-agent before any windows open. YouTube detects the Electron UA and returns Error 153 for most videos; removing it makes the renderer appear as plain Chrome and playback works.

---

## [PR #39] feat: edit saved custom themes
**Branch:** `feat/edit-custom-themes` → `master`
**Date:** 2026-05-31

### Added
- **`themeStore.ts`** — `updateCustomTheme(id)`: snapshots current `customColors` into the named saved entry, keeping the same `id`/`name`.
- **`Titlebar.tsx` `CustomEditor`** — accepts optional `editTarget?: SavedCustomTheme` + `onUpdate?`. In edit mode renders an `Edit "<name>"` header and a single "Save changes" button.
- **`Titlebar.tsx` `ThemeMenu`** — clicking a saved custom theme applies it and opens the editor in edit mode; color tweaks update `customColors` live; "Save changes" snapshots them back.

---

## [PR #38] feat: edit saved custom layouts
**Branch:** `feat/edit-custom-layouts` → `master`
**Date:** 2026-05-30

### Added
- **`layoutStore.ts`** — `updateCustomLayout(id)`: snapshots current `layout` + `visibleWidgets` into the named saved entry, keeping the same `id`/`name`.
- **`Titlebar.tsx` `CustomLayoutEditor`** — accepts optional `editTarget?: SavedCustomLayout` + `onUpdate?`. In edit mode renders an `Edit "<name>"` header and a single "Save changes" button.
- **`Titlebar.tsx` `LayoutsMenu`** — clicking a saved layout applies it immediately (so you can drag/resize) and opens the editor in edit mode; "Save changes" snapshots the current layout + visible widgets back.

---

## [PR #37] feat: Spotify disconnect button
**Branch:** `feat/spotify-logout` → `master`
**Date:** 2026-05-31

### Added
- **`packages/server/src/routes/spotify.ts`** — `POST /api/spotify/logout`: clears the in-memory token, deletes `~/.dash/spotify_tokens.json`, and clears the now-playing cache. Immediately unauthenticated without a restart.
- **`useSpotify.ts`** — `useSpotifyLogout` mutation: calls logout and flips `spotify-status` to `{ authenticated: false }` optimistically.
- **`SpotifyWidget.tsx`** — a small `LogOut` icon appears top-right on hover; clicking disconnects and returns the widget to the Connect screen.

---

## [PR #36] fix: presets restore visible widgets on apply
**Branch:** `fix/preset-visible-widgets` → `master`
**Date:** 2026-05-31

### Changed
- **`layouts.ts`** — `NamedLayout` gains optional `visibleWidgets?: WidgetId[]`. `Default` sets all 8 widgets; `Home` sets all except `twitch`. Other presets leave it unchanged.
- **`layoutStore.ts`** — `applyPreset` now sets `visibleWidgets` to `preset.visibleWidgets` when defined, then regenerates the layout from that set.

---

## [PR #35] feat: update Home preset to match actual nish layout
**Branch:** `feat/home-preset-v2` → `master`
**Date:** 2026-05-31

### Changed
- **`layouts.ts`** — Home preset updated: YouTube (h=12) spans the full right width at top; Spotify (w=6, h=10) and Weather (w=6, h=10) sit side-by-side below it. Weather is woven into the BSP tree. Twitch remains absent (falls to bottom-row overflow if toggled on).

---

## [PR #34] feat: add Home preset layout
**Branch:** `feat/home-preset` → `master`
**Date:** 2026-05-31

### Added
- **`layouts.ts`** — new `Home` built-in preset: Hardware + Sound stacked left (cols 0–5), Stocks + Calendar stacked middle (cols 6–11), YouTube + Spotify stacked right (cols 12–23). Twitch and Weather absent from the BSP tree; if toggled on they fall to a bottom-row overflow via the existing `generateLayout` fallback.

---

## [PR #33] feat: saveable custom layouts with per-layout pinned tiles
**Branch:** `feat/custom-layouts` → `master`
**Date:** 2026-05-31

### Added
- **Custom layouts** — arrange the dashboard (drag/resize, pin/unpin which tiles show) and save it under a name. Saved layouts appear under **Layouts → Custom**, mirroring **Themes → Custom**. Applying a saved layout restores both the tile geometry and that layout's pinned-tile set.
- **`apps/renderer/src/store/layoutStore.ts`** — new `SavedCustomLayout` (`{ id, name, layout, visibleWidgets }`) + `savedCustomLayouts`, `activeCustomLayoutId` state and `saveCustomLayout` / `deleteCustomLayout` / `applyCustomLayout` actions (deep-copied snapshots). `onRehydrateStorage` back-fills the new fields.
- **`apps/renderer/src/components/Titlebar.tsx`** — `LayoutsMenu` reworked into a three-panel flow (`list` → `custom-list` → `editor`) like `ThemeMenu`. New `CustomLayoutEditor` (in-menu pin/unpin + Save-as name) and `LayoutDeleteModal`. The editor renders no backdrop so the grid stays draggable while editing.

### Changed
- **`layoutStore.ts`** — `setLayout`, `applyPreset`, `resetToDefault`, `showWidget`, `hideWidget` now clear `activeCustomLayoutId` so the active-custom highlight only persists while unmodified.

### Notes
- `pinnedPresets` (titlebar-pinned layouts) is unchanged and applies to built-in presets only. "Pinned tiles" in the editor = visible widgets, a separate concept.

---

## [PR #32] fix: `pnpm package` works on non-admin Windows
**Branch:** `fix/windows-build-cache` → `master`
**Date:** 2026-05-31

### Fixed
- `electron-builder` downloads `winCodeSign-2.6.0.7z` and extracts it with `7za`. The archive contains macOS dylib symlinks; on Windows, creating symlinks needs admin/Developer Mode, so `7za` exits with code 2 and the whole run aborts — the Windows installer was unbuildable from a normal account.
- Added **`scripts/prepare-wincodesign.cjs`** — a no-op on macOS/Linux. On Windows it downloads the archive (if not cached) and extracts it with `-xr!darwin` so `7za` never touches the symlink entries, then places it at the cache path electron-builder expects.
- **`package.json`** — `package` runs the prep script before `electron-builder` and passes `CSC_IDENTITY_AUTO_DISCOVERY=false` (no Windows signing cert). Added `packageManager: "pnpm@11.3.0"` so Turbo can resolve the workspace.

### Output
- `release/Nishboard Setup 0.1.0.exe` (NSIS installer, unsigned). End users see SmartScreen → **More info → Run anyway**.

---

## [PR #31] feat: rename to Nishboard; remove YouTube named layout preset
**Branch:** `feat/nishboard-no-youtube` → `master`
**Date:** 2026-05-31

### Changed
- **`electron-builder.yml`** — `productName: Dashboard` → `Nishboard`; `appId` → `com.nish.nishboard`. The packaged app now appears as **Nishboard**.
- **`apps/renderer/src/lib/layouts.ts`** — the named **YouTube** preset removed from `PRESETS`/`PRESET_TREES`. The YouTube widget itself is unchanged — it still appears in all other presets and is togglable from the Widgets menu.

---

## [PR #30] fix: Windows master volume slider snaps to 0 + app mixer empty
**Branch:** `fix/sound-windows-v2` → `master`
**Date:** 2026-05-31

### Fixed
- **Master slider snapped to 0** — `winGetDeviceData()` parsed `Get-AudioDevice -PlaybackVolume` as a number, but the module returns a string with a trailing `%` (e.g. `"42%"`). `Number("42%")` → `NaN` → serialized `null` → coerced to `0`. Now strips `%`, trims, and throws on non-finite so the WASAPI fallback kicks in.
- **App mixer always empty** — three compounding bugs:
  1. `psRun` used `-EncodedCommand` which base64-encoded the WASAPI script past Windows' 8191-char command-line limit. Switched to a UTF-16 LE temp `.ps1` invoked via `-File` (`-ExecutionPolicy Bypass`).
  2. PowerShell's `-as`/cast operators don't trigger `QueryInterface` on dynamically Add-Typed COM interfaces. Moved all session walking into a single C# `[W]::GetSessions()` where C# casts emit QI at compile time; PowerShell only receives the final `string[]`.
  3. Every COM method needed `[PreserveSig]`; without it `IsSystemSoundsSession()` returned 0 for every session (all apps showed as "System Sounds"). With it, real apps resolve correctly.

---

## [PR #29] fix: electron-builder config for monorepo packaging
**Branch:** `fix/electron-builder-packaging` → `master`
**Date:** 2026-05-30

### Fixed
- **`electronVersion: "33.4.11"`** added to `electron-builder.yml` — builder couldn't detect Electron (it lives in `apps/main/node_modules`, not root).
- **`apps/main/package.json`** included in the bundled app root via `files` — builder requires `app/package.json` inside the app bundle; tsc doesn't emit it.
- **`package.json`** (root) — added `description`/`author` to silence warnings.
- Produces `release/Dashboard-0.1.0-arm64.dmg` on macOS arm64.

---

## [PR #28] feat: save and name custom themes
**Branch:** `feat/named-custom-themes` → `master`
**Date:** 2026-05-30

### Added
- **Named custom themes** — save any custom color set under a name (Zustand persist).
- **Custom themes submenu** — "Create new" first; saved themes below a divider, each with a color swatch + hover-reveal ✕ delete.
- **Delete confirmation modal** — fixed modal with Cancel / Delete.
- **Save-as section** in the color editor — name input + Save button.
- `SavedCustomTheme` (`{ id, name, colors }`) + `saveCustomTheme` / `deleteCustomTheme` / `applyCustomTheme` actions; `activeCustomId` highlights the active saved theme.

### Changed
- `setCustomColors` clears `activeCustomId` (colors become "unsaved" once edited).
- Opening Themes while a custom theme is active goes straight to the custom submenu.

---

## [PR #27] feat: Twitch widget — channel search + in-tile playback
**Branch:** `feat/twitch-widget` → `master`
**Date:** 2026-05-30

### Added
- **New `twitch` widget** mirroring YouTube: search channels, select one to play the live stream embedded in the tile, with a search overlay that keeps playback mounted in the background.
- **`packages/shared/src/types/twitch.ts`** — `TwitchChannel` + `TwitchSearchPage`.
- **`packages/server/src/routes/twitch.ts`** — `GET /api/twitch/search?q=` proxy. Auth uses a cached **client-credentials app access token** (no user OAuth); refreshes before expiry and on 401.
- **`apps/renderer/src/widgets/twitch/`** — `TwitchWidget.tsx` + `useTwitch.ts`. Registered in `lib/layouts.ts` and `DashboardGrid.tsx`.
- **`generateLayout()`** now appends any visible widget missing from a preset's BSP tree as a bottom full-width row, so `twitch` appears across all presets.
- **`.env.example`** — `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`/`TWITCH_REDIRECT_URI` (the `localhost` form — Twitch permits non-https only for the literal `localhost` host).
- **Settings UI** (`SettingsModal.tsx`) — grouped credential inputs (Alpaca, Twitch) with show/hide toggles; encrypted via `safeStorage` IPC; server restarts with new env on save.
- **App icon**, **packaging fixes** (`asar: false`; server spawn path; `restartServer()`), **credential IPC** (`credentials:get-all`/`save-all`).

### Notes / TODO
- **Playback `parent` param** — works in dev (renderer on `localhost`); a packaged `file://` build needs the localhost embed proxy (added later in #44).
- `TWITCH_REDIRECT_URI` is unused (search/playback are app-token only) — kept for future user OAuth.

---

## [PR #25] feat: custom theme, distinct swatches, Themes label
**Branch:** `feat/theming-updates` → `master`
**Date:** 2026-05-30

### Added
- **Custom theme** — four color pickers (Background, Cards, Borders, Text) with live preview; hex + `rgb()` input + native swatch. All 13 semantic tokens derived via linear mixing in `src/lib/colorUtils.ts`. Semantic data colors (stock green/red, hardware read/write) untouched.
- **`src/lib/colorUtils.ts`** — `parseHex`, `hexToArr`, `buildCustomVars`, `CUSTOM_VAR_KEYS`.
- **`CustomColors`** exported from `themeStore.ts` — persisted to localStorage.

### Changed
- **ThemeMenu** now shows a `Themes` label + active-color bubble; two-panel (list → custom editor).
- **Distinct swatches** for similar greys (Contrast → yellow, Dracula → purple, Nord → frost cyan); Nord/Dracula CSS vars pushed bluer/more-purple.
- **`App.tsx`** applies custom vars via `useLayoutEffect` on `documentElement` when `theme === 'custom'`.

---

## [PR #24] feat: theme menu expansion — 10 additional themes
**Branch:** `claude/theme-menu-expansion` → `master`
**Date:** 2026-05-30

### Added
- **10 new themes** in `src/themes.ts` + `src/index.css` (`[data-theme]` blocks), total 15: Forest, Sunset, Dracula, Nord, Solarized, Crimson, Mocha, Neon, Sandstorm, Arctic. Each defines all 13 semantic tokens, so widgets pick them up with no changes. `ThemeMenu` already renders from `THEMES`.

---

## [PR #23] feat: theming system — 5 themes, ThemeMenu
**Branch:** `feat/theming` → `master`
**Date:** 2026-05-27

### Added
- **`tailwind.config.ts`** — 13 semantic tokens backed by CSS custom properties (`th-bg`, `th-surface`, `th-elevated`, `th-overlay`, `th-line`, `th-hi`, `th-2`, `th-3`, `th-ghost`, `th-accent`, `th-bar`, `th-invert-bg`, `th-invert-text`), all supporting opacity modifiers via `rgb(var(--t-*) / <alpha-value>)`.
- **`src/themes.ts`** — `ThemeId` union + `THEMES` array (5 themes).
- **`src/store/themeStore.ts`** — Zustand persist; default `midnight`.
- **`src/index.css`** — `[data-theme]` blocks for all 5; resize-handle + grid-placeholder styles use tokens.
- **5 themes:** Midnight (default), Slate, Ocean, Contrast, Rose.

### Changed
- **`App.tsx`** applies `data-theme`; root is `bg-th-bg`.
- **`Titlebar.tsx`** — added `ThemeMenu`.
- **`WidgetShell.tsx`** + **all 8 widgets** — `zinc-*` → `th-*` tokens (semantic data colors intentionally untouched).

---

## [PR #22] feat: dynamic BSP layouts + general UI polish
**Branch:** `feature/general-fixes` → `master`
**Date:** 2026-05-26

### Added
- **`layouts.ts`** — Binary Space Partition (BSP) layout engine.
  - `SplitNode` discriminated union (`leaf | v-split | h-split`) with constructors `l / v / h`.
  - `PRESET_TREES` — each preset encoded as a BSP tree, verified column-by-column.
  - `pruneTree(node, visible)` — removes hidden leaves; surviving siblings expand to fill (gap-free at any count).
  - `renderTree(...)` — walks the pruned tree into integer-grid `Layout[]`.
  - `generateLayout(presetName, visibleIds)` — gap-free `Layout[]` for any subset, or `null`.

### Changed
- **`layoutStore.ts`** — `applyPreset` / `hideWidget` / `showWidget` / `resetToDefault` regenerate gap-free via `generateLayout` (with `autoFillLayout` fallback).

### Notes
- Static `PRESETS[]` retained as fallback + source of truth for ratios.
- Titlebar: Layouts/Widgets menus, pinned-preset quick buttons, centered clock (ET).
- Stocks: market-session status dot. Hardware: defaults to sparks view.

---

## [PR #20] feat: YouTube widget — search, player, all layouts
**Branch:** `feat/youtube-widget` → `master`
**Date:** 2026-05-26

### Added
- **`YoutubeWidget.tsx`** — search + embedded player. Search triggers on Enter/arrow (no per-keystroke search — preserves quota); results cached 5 min. Clicking a result plays it in a `youtube-nocookie.com/embed/` iframe (`autoplay=1`).
- **`packages/server/src/routes/youtube.ts`** — `GET /api/youtube/search?q=&pageToken=`; YouTube Data API v3; decodes title entities; returns 503 if `YOUTUBE_API_KEY` unset.
- **`packages/shared/src/types/youtube.ts`** — `YoutubeVideo`, `YoutubeSearchPage`. **`useYoutube.ts`** — `useYoutubeSearch(query)`.
- **`.env`** — `YOUTUBE_API_KEY=` placeholder.

### Changed
- **State-machine UX** (home / search / playing): scaling YouTube wordmark home; search view with back arrow + autofocus; playing view with iframe + 44px control bar (title, channel, search-without-stopping, close). Resume-on-back keeps the iframe mounted at `height:0` to preserve playback position.
- **All presets include YouTube** — every preset reworked to cover 24×22 gap-free; added `ALL_WIDGET_IDS` + `autoFillLayout()` so any widget missing from a stored/custom layout is appended to the bottom row. `applyPreset`/`resetToDefault`/`onRehydrateStorage` run `autoFillLayout`.

### API key required
YouTube Data API v3 key (Google Cloud Console). Free tier 10,000 units/day; search = 100 units (~100 searches/day).

---

## [PR #19] fix: weather + hardware scroll broken on Windows (callback ref)
**Branch:** `fix/scroll-callback-ref` → `master`
**Date:** 2026-05-26

### Fixed
- **Root cause** — both widgets used `useRef` + `useEffect(fn, [])`; the effect fired before the scrollable element existed (loading/error early returns render first), so `ref.current` was null and the effect never re-ran.
- **Fix** — replaced `useRef` with a `useState` callback ref (`ref={setEl}`) so React calls the setter on mount, triggering `useEffect([el])` with the real element.
- **`WeatherWidget`** — hourly wheel + drag now work; normalises `deltaMode === 1` (Windows line-mode scroll) by ×40.
- **`HardwareWidget`** — vertical drag-to-scroll wires up after data loads.

---

## [PR #18] feat: calendar widget
**Branch:** `feat/calendar-widget` → `master`
**Date:** 2026-05-26

### Added
- **`CalendarWidget.tsx`** — pure-JS date rendering, no API. Shows one or more months depending on space, using the callback-ref + retry-RAF pattern so it measures on first render.
  - Each month: name+year header, Su–Sa row, 6×7 date grid (always 6 rows). Today gets a filled circle. Minimum 155×195px per month; tiles additional months in a CSS grid at larger sizes; with 3+ months the current month anchors second.
- **`calendar`** added to `WidgetId`, `WIDGET_TITLES`, `WIDGET_COMPONENTS`; all presets reworked to include it.

---

## [PR #17] feat: titlebar with window drag + expanded layout presets
**Branch:** `feat/titlebar-and-layouts` → `master`
**Date:** 2026-05-25

### Added
- **`Titlebar.tsx`** — 32px bar above the grid. "nishboard" label left; whole bar carries `-webkit-app-region: drag`; right side hosts preset buttons with `no-drag`. Replaces the old floating `LayoutToolbar`.
- **Layout presets** — renamed "Stocks Focus" → "Markets"; added **Focus**, **Chill**, **Wide**.

### Changed
- **`App.tsx`** — `flex-col`; Titlebar above a `flex-1` grid.
- **`DashboardGrid.tsx`** — `useRowHeight` subtracts `TITLEBAR_H` (32px).
- **`LayoutToolbar.tsx`** — deleted.

---

## [PR #16] fix: Spotify widget resize broken on macOS on fresh `pnpm dev`
**Branch:** `fix/spotify-resize-mac` → `master`
**Date:** 2026-05-25

### Fixed
- **Root cause** — `SpotifyWidget`'s conditional early returns don't render the `ref` div, so `containerRef.current` is null when `useLayoutEffect([])` fires; with an empty dep array the ResizeObserver is never set up and the widget stays `sm` forever.
- **Fix** — `useState` callback ref + `useEffect([containerEl])`. Retained a retry-RAF loop because Chromium can return `0` from `getBoundingClientRect` for several frames while the flex row composites.

---

## [PR #15] fix: weather hourly strip — hide scrollbar, add wheel + drag-to-scroll
**Branch:** `fix/weather-scrollbar-windows` → `master`
**Date:** 2026-05-25

### Fixed
- **Scrollbar hidden cross-platform** (`index.css`) — added explicit `.scrollbar-none` rules (`::-webkit-scrollbar { display:none }`, `scrollbar-width: none`, `-ms-overflow-style: none`). The class name existed before with no backing CSS, so Windows always showed the native bar.
- **Wheel → horizontal scroll** + **click-and-drag pan** (`WeatherWidget.tsx`) on the hourly strip; cursor → `grabbing`; listeners on `window` so drag continues off-strip.

### Changed
- **`CLAUDE.md`** — Git Workflow updated to "Do NOT auto-merge — wait for Nish to explicitly say 'merge'".

---

## [PR #14] chore: document git workflow + memory protocol in CLAUDE.md
**Branch:** `chore/claude-md-workflow-rules` → `master`
**Date:** 2026-05-25

### Changed
- **`CLAUDE.md`** — added **Git Workflow** (branch-first, CHANGELOG-before-PR, branch naming) and **Memory Protocol** (preferences go into both committed CLAUDE.md and local machine memory).

---

## [PR #13] fix: Spotify — conditional text scroll + macOS sizing init
**Branch:** `fix/spotify-scroll-overflow` → `master`
**Date:** 2026-05-25

### Fixed
- **Conditional scroll** (`ScrollingText`) — text only animates when it actually overflows; a `ResizeObserver` re-measures on width change (1px tolerance to avoid spurious animation).
- **macOS sizing init** — `getBoundingClientRect().height` can return `0` inside `useLayoutEffect` before the flex row composites; a `requestAnimationFrame` re-seed reads the correct height after first paint.

---

## [PR #12] feat: Spotify scrolling-text marquee + ResizeObserver timing fix
**Branch:** `fix/spotify-bugfixes` → `master`
**Date:** 2026-05-26

### Added
- **Scrolling text** (`SpotifyWidget.tsx`) — track/artist/album scroll horizontally instead of truncating: 2s pause → 40px/s scroll → 2s pause → instant reset → repeat (Web Animations API). Short text stays static.

### Fixed
- **ResizeObserver timing** — `useLayoutEffect` instead of `useEffect`; seeds the initial `SizeVariant` from `getBoundingClientRect()` to avoid a stuck `sm` layout.
- **`xs` dead-zone** — compact layout switched to `justify-center gap-3`.

---

## [PR #11] feat: Spotify widget — 5-tier responsive layout
**Branch:** `feat/spotify-responsive-5tier` → `master`
**Date:** 2026-05-26

### Changed
- **5-tier `SizeVariant`** (`SpotifyWidget.tsx`) driven by a `ResizeObserver`: `xs` <200, `sm` 200–299, `md` 300–399, `lg` 400–479, `xl` ≥480px — album art and control icons scale per tier. `VolumeSlider` icon/width scale at `lg`/`xl`.

---

## [PR #10] fix: Spotify expanded layout flex pass-through
**Branch:** `fix/spotify-layout-flex` → `master`
**Date:** 2026-05-25

### Fixed
- **Expanded layout not filling height** (`SpotifyWidget.tsx`) — `h-full` could resolve to 0 in Chromium when the parent is `flex-1 min-h-0` without explicit height. Fixed by making the wrapper `flex-1 min-h-0 flex flex-col` and the expanded root `flex-1 flex flex-col` (inherit flex sizing, not percentage height).

---

## [PR #9] fix: Spotify widget bugfixes — liked songs, volume slider, responsive, icon polish
**Branch:** `fix/spotify-bugfixes` → `master`
**Date:** 2026-05-25

### Fixed
- **Liked Songs 400** — `/v1/me/tracks` caps at 50; server was sending 100. Now clamps that branch to `Math.min(50, …)`.
- **Volume slider jumping back** — `useSpotifyVolume.onSettled` immediately invalidated `now-playing`, refetching Spotify's stale volume over the optimistic update. Removed `onSettled`; 3s polling syncs.
- **Playlist icon color** — `text-zinc-600` → `text-zinc-500`.
- **Responsive expanded layout** — true `h-full flex flex-col` (title top, art in `flex-1` grow zone, controls bottom).

### Changed
- **Header removed** — green dot + "SPOTIFY" stripped (~32px); search/playlist icons moved inline.

---

## [PR #8] feat: Spotify search dialog with play / add-to-queue
**Branch:** `feat/spotify-search` → `master`
**Date:** 2026-05-25

### Added
- **Search dialog** (`SpotifySearchDialog.tsx`) — portal'd overlay, 250ms debounced, Esc/backdrop closes. Result rows with **▶ Play** / **+ Queue** + inline feedback.
- `GET /api/spotify/search?q&limit` — proxies Spotify search (`type=track,episode`); 30s cache, LRU at 100.
- `POST /api/spotify/queue { uri, deviceId? }`.
- `SpotifySearchResults` type; `useDebouncedValue`, `useSpotifySearch`, `useQueueTrack` hooks.

### Notes
- `market=from_token` omitted (scope not present). Queue requires an active playback context.

---

## [PR #7] feat: Spotify widget — now playing, playlists, track list, podcasts, OAuth
**Branch:** `feature/spotify-widget` → `master`
**Date:** 2026-05-25

### Added
- `packages/server/src/routes/spotify.ts` — full implementation:
  - **PKCE OAuth:** `GET /auth-url`, `GET /callback`. Tokens persisted to `~/.dash/spotify_tokens.json`; auto-refresh < 60s from expiry.
  - `GET /auth-status`, `GET /now-playing` (2.5s cache, podcast support via `additional_types=track,episode`).
  - `POST /play`, `/pause`, `/next`, `/previous`, `/seek`, `/volume`, `/shuffle`, `/repeat`.
  - `GET /playlists` (20/page, Liked Songs synthetic item), `GET /playlist-tracks` (100/page), `GET /devices` (5s cache).
  - `POST /play-context`, `POST /play-track`.
- `packages/shared/src/types/spotify.ts` — `TrackData`, `SpotifyPlaylist`, `SpotifyDevice`, page types.
- `useSpotify.ts` — infinite queries, devices, play-context/play-track, optimistic playback mutations.
- `SpotifyWidget.tsx` — Connect (PKCE via `shell.openExternal`), now-playing (art, smooth progress, controls, shuffle/repeat, volume, ±15s), playlist panel (infinite scroll, device chips, Liked Songs), podcast now-playing.
- `apps/main` — `spotify:open-auth` IPC + preload. `apiClient` fix: omit `Content-Type` when no body; skip `res.json()` on 204.

### Notes
- Redirect URI `http://127.0.0.1:7432/api/spotify/callback` must be registered in the Spotify dashboard. Token file: `~/.dash/spotify_tokens.json` (delete to force re-auth).

---

## [PR #6] feat: hardware widget — CPU/GPU/RAM/disk/network with bars + sparklines
**Branch:** `feature/hardware-widget` → `master`
**Date:** 2026-05-25

### Added
- `packages/server/src/routes/hardware.ts` — `systeminformation`, all subsystems in parallel: CPU (static brand/cores cached + live load/temp), GPU (highest-VRAM controller; nvidia-smi on Windows), RAM (`mem.active` + swap), disk I/O (`fsStats`) + per-mount usage (`fsSize`, virtual filtered), network (Mbps, loopback excluded), battery (when present), uptime. 900ms cache.
- `packages/shared/src/types/hardware.ts` — extended `CpuData`/`GpuData`/`HardwareData` + `DiskUsage`.
- `useHardware.ts` — 1s refetch + 60-entry rolling history buffers.
- `HardwareWidget.tsx` — **Bars** + **Sparks** (Recharts) modes; per-core mini bars; temp color-coding; Configure panel (toggle sections, persisted to `hardware-config`); placeholders rather than unmounting.

### Notes
- Windows GPU metrics need NVIDIA drivers (nvidia-smi). macOS Apple Silicon GPU usage unavailable; battery on MacBooks. Disk I/O is 0 on the first poll.

---

## [PR #5] feat: sound widget — volume, mute, device switching, Windows app mixer
**Branch:** `feature/sound-widget` → `master`
**Date:** 2026-05-25

### Added
- `packages/server/src/routes/sound.ts` — **macOS:** `osascript` (volume/mute) + `SwitchAudioSource` (devices). **Windows:** `AudioDeviceCmdlets` preferred, WASAPI inline-C# fallback (`IAudioEndpointVolume`). **App mixer (Windows):** `IAudioSessionManager2` enumeration (one row per PID); names via bulk `Get-Process`. `POST /api/sound/sessions/volume`. 5s cache, cleared on mutation.
- `packages/shared/src/types/sound.ts` — `AudioSession` + `sessions[]`.
- `useSound.ts` — 5s poll + optimistic mutations.
- `SoundWidget.tsx` — master slider + mute, output device list, App Mixer (Windows, hidden when empty). Sliders sync from parent only when pointer is up (no snap-back).
- `packages/server/src/cache/SimpleCache.ts` — added `clear()`.

### Notes
- macOS device switching needs `brew install switchaudio-osx`. Windows device switching needs `Install-Module AudioDeviceCmdlets` (volume/mute work without it via WASAPI).

---

## [PR #4] feat: stocks widget — Alpaca IEX REST snapshots, card grid, editable watchlist
**Branch:** `feature/stocks-widget` → `master`
**Date:** 2026-05-24

### Added
- `packages/server/src/routes/stocks.ts` — Alpaca IEX REST: `?symbols=` (max 50; defaults to 8 majors); snapshots + 5-min bars in parallel (bars non-critical); market-hours via `Intl.DateTimeFormat` (`America/New_York`); 5s cache.
- `apps/renderer/src/store/stocksStore.ts` — Zustand persist watchlist.
- `useStocks.ts` — 5s refetch, watchlist as query param.
- `StocksWidget.tsx` — 2-col card grid (triangle, ticker, % change, Recharts sparkline, price); pencil → watchlist edit modal; market status dot.

### Changed
- `packages/shared/src/types/stocks.ts` — added `sparkline: number[]`.

### Removed
- `services/alpacaWs.ts` + `services/stocksService.ts` — WebSocket approach dropped (REST-only).

### Notes
- Alpaca IEX = US equities only (no futures/crypto); the watchlist modal surfaces this.

---

## [PR #3] feat: weather widget — Open-Meteo, 15-min cache, full forecast UI
**Branch:** `feature/weather-widget` → `master`
**Date:** 2026-05-24

### Added
- `packages/server/src/cache/SimpleCache.ts` — generic in-memory TTL cache.
- `packages/server/src/routes/weather.ts` — Open-Meteo → `WeatherData`, 15-min cache. Austin TX hardcoded (lat 30.2672, lon -97.7431); current + 12 hourly + 5-day daily; °F, mph, `America/Chicago`.
- `useWeather.ts` — TanStack Query, 15-min interval.
- `weatherCodes.ts` + `WeatherIcon.tsx` — WMO code → label/icon.
- `WeatherWidget.tsx` — current temp + condition + icon, 4-stat row, feels-like, horizontal hourly strip, 5-day daily strip.

---

## [PR #2] feat: layout engine — resizable/draggable grid with presets
**Branch:** `feature/layout-engine` → `master`
**Date:** 2026-05-24

### Added
- `react-grid-layout` v1 replacing the static CSS grid. Each widget resizable from all 8 handles; drag-to-reorder via title grip; layout persisted to localStorage via Zustand `persist`.
- 4 presets (Default, Stocks Focus, Media, System), `WidgetShell`, `LayoutToolbar`, `DashboardGrid` (`WidthProvider`), `layoutStore`, `src/lib/layouts.ts`, `cn()` helper. Dark resize handles visible on hover.

### Changed
- **`App.tsx`** — inline grid → `<DashboardGrid />` + `<LayoutToolbar />`.
- **`index.css`** — react-grid-layout/react-resizable base styles + dark overrides. All presets mathematically gap-free; `compactType='vertical'`; dynamic `rowHeight` from window height.

### Fixed
- `react-resizable` added as a direct dep (pnpm strict hoisting blocked its CSS). Downgraded `react-grid-layout` v2 → v1 (stable `WidthProvider` API). Fixed a Default-preset bottom-right gap.

---

## [PR #1] feat: monorepo scaffold — Electron + Vite + Fastify + Turborepo
**Branch:** `feature/monorepo-scaffold` → `master`
**Date:** 2026-05-24

### Added
- Turborepo + pnpm workspaces with 4 packages: `apps/main` (Electron, CJS), `apps/renderer` (React 18 + Vite + Tailwind), `packages/server` (Fastify on :7432), `packages/shared` (types).
- `apps/main` — BrowserWindow (dev `loadURL :5173` vs prod `loadFile`), typed `contextBridge` preload, IPC handlers, server spawn with health-check polling, `tsc-watch` dev loop.
- `packages/server` — Fastify + CORS + dotenv; 5 route namespaces (501 stubs).
- `packages/shared` — Weather/Spotify/Stocks/Hardware/Sound + IPC/ElectronAPI types.
- `apps/renderer` — typed `apiClient`, `window.electron` typing, placeholder widgets, TanStack Query.
- Tooling — `CLAUDE.md`, `SPEC.md`, `.env.example`, `electron-builder.yml` (Win NSIS / mac DMG), `turbo.json`, `tsconfig.base.json`, `pnpm-workspace.yaml`.

### Architecture decisions
- All external API calls route through Fastify; shared types never redefined. In dev, Vite + tsc paths alias `@dash/shared` to TS source (no build step). Swapped Polygon.io → Alpaca IEX; Spotify redirect URI uses `127.0.0.1`.
