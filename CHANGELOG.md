# Changelog

All changes organized by pull request, newest first. Format is documented under **Changelog Format** in [CLAUDE.md](./CLAUDE.md).

---

## [PR #91] fix: manual release dispatch must ignore the [skip release] marker
**Branch:** `fix/release-dispatch-skip` → master
**Date:** 2026-07-05

### Fixed
- **`release.yml`** — the `[skip release]` guard reads HEAD's commit message, so a `workflow_dispatch` fired while HEAD is a skipped merge (exactly the bootstrap case: #90 merged with the marker, then the first manual release) skipped too. The marker now only governs push-triggered releases; a manual dispatch is an explicit "release now".

---

## [PR #90] fix: tag-only releases — master branch protection rejected the version commit
**Branch:** `fix/release-tag-only` → master
**Date:** 2026-07-05

### Context
The first live run of #86's auto-release computed `minor → v0.2.0` correctly, then died pushing the version commit: `GH006: Protected branch update failed` — master's branch protection (rightly) refuses direct pushes, even from the Actions bot. Rather than weakening protection, releases are now **tag-only**.

### Changed
- **`release.yml` version job** — computes the current version from the **latest `v*` tag** (fallback 0.1.0) instead of package.json, and pushes **only the new tag** — no commits to master, no protection conflict, no rebase race.
- **`scripts/bump-version.mjs`** — split into `next <kind> <current>` (pure computation, prints the next version) and `set <version>` (writes root + apps/main package.json). The build jobs run `set` in their **CI workspace only** (uncommitted) right before `pnpm package`, so artifacts are named correctly and `app.getVersion()` reports the release version.
- **Version source of truth is the tag.** The repo's `package.json` `version` fields are placeholders now — never hand-edit them (CLAUDE.md + README updated).

### Notes
- Local `pnpm package` builds keep the placeholder version (0.1.0) in artifact names — dev builds, by design.
- The failed v0.2.0 run left nothing behind (no tag, no commit) — clean retry.

---

## [PR #89] feat: pop-out widgets — float any widget in its own window
**Branch:** `feat/popout-widgets` → master
**Date:** 2026-07-05

### Context
Phase 1 of the pop-out plan: every widget header gets a Pop out action (rightmost, uniform with #88's header actions) that floats the widget in a small frameless always-available window — pop out the YouTube/Twitch player and keep it playing while the grid does something else.

### Added
- **`apps/main/src/popout.ts`** — per-widget `BrowserWindow` manager: frameless, per-widget default sizes (fallback 360×320, min 220×160), position/size persisted per widget in `userData/popouts.json` and restored on reopen; re-opening an already-popped widget focuses it; same embed-hosting guards as the main window (deny window.open, will-navigate allowlist); Windows gets the transparent+rounded treatment, macOS opaque — matching `createWindow`. All popouts close when the main window truly closes (no orphaned floaters); hide-to-tray leaves them up by design.
- **IPC** — `popout:open / close / list / changed` channels + `ElectronAPI.popout` (send/send/invoke/subscribe). Ids validated main-side (`/^[a-z]{2,20}$/`).
- **Renderer entry branch** — `main.tsx` reads `?widget=<id>`: valid `WidgetId` → `PopoutShell` (micro-titlebar: drag region, the widget's own header `Actions`, close button — no grid, no command palette, **no alert notifiers** so notifications can't double-fire), anything else → the normal `App`.
- **Grid integration** — `PopoutAction` (ExternalLink icon) appended after each widget's own actions in `DashboardGrid` (hidden in a plain browser); while popped, the grid tile renders a `PoppedPlaceholder` ("Popped out · Bring back") instead of the live widget — no double polling, no double alarm chimes, no two competing players. `popoutStore` mirrors the main process's open list via `PopoutSync` (initial `list()` + `changed` broadcasts).

### Notes
- Verified in the browser preview: `?widget=weather` renders the micro-shell with live data + the widget's own header actions; invalid ids fall back to the full dashboard; main dashboard unaffected. Electron-side behavior (windows, persistence, placeholder swap) needs a `run`/`package` test.
- Known phase-2 items (planned): always-on-top pin, reopen-popouts-at-launch, cross-window live theme sync (zustand persist doesn't propagate between windows — a popout picks up theme changes on reopen).

---

## [PR #88] docs: README refresh + uniform widget header actions
**Branch:** `feat/uniform-header-actions` → master
**Date:** 2026-07-05

### Context
README had drifted badly (three widgets missing, "future user OAuth" for a shipped feature, no CI story), and widget-level actions were inconsistent: Spotify's logout lived in the widget header while YouTube/Twitch put Connect/logout inside the browse tab strip.

### Changed
- **README** — features table gains Crypto/Launcher/Clipboard and updates Spotify (♥, Recently Played), YouTube (account tabs, channel drill-in), Twitch (Live/All, go-live alerts); new **CI & Releases** section (workflows table, PR-title→semver rules, no-baked-keys note, in-app update check); config table adds `YOUTUBE_CLIENT_ID/_SECRET`, `COINGECKO_API_KEY`, `GITHUB_TOKEN` and fixes the stale "Twitch user OAuth is future work" footnote; secrets section reflects the `BUILTINS_JSON` bake and the three `~/.dash/*_tokens.json` files; conventions note load-bearing PR titles.
- **Uniform header actions** — widget-level actions (connect, logout, edit, refresh, …) all live in the WidgetShell top bar now: YouTube and Twitch Connect/disconnect moved from the browse tab strip to registry `Actions` (`YoutubeActions`, `TwitchActions` — LogIn/LogOut icons via `HeaderAction`); `SpotifyLogoutButton` became `SpotifyActions` and gains a Connect state for symmetry (the big in-widget Connect CTA stays). Signed-out browse hints now point at the widget header. The YouTube search icon stays in the tab strip by design.

### Removed
- `EmbedBrowse.HomeHeader` — the tab-strip control slot is unused now that both consumers moved to header actions.

---

## [PR #87] fix: token store no longer wipes sessions on transient refresh failures
**Branch:** `fix/token-refresh-clear` → master
**Date:** 2026-07-05

### Context
`UserTokenStore.getValidToken` cleared the persisted tokens (`~/.dash/<service>_tokens.json`) on **any** refresh error — including network failures, timeouts, and misconfiguration. This destroyed a valid Twitch session on 2026-07-05: a packaged build with missing client credentials (the then-broken `_BUILTIN` bake, fixed in PR #85) attempted a refresh with an empty `client_id`, got a 4xx from the token endpoint, and wiped the token file. The session was fine; only the credentials were missing.

### Fixed
- **`lib/userTokenStore.ts`** — the store now clears only on a new typed `RefreshAuthError` (extends `UpstreamError`, so the central error handler's status mapping applies unchanged). All other refresh failures — network errors, timeouts, 429/5xx, missing credentials — propagate without touching the stored tokens, so the session survives and the next call retries.
- **Refresh functions** (`spotify.ts refreshAccessToken`, `twitch.ts refreshUserToken`, `youtube.ts refreshYoutubeToken`) — each now (1) throws `HttpError(503)` **before** hitting the token endpoint when its client credential(s) are empty (an empty `client_id` guarantees a 4xx that would masquerade as a dead grant), and (2) maps a definitive token-endpoint rejection (`UpstreamError` 400/401/403) to `RefreshAuthError` via the shared `rethrowRefreshFailure` helper.

### Changed
- **Spotify refresh** switched from raw `fetch` (no timeout, generic `Error`) to the shared `fetchJson` — gains the standard 10s timeout and `UpstreamError` semantics the other two services already had.

### Notes
- The "definitive" statuses are 400/401/403 *from the token endpoint with credentials present* — the missing-credential guard runs first, so a 4xx can no longer be caused by empty client credentials.
- Behavior on a genuinely dead grant (e.g. token minted under a different `client_id`) is unchanged: store clears, widget flips to "Connect".

---

---

## [PR #86] chore: fully automated releases — semver bump from PR titles
**Branch:** `chore/auto-release` → master
**Date:** 2026-07-05

### Context
#84 required a manual `git tag vX.Y.Z && git push` to cut a release. Nish doesn't want to think about versioning at all — the app is written entirely by AI, so the release pipeline should be too.

### Added
- **`scripts/bump-version.mjs`** — bumps root + `apps/main` `package.json` in lockstep (they must never drift: electron-builder names artifacts from root; `app.getVersion()` reads apps/main) and prints the new version. Verified for patch/minor/patch + bad-arg rejection.
- **CLAUDE.md → "Versioning & Releases"** — the standing rules: PR titles are load-bearing (`<type>:` picks the bump), never hand-edit versions or push tags.

### Changed
- **`release.yml` rewritten** — trigger is now **every push to master** (was: `v*` tags). A `version` job reads the squash-commit subject (= PR title): `<type>!:`/`BREAKING CHANGE` → major, `feat:` → minor, else patch, `[skip release]` → no release; commits `chore(release): vX.Y.Z [skip release]`, tags, pushes (GITHUB_TOKEN pushes can't re-trigger workflows — the marker is belt-and-braces), then the existing mac/win matrix builds from that tag and attaches DMG + EXE to the Release. `workflow_dispatch` with a bump choice covers manual/off-cycle releases; a `release` concurrency group serializes racing merges.

### Notes
- Manual `git tag` pushes no longer trigger anything — use Actions → Release → Run workflow instead.
- First post-merge release will be v0.2.0 (this PR's own merge is `chore:` → …actually patch → v0.1.1; the first `feat:` merge after lands v0.2.0).

---

## [PR #85] feat: YouTube account — OAuth + Subs feed + Playlists/Liked + channel drill-in
**Branch:** `feat/youtube-account` → master
**Date:** 2026-07-05

### Context
Batch B of the accounts roadmap. YouTube was public-data only (API key: search/browse/embed). This adds Google sign-in and the personal surfaces the Data API actually exposes — subscriptions, playlists, liked videos — plus "click a channel → see its uploads" everywhere. (No watch history / home-feed recs: Google doesn't expose them; Watch Later API access was killed in 2016.)

### Added
- **Google OAuth (server)** — mirror of the Twitch flow: `/api/youtube/auth-url | callback | auth-status | logout`, auth-code grant with `access_type=offline&prompt=consent` (guarantees a refresh_token), scope `youtube.readonly`, `UserTokenStore('youtube_tokens.json')` (Google doesn't rotate refresh tokens). New credentials `YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET` (safeStorage + `_BUILTIN` bake + Settings → Developer rows). Guarded `youtube:open-auth` IPC (accounts.google.com only).
- **Subs feed** — `/api/youtube/subscriptions-feed`: subscriptions (≤100 channels) → uploads playlists (batched channels.list) → newest 5 per channel (concurrency 8, per-channel failures skipped) → merged newest-first (60). Quota ≈ N+3 units per cold refresh, 45-min cache.
- **Playlists + Liked** — `/api/youtube/my-playlists` + `/playlist-videos?playlistId=` (15-min caches); `/liked` via `videos.list?myRating=like` (the supported path — playlistItems on `LL` is dead).
- **Channel drill-in** — `/api/youtube/channel-videos?channelId=`: uploads playlist resolved properly, newest 30, 30-min cache. Public data: works with the plain API key, falls back to the user token when only OAuth is configured.
- **Embed framework: folders** — `EmbedSearchWidget` grows a generic drillable layer: `EmbedFolder`, `kind:'folders'` browse tabs (`useFolders`), `useFolderItems`, `FolderRow`, back-header view, and channel-clickable row subtitles (`EmbedItem.channel`, stop-propagation span). Optional hooks resolve to stable no-op hooks so hook order is preserved; Twitch is untouched.
- **Widget** — tabs now `Subs · Playlists · Liked · Trending · Music · Gaming` + Connect/disconnect header (Twitch pattern, 15s auth poll). `channelId` added to `YoutubeVideo` and populated by every mapper (search, browse, playlistItems via `videoOwnerChannel*`), so any row's channel name opens that channel's uploads.

### Fixed
- **Build-time key baking never worked** (pre-existing, found packaging this branch): `cred()` reads `process.env[key + '_BUILTIN']` *dynamically*, but esbuild `define` only rewrites *static* member expressions — so every `<KEY>_BUILTIN` define since the feature shipped was dead code and no packaged build ever carried baked keys (unnoticed: dev loads `.env`, and the only static `_BUILTIN` refs — the startup key list — got constant-folded). Rework: `build.mjs` injects ONE static define, a JSON blob replacing `process.env.BUILTINS_JSON` in `lib/env.ts`; `cred()` falls back to the parsed map; `/api/credentials/builtin` reads `builtinKeys()`. Verified: the bundled server with a **zero env** serves the correct Google auth-url and reports all 9 baked keys.
- **Turbo cache poisoning** (`turbo.json`): build outputs now include `*.tsbuildinfo` alongside `dist/**` — restoring dist without the matching incremental state makes the next tsc no-op-emit ("up to date") and turbo then caches that stale dist under the new input hash, corrupting every downstream typecheck until caches are hand-nuked. Hit while merging master into this branch.

### Notes
- Verified live: auth-url builds the correct Google URL; unauthed personal endpoints return clean 401s; `channel-videos` returned 30 real uploads via API key; UI: all 6 tabs render, Connect shows signed-out, channel-click on a Trending row opened the channel's uploads with working back navigation. **OAuth round-trip needs Nish's Google account** — left for manual testing before merge.
- Signed-out account tabs show "Connect your Google account to see this" — everything public keeps working with just the API key.
---

## [PR #84] chore: CI + tag-triggered releases + in-app download link
**Branch:** `chore/release-ci` → master
**Date:** 2026-07-05

### Context
The repo had zero CI, and the Settings → About update check polls `releases/latest` on a repo that never had a release — it could only ever say "No releases yet". This wires the publishing side and improves the check's payoff.

### Added
- **`.github/workflows/ci.yml`** — every PR/push to master runs `pnpm typecheck` + `lint` + full `turbo build` on ubuntu (pnpm from `packageManager`, Node 22, frozen lockfile).
- **`.github/workflows/release.yml`** — pushing a `v*` tag builds unsigned installers on a 2-OS matrix (macos-14 → arm64 DMG, windows-latest → NSIS EXE) via the existing `pnpm package` script and attaches both to a GitHub Release (`softprops/action-gh-release`, auto release notes). Both matrix jobs target the same tag → one release, two assets.
- **Direct download button** — `UpdateCheckData` gains `assetUrl`/`assetName`; `updates.ts` picks this platform's installer from the release assets (mac: prefer the current arch's `.dmg`; win: the `.exe`). Settings → About shows **Download vX.Y.Z (DMG/EXE)** next to the release-page link when an update exists.

### Notes
- **CI builds bake NO API keys**: `_BUILTIN` values come from the local `.env` at package time, and CI has none. CI-built installers work by entering keys once in Settings → Developer (safeStorage). Locally-built (`pnpm package`) installers keep baking from `.env` as before.
- Builds stay **unsigned** (`CSC_IDENTITY_AUTO_DISCOVERY=false` already in the package script) — macOS Gatekeeper needs right-click → Open on first launch. In-app auto-install (electron-updater) deliberately out of scope until code signing exists.
- Release flow: `git tag v0.2.0 && git push origin v0.2.0` → ~10 min → release with both installers → the in-app check lights up (24h memo per check).

---

## [PR #83] feat: Twitch followed-all + go-live alerts, Spotify ♥ + Recently Played
**Branch:** `feat/twitch-spotify-extras` → master
**Date:** 2026-07-05

### Context
Quick wins on the two already-connected accounts (Batch A of the accounts roadmap): Twitch user OAuth existed but only surfaced live channels; Spotify had playback/playlists but no way to like a track or see history.

### Added
- **Twitch — All tab**: the widget's browse strip is now `Live | All`. New `/api/twitch/followed-all` merges `channels/followed` (full follow list, ≤100) + `users` (profile avatars, batched) + the existing 60s live cache → every followed channel, live first (with game/title), then offline alphabetical. Follow/avatar set cached 5 min (`followsCache`), merged page 60s; both cleared on connect/logout. `/followed` refactored to share `fetchFollowedLive()`.
- **Twitch — go-live notifications**: new headless `TwitchLiveNotifier` (WeatherAlertNotifier pattern) diffs the live set from the same 60s `/followed` query the widget uses (shared query key → deduped) and fires chime + toast + native notification for channels that GO live. Seeds silently on first payload (already-live at launch = ambient, not news); a channel that goes offline re-notifies on its next live. Settings → App → Twitch: **Go-live alerts** toggle (`twitchLiveNotify`, default on; no-op unless connected).
- **Spotify — ♥ on now-playing**: heart in the action row saves/unsaves the current track (`/track-saved` + `/save-track` → `me/tracks`), optimistic toggle, invalidates Liked Songs list + count. Hidden for podcast episodes and when the saved-check 403s (see scope note).
- **Spotify — Recently Played**: synthetic playlist (History icon) pinned after Liked Songs; `/playlist-tracks?playlistId=recently-played` maps `me/player/recently-played` (50 events, deduped by track, newest first). No playable Spotify context exists for history, so its `uri` is `''` — rows play as bare tracks and whole-list Play/Shuffle buttons are hidden (row + header guards).

### Changed
- **Spotify scopes** now include `user-library-modify` + `user-read-recently-played`. ⚠️ **Existing tokens don't gain scopes** — the new endpoints 403 with "Disconnect → Connect to grant the new permission" until you re-consent (once, per machine). Everything pre-existing keeps working on old tokens.

### Notes
- Verified against live data: `/followed-all` → 37 channels (3 live-first, avatars resolved); All tab renders the full list; Settings toggle present (default on); unauthenticated Spotify endpoints return clean 401/400s.
- The notifier polls `/followed` only while the toggle is on AND Twitch is connected; `twitch-auth` status polling (15s, localhost) runs regardless — negligible.
---

---

## [PR #82] fix: packaged-app fixes — missing @dash/shared, circular recharts chunk, radar CSP
**Branch:** `fix/package-missing-shared-module` → master
**Date:** 2026-07-05

### Context
Three prod-only defects surfaced while testing the packaged DMG (dev mode masked all three — no bundling in dev, and the dev renderer is served over `http://localhost` rather than `file://`).

1. **Main process** crashed on launch with `Cannot find module '@dash/shared'` (require stack: `credentials.js` → `server/spawn.js` → `index.js`). `apps/main` is compiled with plain `tsc` (no bundler), so **type-only** imports from `@dash/shared` are erased but **value** imports survive as a runtime `require('@dash/shared')`. PR #63 flipped `credentials.ts` from `import type { CredentialKey }` to `import { CREDENTIAL_KEYS }` — the first value import — but the workspace package was never shipped into the packaged app.
2. **Renderer** white-screened with `Cannot read properties of undefined (reading '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED')` at `recharts-*.js`. The `manualChunks` config split `recharts` and `react`/`react-dom` into separate chunks, producing a `recharts ↔ vendor` **circular chunk** (Rollup warned about it). Under `file://` the circular init order left React uninitialized when recharts' top-level code reached into React internals → the whole app failed to mount.
3. **Weather radar** refused to frame: `Refused to frame 'https://www.rainviewer.com/' because an ancestor violates … frame-ancestors *`. `frame-ancestors` validates the entire ancestor chain; the localhost embed proxy fixes the immediate parent, but the top-level renderer is `file://` and `*` matches only network schemes, so RainViewer blocks the frame.

### Fixed
- **`electron-builder.yml`** — ship the compiled `@dash/shared` into the packaged app under `node_modules/@dash/shared` (its `dist/` + `package.json`, whose `main` points at `dist/index.js`). Node module resolution walks up from `app/dist/*.js` to `app/node_modules/@dash/shared`, so the runtime `require('@dash/shared')` now resolves. Verified: packaged app launches without the main-process error dialog; `CREDENTIAL_KEYS` loads (8 keys).
- **`apps/renderer/vite.config.ts`** — replace the object-form `manualChunks` with a function that keeps **all** of `node_modules` in one `vendor` chunk (only `react-grid-layout`/`react-resizable` split off, which depend on vendor one-directionally). React and recharts now co-locate, so Rollup orders their init topologically. The "Circular chunk" build warning is gone. Verified against a `vite preview` of the built bundle: full dashboard renders (incl. the recharts-backed Stocks widget), importing the vendor chunk — running recharts' exact previously-throwing init line — raises zero errors.
- **`apps/main/src/index.ts`** — extend the existing `onHeadersReceived` CSP strip (already applied to `player.twitch.tv` for the same reason) to also cover `*://www.rainviewer.com/*`, removing the `frame-ancestors` header from the framed radar document so it loads under `file://`. Scoped to the map document host only — RainViewer's tile CDNs are untouched.

### Notes
- The server (`packages/server`) is esbuild-bundled with all deps inlined, so it was never affected by the module/chunk bugs. Only the tsc-compiled main process can leak a bare workspace `require`; `credentials.js` is currently its sole runtime importer of `@dash/shared`.
- Trade-off: `vendor` is now a single ~780 kB (gzip ~225 kB) chunk instead of three. Fine for a desktop app loaded from local disk; the win is a correct init order over marginally smaller parallel chunks.
- The radar CSP strip only runs inside Electron's session, so it can't be exercised by a browser-based preview — it mirrors the proven Twitch fix exactly. Radar already worked in `pnpm dev` (renderer is `http://localhost:5173`).
---

## [PR #81] feat: launcher groups + icons
**Branch:** `feat/launcher-groups-icons` → master
**Date:** 2026-07-05

### Context
Third post-slate batch. Launcher items were a flat lucide-icon grid; now they group into named folders with launch-all, and get real icons — all without ever letting a target (path/URL) or even a hostname cross the IPC bridge.

### Added
- **Groups**: `launcher.json` v2 (`{ version: 2, groups, items }`) with a pure exported `migrateLauncherFile()` — v1 flat arrays wrap one-way on first mutation, dangling group refs drop, garbage → empty. New IPC: `launcher:add-group / rename-group / remove-group / assign-group / launch-group / refresh-icons`. Deleting a group ungroups members (items never deleted); launch-all runs sequentially main-side with a 100ms stagger so apps don't fight over focus.
- **Icons, resolved main-side only**: apps via `app.getFileIcon(…, { size: 'normal' })` (32px; win32 `.lnk` resolves `shell.readShortcutLink().target` for the icon source while launching keeps the `.lnk` for args/cwd); URLs via google s2 favicon fetched with `net.fetch` + **3s AbortSignal timeout** (offline add must not hang the IPC) + content-type/64KB checks, inlined as a data: URI. `toData()` stays the single sanitizer: icon bytes pass, `target` never — a favicon *URL* would leak the hostname. The migration validator rejects any non-`data:` icon on disk. "Icons" refresh button in the edit modal doubles as the backfill for v1-migrated items.
- **Widget**: ungrouped grid first, then per-group sections — header with collapse chevron, member count, hover launch-all. Collapse state persists (`dashboard-launcher-ui`, `partialize` keeps `editing` ephemeral). `<img>` data-URI icons with the lucide Globe/AppWindow fallback.
- **Edit modal**: per-item group `<select>`, group list with double-click rename + delete ("items are kept"), "New group…" input. Flat reorder unchanged — group membership is a property, within-group order = flat order filtered.

### Changed
- `launcher:get-items` now returns `LauncherStateData { groups, items }` (internal version-locked contract; preload/renderer updated in the same commit).
- `Titlebar` temp read hardened to `data?.current?.temp` — with the weather query now shared by the Batch B notifier, a malformed cached payload must not unmount the shell.

### Notes
- `launcher.json` grows ~1–4KB per icon and is main-side — icons/groups don't ride the settings backup (pre-existing limitation, now more visible).
- `app.getFileIcon`, `.lnk` resolution, the native add-app dialog, and the favicon fetch only run in a real Electron main process — on-device items. Verified in-sandbox: 5/5 migration unit tests (electron stubbed), 14/14 renderer smokes (grouped render, collapse persistence across reload, launch/launch-all by id, data-URI icons + fallback, all modal flows).

---

## [PR #80] feat: weather alert push + hourly precip bars
**Branch:** `feat/weather-push-precip` → master
**Date:** 2026-07-05

### Context
Second post-slate batch. NWS severe-weather alerts were fetched and displayed passively in the widget banner; now NEW alerts push through the `fireAlert` path (chime + toast + native notification). Plus the hourly strip gets an always-present precipitation bar per hour.

### Added
- `WeatherAlert.id` (shared type) — NWS `properties.id` kept server-side, with an FNV-1a content-hash fallback (`nws-<hash>`) when NWS omits it, so the renderer's new-alert dedupe always has a stable key. Alerts fetch stays fail-soft.
- `components/WeatherAlertNotifier.tsx` — headless, in App, deliberately separate from `AlertsEvaluator` (seen-set model + settings gate, not user rules). Module-level `seenIds` (cap 300, insertion-order prune) + `seededZips`: a zip's **first payload seeds silently** — pre-existing alerts at launch, or on first visit to a newly cycled zip, are ambient state, not news. Id-less alerts from a warm pre-upgrade cache dedupe via an `event|headline` fallback key. Observes the same weather query as the widget (deduped); `off` forces no polling.
- Setting **Weather → Alert push**: `off / severe-only / all`, default severe-only (Extreme|Severe, matching the widget banner's threshold). No persist version bump needed — new keys shallow-merge.
- Hourly strip: constant-height vertical precip track per hour (`h-6 w-1`, blue fill at `precipChance%`), mirroring the 5-day bar idiom. The conditional `>20%` text is gone (it caused column-height jitter); the exact number moved to the column tooltip.

### Notes
- Server NWS parse verified by review only (api.weather.gov is proxy-blocked in the sandbox); renderer covered by fixtures including the id-less shape. On-device: needs a real active alert (or `all` mode + a minor advisory) to see a live push.
- Verified headless (11/11): silent seed, new-severe fires once with event/headline, seen-id no-refire, minor suppressed in severe-only, id-less fallback fires once then dedupes, 12 tracks with fill heights matching fixture, shell survives malformed payloads.

---

## [PR #79] feat: unified alerts engine
**Branch:** `feat/alerts-engine` → master
**Date:** 2026-07-05

### Context
First of three post-slate batches Nish picked from the widget-improvement brainstorm. User-defined alert rules ("AAPL above $250", "BTC moves ±5% in 24h", "CPU >90% for 5 min") evaluated against the data the widgets already poll, firing through the existing `fireAlert` path (chime + toast + native notification). Renderer-only — no server or IPC changes.

### Added
- `store/alertsStore.ts` — persisted (`dashboard-alerts`, rides the backup/auto-export via the `dashboard-*` prefix) discriminated-union rules: `stock-price` above/below, `crypto-price` above/below, `crypto-change` (|24h| ≥ N%), `cpu-sustained` (>N% for M min); per-rule cooldown (default 30 min). `describeRule()` powers the settings rows, palette titles, and alert titles.
- `lib/alertEval.ts` — pure edge-triggered state machine (in-memory, deliberately not persisted): first evaluable sample **seeds silently** (no launch-time fires), `armed` → fire on false→true (cooldown-suppressed fires are dropped, not queued) → `held` → re-arm when false again. `undefined` conditions (symbol missing, malformed payload) cause **no transition** — missing data is never treated as false, and malformed payloads degrade instead of crashing the shell (guarded `Array.isArray`/`typeof` checks; caught by smoke testing). CPU-sustained uses wall-clock tracking with a 60s **gap rule**: a sampling gap (sleep, hidden, server restart) restarts the run rather than firing spuriously on return.
- `components/AlertsEvaluator.tsx` — headless, mounted in App. Observes the *same* queries the widgets use (identical keys → TanStack dedupes); each observer is enabled only while a rule of its kind exists, so **zero rules of a kind forces zero polling** (verified: 0 `/api/hardware` requests with no CPU rule; ~1/s with one).
- `useAlertGatedInterval()` in `hooks/useGatedInterval.ts` — unlike the widget gate, a hidden window **slows polling ×4 instead of stopping it**: alerts are for when the dashboard is minimized/in the tray, where the native notification is the payoff. Consequence: an enabled CPU rule keeps `/api/hardware` polling at 4s while hidden.
- Settings → **Alerts** tab (third tab): rule list (enable toggle, summary, hover-delete, amber "not in watchlist — won't fire" note for stranded stock rules) + add-rule form (kind select → per-kind fields + cooldown).
- `components/settings/controls.tsx` — `ToggleRow`/`SegmentedRow` extracted from SettingsModal for reuse by panels in other files.
- Palette group **Alerts**: per-rule enable/disable + "Open alert settings" (opens Settings directly on the Alerts tab via new `overlayStore.openSettings(tab)`).

### Changed
- `useStocks`/`useCrypto` accept `(enabled, interval?)`; `useHardware` splits out `useHardwareQuery(enabled, interval?)` (widget wrapper unchanged — history + battery feed intact).
- Stock-rule form auto-adds the ticker to the Stocks watchlist on save — rules only evaluate watchlist symbols, so an off-watchlist rule would silently never fire. Crypto rules select from the crypto watchlist only (free-text CoinGecko ids are a typo trap).

### Notes
- AudioContext gesture policy: the chime may be silent before the first post-launch interaction; the toast + native notification still land.
- Verified headless (Playwright + fake clock): gating on/off, silent seed, exactly-once edge fire, held-no-refire, cooldown suppression, post-cooldown re-fire, CPU sustained + dip-reset, palette toggle, add-rule round-trip (18/18).

---

## [PR #78] feat: command palette (Ctrl/Cmd+K · double-Shift)
**Branch:** `feat/command-palette` → master
**Date:** 2026-07-05

### Context
Feature-slate batch 15 (the finale) — the Spotlight/IntelliJ-style palette Nish asked for. Deliberately last so its actions cover everything the previous 14 batches added. In-app only per scope (no global OS shortcut — that's the tray hotkey's job).

### Added
- `lib/fuzzy.ts` — dependency-free subsequence scorer (consecutive-run + word-start bonuses, light length normalization) so `mkt` ranks *Apply preset: Markets* first.
- `lib/commandRegistry.ts` — `PaletteAction { id, title, group, keywords?, run }` + `registerActionSource()`. Sources are re-evaluated on every palette open, so titles reflect live state (`Hide` vs `Show widget: X`); they call `useXStore.getState()` imperatively and are wired by a side-effect import in `main.tsx` — no import cycles.
- `lib/paletteActions.ts` — built-in sources: apply preset/saved layout, show/hide every widget, all themes + saved custom themes, Spotify transport (play/pause/next/prev via the local API, toast on failure), quick timers (5/10/25 min — added *and started*), Open Settings, low-power mode switch.
- `components/CommandPalette.tsx` — overlay on **Ctrl/Cmd+K** or **double-Shift** (<300 ms; any other key between the two Shifts breaks the chord, so Shift+letter typing never triggers it). Arrows/Enter/Esc, mouse hover tracks selection, section headers, footer hint. **Recents** (MRU, cap 8, localStorage) float on an empty query under a "Recent" header.
- `store/overlayStore.ts` — `settingsOpen` lifted out of Titlebar local state (the palette needs to open Settings) + `paletteOpen`.

### Notes
- Verified headless end-to-end: Ctrl+K opens; `mkt` → *Apply preset: Markets* top hit; Enter applies it (activePreset flips, palette closes); double-Shift reopens with Markets under "Recent"; "open settings" opens the Settings modal. No console/page errors.

---

## [PR #77] feat: QoL — About/update check, synced-folder auto-export, server logs
**Branch:** `feat/qol-updates-logs` → master
**Date:** 2026-07-05

### Context
Feature-slate batch 14 — the remaining QoL trio Nish picked: update check, auto-export to a synced folder, log viewer + restart button.

### Added
- **About + update check** (Settings → App): app version via `app:get-version`; "Check for updates" hits GitHub `releases/latest` main-side (`app:check-updates`) with a 24h memo. No releases yet → friendly "No releases yet / development build" message; keyless 404 on a private repo → hint to add a token. Optional **`GITHUB_TOKEN`** credential (Settings → Developer, fine-grained read-only; deliberately no `_BUILTIN` bake). When an update exists the result is a clickable release-page link.
- **Auto-export**: `buildBackupPayload()` split out of `lib/backup.ts` (manual Export now shares it); new `lib/autoExport.ts` subscribes every persisted zustand store, debounces 2s, and sends the secret-free payload over `backup:write` — the main process **atomically** (tmp+rename, JSON-validated, 5 MB cap) writes `nishboard-settings.json` into the folder chosen via `backup:choose-folder` (a native directory picker; path persisted in main `prefs.json` as `backupDir`). Point it at a Drive-for-Desktop/OneDrive/Dropbox folder and the OS client does the syncing. Settings → Backup gains the Auto-export row (choose/change/disable + current path).
- **Server logs**: `spawn.ts` tees the Fastify child's stdout/stderr to `userData/logs/server.log` (5 MB cap, one rotation to `server.log.1`, spawn markers, best-effort — logging failures never block the server). Settings → Developer gains **Open logs folder** (`logs:open-folder`) and **Restart server** (`server:restart` — resolves when healthy, then emits the existing `server:restarted` push so all queries refetch).

### Notes
- `AppPrefsData` gains `backupDir: string | null`; six new IPC channels, all with typed wrappers.
- Verified headless (mocked bridge): About shows version + "No releases yet" result, folder choose displays the path, a settings change produced the debounced `backup:write` with a valid payload, logs/restart buttons call through, GITHUB_TOKEN row renders in Developer. Log tee + real GitHub check + native folder picker are main-process — on-device pass.

---

## [PR #76] feat: tray icon, close-to-tray, global show/hide hotkey
**Branch:** `feat/tray-lifecycle` → master
**Date:** 2026-07-04

### Context
Feature-slate batch 13 (QoL): keep the ambient dashboard reachable without keeping its window in the way.

### Added
- **Tray icon** (generated 16×16 four-square glyph, macOS template image): Show/Hide, **Spotify Play/Pause** (main-side `fetch` against localhost — works with the window hidden; silent no-op when not authenticated), **Restart server** (pushes `server:restarted` → renderer invalidates all queries), Quit. Single-click toggles the window on Windows/Linux.
- **Main-side prefs** (`userData/prefs.json`, read pre-renderer — that's why it's not localStorage): `closeAction: 'quit' | 'tray'` and `globalHotkey: boolean`, exposed via `prefs:get`/`prefs:set` IPC. Settings → App gains a **System** section (Close button: Quit / Hide to tray; hotkey toggle) that only renders inside Electron.
- **Close-to-tray**: `mainWindow.on('close')` intercepts when the pref says tray and it isn't a real quit; `before-quit` sets the `quitting` flag, unregisters shortcuts, destroys the tray, stops the server. The titlebar X (`app:close`) now closes the window instead of `app.quit()` so it follows the pref.
- **Global hotkey** `Ctrl/Cmd+Shift+D` (off by default; setting-gated): toggles show/hide from anywhere; registration re-syncs on every prefs change and unregisters on quit.

### Notes
- Verified headless (mocked bridge): System section renders, both prefs round-trip through `prefs:set`, and firing `server:restarted` triggered an immediate burst of 16 API refetches. Tray/hotkey/close-intercept are main-process — need an on-device pass (especially: Quit from tray stops the server exactly once).

---

## [PR #75] feat: clipboard history widget (text-only, in-memory, gated poller)
**Branch:** `feat/clipboard-history` → master
**Date:** 2026-07-04

### Context
Feature-slate batch 12. Scope per Nish's call: text only, never persisted.

### Added
- `apps/main/src/clipboardHistory.ts` — 1s `clipboard.readText()` poller that runs **only while the widget is mounted and unpaused** (`clipboard:set-enabled` gates it; unmount/hide stops capture). Dedupes consecutive reads, caps 50 entries and 10k chars/entry, lives purely in module memory — nothing ever touches disk. Copying an entry pre-sets the dedupe marker so our own write isn't re-captured.
- IPC: `clipboard:get-history/copy/clear/set-enabled` + `clipboard:changed` push (sent to the subscribing window), typed `ElectronAPI.clipboardHistory` wrappers with an unsubscribe-returning `onChanged`.
- **Clipboard widget** (`WidgetId 'clipboard'`): live-filter search, click-to-copy rows (relative timestamps, 2-line clamp) with a success toast, header actions for pause/resume (with a "paused" badge) and clear. Browser build shows a placeholder.

### Notes
- Verified headless with a mocked bridge: rows/filter/copy-by-id/toast, pause drives `setEnabled(false)`, clear empties via the push event. The real Electron `clipboard` poller needs an on-device look.

---

## [PR #74] feat: quick launcher widget (apps + links, paths never cross the bridge)
**Branch:** `feat/quick-launcher` → master
**Date:** 2026-07-04

### Context
Feature-slate batch 11: a shortcuts tile for apps and links, designed so the renderer never sees a filesystem path.

### Added
- `apps/main/src/launcher.ts` — items persist in `userData/launcher.json` as `{ id, label, kind, target }`; the renderer only ever receives sanitized `LauncherItemData` (`id`/`label`/`kind`) and launches **by id**. `shell.openPath`/`openExternal` happen main-side; URLs are validated `http(s)` at add time and re-validated at launch (the JSON on disk is user-editable).
- Seven typed IPC channels (`launcher:get-items/add-app/add-url/remove-item/rename-item/reorder/launch`) with `ElectronAPI.launcher` wrappers. `launcher:add-app` opens the native file dialog **in the main process** (platform filters: `.exe/.lnk/.bat/.cmd` on Windows, `.app` from /Applications on macOS).
- **Launcher widget** (`WidgetId 'launcher'`): auto-fill icon grid (app/globe icons + labels), click to launch; pencil header action opens the edit modal — Add app… (native dialog), label+URL adder, double-click rename, hover up/down reorder, remove. Browser (non-Electron) build shows a friendly placeholder.

### Notes
- Verified headless with a mocked `window.electron.launcher` bridge: grid renders, click launches by id, URL add/rename/reorder round-trip. Electron can't run in this sandbox — the native dialog + real `shell.openPath` need one on-device try.

---

## [PR #73] feat: twitch — user OAuth + Following tab (shared user-token store)
**Branch:** `feat/twitch-user-oauth` → master
**Date:** 2026-07-04

### Context
Feature-slate batch 10: followed-live channels need user consent — an authorization-code OAuth flow (the client secret lives server-side; no PKCE needed), plus a shared token store so Spotify and Twitch don't duplicate refresh logic.

### Added
- `packages/server/src/lib/userTokenStore.ts` — file-backed (`~/.dash/<service>_tokens.json`) store with **single-flight refresh** (both services rotate refresh tokens; parallel refreshes race and can persist a dead pair) and **clear-on-dead-refresh** (auth-status flips to disconnected instead of looping errors). Supports service `meta` (Twitch persists `userId`).
- Twitch user OAuth: `GET /auth-url` (state + 10-min expiry), `GET /callback` (code exchange → `/helix/users` once for the user id → store), `GET /auth-status`, `POST /logout`, and `GET /followed` (`/helix/streams/followed`, 60s cache, 401 when not connected — an expected state, not an error).
- `twitch:open-auth` IPC channel (main-process guard: only `https://id.twitch.tv/` URLs open) + typed `openTwitchAuth` wrapper.
- Twitch widget gains a **Following** browse tab (via #72's adapter extension): purple **Connect** button in the tab strip when signed out (with a hint row), live followed channels with game names when signed in, small disconnect button. Auth status polls every 15s (gated) so the widget flips over automatically after the browser OAuth round-trip.

### Changed
- `spotify.ts` refactored onto `UserTokenStore` — behavior identical (same file path, same single-flight + clear semantics, formerly inline).
- `EmbedSearchState` gains optional `hint` (browse body copy when there's nothing to fetch yet).

### Notes
- **Nish action required before this works**: register `http://localhost:7432/api/twitch/callback` as an OAuth redirect URL for the app in the Twitch dev console.
- Verified: auth-url construction (exact params/scope/redirect on a scratch server with test creds), callback rejects bad state (400), `/followed` 401 when unauthenticated, Spotify auth-status/now-playing regression unchanged; widget UI in both auth states via fixtures (Connect + hint signed out; followed rows + disconnect signed in). The full browser OAuth round-trip needs real Twitch creds — on-device test.

---

## [PR #72] feat: youtube — cheap browse tabs (Trending / Music / Gaming)
**Branch:** `feat/youtube-browse` → master
**Date:** 2026-07-04

### Context
Feature-slate batch 9. The YouTube widget's home was an empty hero + search button; each search costs 100 of the 10k/day quota units. Browse gives it a home feed at 1 unit per fetch.

### Added
- `GET /api/youtube/browse?category=trending|music|gaming` — `videos.list` `chart=mostPopular` (regionCode US; categoryId 10 = Music, 20 = Gaming). **1 quota unit per call vs 100 per search**; 45-min server cache per category (worst case ~96 units/day for all three tabs). Never touches the daily search budget.
- `EmbedServiceAdapter.browse?` extension: `{ tabs, useBrowse(tabId, enabled), HomeHeader? }`. `EmbedSearchWidget` renders a browse home (tab strip + the existing `ResultRow`s + a search icon) instead of the hero when the adapter has `browse` and the tile is ≥120px tall; short tiles keep the hero. Tabs fetch lazily — only the selected tab ever hits the API.
- YouTube adapter wires Trending/Music/Gaming. (`HomeHeader` is groundwork for batch 10's Twitch "Connect" button.)

### Notes
- Verified headless with fixture-intercepted `/browse`: trending rows on mount, per-tab lazy fetch (music never requested until clicked), rows play into the embed, search bar reachable from the strip.

---

## [PR #71] feat: crypto widget (CoinGecko watchlist + 7d sparklines)
**Branch:** `feat/crypto-widget` → master
**Date:** 2026-07-04

### Context
Feature-slate batch 8: a crypto price widget in the stocks-widget mold.

### Added
- `GET /api/crypto?ids=` — CoinGecko `/coins/markets` with `sparkline=true`: price, 24h change, and the 7-day line in **one call**. 4-min `TtlCache` under the 5-min renderer poll; ids validated (`[a-z0-9-]`, max 25); watchlist order preserved; 7d hourly sparkline downsampled 168→42 points. 429 is remapped to a friendly "rate limit — resumes in a minute" message.
- `COINGECKO_API_KEY` credential (optional): full plumbing — `CREDENTIAL_KEYS`/`DEFS` (Settings → Developer, with a demo-tier hint), `build.mjs` `_BUILTIN` define, `/api/credentials/builtin` list. Sent as `x-cg-demo-api-key`; keyless works but is throttled (demo tier: 30 req/min, 10k/month).
- **Crypto widget**: 2-col coin cards (icon, name, 24h change, price with sub-dollar precision, 7d sparkline colored by direction), pencil header action → watchlist modal (CoinGecko coin *ids*, e.g. `bitcoin`), refresh action, skeleton/error/empty states. Default watchlist: bitcoin, ethereum, solana, dogecoin.
- Registered as `WidgetId 'crypto'` — `autoFillLayout` slots it in existing custom layouts automatically; presets place it via the bottom-row fallback.

### Notes
- CoinGecko is blocked by the sandbox proxy — UI verified with fixture-intercepted responses (cards, DOGE `$0.0842` precision, ±change colors, watchlist add normalizing "Chainlink Token" → `chainlink-token`); the route's upstream error path returns cleanly. Worth one live on-device look.
- CLAUDE.md widget table gains the Crypto row.

---

## [PR #70] feat: notes — multiple notes with tabs
**Branch:** `feat/notes-tabs` → master
**Date:** 2026-07-04

### Context
Feature-slate batch 7: the single markdown scratchpad becomes a multi-note widget.

### Added
- `notesStore` v1: `{ notes: [{ id, title, content }], activeId }` with zustand persist `migrate` — a v0 `{ text }` scratchpad becomes one "Notes" tab, content intact.
- Tab strip: click to switch, `+` to add, double-click to rename inline (Enter/blur commits, Esc cancels), X on the active tab with a two-step confirm (arms for 2.5s, second click deletes). Deleting the last note resets to a fresh empty one.
- The textarea remounts per note (`key={id}`) so undo history and selection don't leak across tabs.

### Notes
- Verified headless: seeded v0 payload migrates (old text lands in the first tab), add/rename/two-step delete round-trip, localStorage ends at `version: 1`.

---

## [PR #69] feat: stocks — holiday-aware market calendar + open/close countdown
**Branch:** `feat/stocks-calendar` → master
**Date:** 2026-07-04

### Context
Feature-slate batch 6. The session badge was a hardcoded ET-hours heuristic — wrong on market holidays and early closes.

### Added
- `GET /api/stocks/calendar` — Alpaca `/v2/calendar` (**trading** host, not the data host; paper-only keys 401/403 on live, so live→paper fallback with the working host remembered for the process). Day list cached 12h; `isOpen`/`nextOpen`/`nextClose` computed per request. ET↔UTC conversion is DST-safe via `Intl` `longOffset` (no timezone lib).
- Stocks badge is now a countdown: `Market Closed · opens in 2h 14m` / `Market Open · closes in 3h 5m`, ticking on a 30s interval. Early closes and holidays come straight from the calendar.

### Notes
- The Intl heuristic stays as the badge fallback when the calendar query has no data (missing keys / upstream error — the query fails silently) and still drives the pre-market/after-hours dot colors, which the calendar doesn't model.
- Countdown needed its own tick: `useMarketSession`'s 60s setState bails out when the label is unchanged, so it can't drive re-renders.
- Verified headless with fixture-intercepted `/calendar` (both states); ET offset math checked for EDT (July → -04:00) and EST (Jan → -05:00). Real Alpaca calendar needs keys + network — on-device sanity check worthwhile.

---

## [PR #68] feat: hardware — top-processes panel (lazy, CPU/RAM sort)
**Branch:** `feat/hardware-processes` → master
**Date:** 2026-07-04

### Context
Feature-slate batch 5: top processes in the hardware monitor, behind a toggle so the expensive sampling never runs unasked.

### Added
- `GET /api/hardware/processes` — `si.processes()` grouped by process name (summed CPU%/RSS, `×n` instance count, Task-Manager style), returning the union of top-20-by-CPU and top-20-by-RAM so the renderer can flip sort keys without a round-trip. 4.5s `SimpleCache` against the 5s renderer poll.
- Hardware widget: new `ListTree` header action opens a **Top processes** card with a CPU/RAM sort toggle, 12 rows, `name ×count · cpu% · MB/GB`. The panel component mounts only while open — mounting starts the 5s poll (gated by low-power/hidden like everything else), unmounting stops it.

### Notes
- **Windows**: `si.processes()` shells into PowerShell CIM (hundreds of ms — hence cache + lazy-only polling), and CPU% is delta-based so the very first sample shows 0.0% for every process; it fills in from the second poll.
- Verified headless: 0 `/processes` requests while closed (before open and again after close, 6s windows), polling only while the panel is mounted, grouped rows render (`chrome ×7 · 722 MB`), sort toggle flips ordering client-side.

---

## [PR #67] feat: weather+ — AQI, pollen, sun times, radar, multi-location
**Branch:** `feat/weather-plus` → master
**Date:** 2026-07-04

### Context
Feature-slate batch 4: the four weather upgrades Nish picked (AQI + pollen, sunrise/sunset, lazy radar view, multiple locations).

### Added
- **Air quality**: server fetches Open-Meteo's separate air-quality host (`us_aqi` + six pollen types) in parallel with the forecast, fail-soft like alerts — `WeatherData.airQuality?` is simply absent on failure. Widget shows a color-coded `AQI n · label` chip (EPA breakpoints).
- **Pollen**: requested everywhere but CAMS covers Europe only — the row (Tree/Grass/Weed gr/m³, tree = max of alder/birch/olive, weed = max of mugwort/ragweed) renders only when at least one type is non-null, so US locations never show an empty row.
- **Sunrise/sunset**: added to the existing `daily=` param (same API call); today's times render next to "Feels like" with `hourFormat` (24h-aware).
- **Radar**: `GET /api/weather/radar-embed?lat=&lon=` serves a minimal page wrapping RainViewer's animated radar (localhost-served per the standing embed pattern; vendor swappable server-side). Toggled by a new radar header action; the iframe mounts only while open — zero cost until used.
- **Multi-location**: `weatherZips: string[]` + `weatherZipIdx` replace `weatherZip` (zustand persist `version: 1` + `migrate` converts old installs). Settings takes comma-separated ZIPs (committed on blur/Enter); with >1 the widget shows a `‹ City, ST 1/n ›` cycler. Per-ZIP responses stay separately cached on both sides.

### Changed
- `WeatherLocation` gains `lat`/`lon` (renderer needs them for the radar embed URL).

### Notes
- Verified headless with fixture-intercepted `/api/weather` (real forecast hosts are proxy-blocked in the sandbox): cycler flips New York 1/2 ↔ Chicago 2/2, AQI chip + sun times render, radar iframe mounts on toggle. RainViewer content itself needs real network — worth one on-device look.

---

## [PR #66] feat: poll gate — hidden-window pause + low-power mode
**Branch:** `feat/poll-gate-low-power` → master
**Date:** 2026-07-04

### Context
Feature-slate batch 3. The dashboard polls constantly (hardware every 1s, Spotify every 3s, …) even minimized to nothing — wasted CPU/network and needless API traffic on battery.

### Added
- `useGatedInterval(baseMs)` hook — single gate for every `refetchInterval`: returns `false` while the window is hidden (polling pauses entirely), `base × 4` while low-power is engaged, else the base interval.
- `usePowerStore` (non-persisted): `hidden` from a single module-level `visibilitychange` listener; `onBattery` fed by the hardware poll (`battery != null && !charging`).
- **Settings → App → Power → Low-power mode**: Off / On / Auto. Auto engages only on battery and needs the Hardware widget running for battery telemetry.
- `VisibilityKicker` in App — on hidden→visible, refetches active stale queries immediately, so widgets recover the moment the window returns instead of waiting out their (possibly 15-min) interval.

### Changed
- All polling hooks migrated to the gate: hardware 1s→4s in low power, Spotify now-playing 3s→12s, auth-status 5s→20s, devices 8s→32s, sound 5s→20s, stocks 5m→20m, news 10m→40m, weather 15m→60m.

### Notes
- Hardware history is 60 samples — 1 min of sparkline at base rate, 4 min in low power.
- Verified headless against dev servers: hardware polls measured 6/6s (off) → 1/6s (low power via the Settings UI) → 0/6s (hidden) → immediate kick refetch on return. Local UI ticks (world clock, timers) are untouched — pure JS, and Chromium already throttles hidden timers.

---

## [PR #65] feat: settings — temperature/wind units & 24-hour clock
**Branch:** `feat/settings-units-clock` → master
**Date:** 2026-07-04

### Context
Feature-slate batch 2. Everything was hardcoded to °F/mph/12-hour; these are now app settings.

### Added
- **Settings → App → Units & time**: temperature (°F/°C), wind speed (mph/km/h) segmented pickers and a 24-hour clock toggle. All persist in `useAppSettingsStore` (localStorage) with imperial/12h defaults, so existing installs are unaffected.
- `GET /api/weather` accepts `temp=f|c` and `wind=mph|kmh`, forwarded to Open-Meteo (`temperature_unit`/`windspeed_unit`). Unrecognized values fall back to imperial rather than erroring. The server cache key is now `zip:temp:wind` — cached payloads carry unit-specific numbers.
- `hourFormat(clock24h)` helper in `lib/time.ts` — returns `{ hourCycle: 'h23' }` (never `hour12: false`, which can render midnight as "24") or `{ hour12: true }`, spread into `Intl.DateTimeFormat` options at every wall-clock display site.

### Changed
- `useWeather` puts units in the query key (`['weather', zip, tempUnit, windUnit]`) and query string; the widget's °F, mph and "Feels like" labels follow the setting, and the hourly strip shows "15:00"-style labels in 24h mode.
- 24-hour clock honored by: titlebar clock (AM/PM suffix dropped), world-clock digital view, timer/alarm times, countdown target dates, and the stocks intraday chart tooltip.
- `SettingsModal`: extracted a generic `SegmentedRow` (used by the new unit pickers and the pre-existing Density row).

### Notes
- Analog world clocks are inherently 12-hour; only the digital view changes.
- Sandbox verification covered the client side (clock flip to `16:55` live, weather request carrying `?temp=&wind=`); Open-Meteo's actual unit conversion is a passthrough of documented params.

---

## [PR #64] feat: UI system — skeletons, error/empty states, toasts, widget action rows
**Branch:** `feat/ui-system` → master
**Date:** 2026-07-04

### Context
Feature-slate batch 1 — the shared UI vocabulary every subsequent widget batch builds on: consistent loading/error/empty presentation, an in-app toast channel, a standardized per-widget header action row, and calmer grid animation.

### Added
- **Skeleton loaders** — `components/Skeleton.tsx` (`Skeleton` + `WidgetSkeleton`) with a theme-token shimmer; replaces the per-widget "Loading…" text in Weather, Stocks (grid + detail chart), Sound, News, Hardware, and Spotify's connect check.
- **`ErrorState` / `EmptyState`** — unified error presentation with a working **Retry** button (`queryClient.refetchQueries` scoped to the widget's key) and a matching empty-state component. Weather and Stocks surface the server's message (so the first-run "add keys in Settings → Developer" pointer and the weather ZIP hint reach the UI); Tasks/Timer/Alarm/Countdown/World Clock adopt `EmptyState`.
- **Toast system** — `store/toastStore.ts` + `ToastHost` (bottom-right, max 4, auto-dismiss); `lib/alerts.ts` gains `toast()` and `fireAlert` now does chime + in-app toast + native notification.
- **Widget header action row** — `WidgetShell`'s actions slot is now a hover-revealed row (also visible while focused, for keyboard users); new `HeaderAction` + `RefreshAction` primitives. `DashboardGrid`'s registry becomes `{ Component, Actions? }` per widget: Weather/News/Sound get refresh; Stocks gets pencil (watchlist) + refresh via a new non-persisted `stocksUiStore`; Hardware's sparks/bars toggle + section config move up via `hardwareUiStore` (its redundant in-body header removed); Spotify keeps its disconnect button.
- **Stocks route** — missing Alpaca keys now return a 503 with the Settings pointer, and the widget displays the server's message.

### Changed
- **Grid animation** — RGL's stock transitions are suppressed for ~350ms after mount (`.rgl-no-anim`) so tiles no longer fly in from the corner on launch; newly mounted tiles get an opacity fade-in (transform stays RGL's).

### Notes
- Verified in headless Chromium against the dev server: skeletons, ErrorState + Retry, EmptyStates, the hover-revealed action row, and the stocks first-run pointer all render.
- Pre-existing quirk noticed while testing: RGL's north resize handle overlaps a thin strip of the widget header at its horizontal center — harmless, noted for a future pass.

---

## [PR #63] fix: audit batch — hardening, behavior bugs, dedup refactors, perf, docs
**Branch:** `fix/full-app-audit` → master
**Date:** 2026-07-03

### Context
The complete full-app audit: two command-injection holes and an XSS in the server, Electron lifecycle gaps, four renderer behavior bugs, the systematic copy-paste cleanup (server route plumbing, renderer hooks, YouTube/Twitch unification, Titlebar extraction), perf hot paths, server resource usage, UX polish, docs drift — plus the four decision-gated items (resolved by Nish): stocks stays on its 5-min poll (docs/UI made honest), credentials became write-only, Spotify redirect URI standardized on the registered `127.0.0.1` form, and ESLint adopted for real.

### Fixed
- **mac command injection in `POST /api/sound/device`** — `SwitchAudioSource`/`osascript` ran through a shell with only `"` escaped, so a crafted `deviceId` (`$(…)`, backticks) executed arbitrary commands. All mac sound calls now use `execFile` (no shell); the PowerShell runner also invokes via `execFile`.
- **Windows PowerShell injection in `POST /api/sound/sessions/volume`** — `pid` was interpolated into the generated script without validation (TS `number` is compile-time only). Now enforced by a runtime JSON schema + an integer re-check before interpolation; all four sound mutation routes gained body schemas.
- **Spotify token-refresh race** — concurrent requests near expiry each ran their own refresh; Spotify rotates refresh tokens, so last-write-wins could persist a dead token and force a re-auth. `getValidToken()` now single-flights the refresh (all callers await the same promise).
- **Reflected XSS on `/api/spotify/callback`** — the `error` query param and upstream error text were interpolated raw into the returned HTML (same-origin with the whole localhost API). Now HTML-escaped.
- **Second launch killed the running app's server** — no single-instance lock meant instance 2's prod `killStaleOnPort(7432)` SIGKILLed instance 1's server. Added `requestSingleInstanceLock()`; a second launch now focuses the existing window.
- **macOS: reopening the window left every widget dead** — `window-all-closed` stopped the server but `activate` only re-created the window. `stopServer()` moved to `before-quit` (fires on both platforms; Windows/Linux quit path unchanged).
- **Server crash was permanent until app restart** — `spawn.ts` now auto-respawns the Fastify child on unexpected exit with 1s/2s/4s… backoff (max 5 attempts, counter resets after 60s healthy); intentional stops (quit, credential-save restart) don't trigger it.
- **Active preset/layout highlight wiped on launch** — react-grid-layout echoes `onLayoutChange` on mount and after `applyPreset`, and `setLayout` unconditionally cleared the markers. Split into `syncLayout` (geometry only, used by `onLayoutChange`) + `markUserEdited` (called from `onDragStop`/`onResizeStop`), so the highlight survives launch and preset application and clears only on a real gesture.
- **Alarm/countdown chime burst on relaunch** — items that elapsed while the app was closed all fired on the first tick. Both stores now settle stale items (>30s past) silently in `onRehydrateStorage` and show one aggregate notification; items <30s past still fire normally.
- **Calendar stuck on yesterday after midnight** — `today` was computed only at render. A 60s tick now re-renders when the date changes.
- **Alarm DST drift** — "next occurrence" added a flat +24h; now advances by wall-clock day (`setDate`), keeping the entered local time across DST transitions.
- **Countdown accepted past datetimes** (which fired immediately) — now rejected on submit.

### Changed
- **Credential storage whitelisted** — `readCredentials`/`writeCredentials` only accept `CREDENTIAL_KEYS`, so the renderer can no longer persist arbitrary keys that get injected into the spawned server's env (`NODE_OPTIONS`, `PATH`, …).
- **Window hardening** — `setWindowOpenHandler` denies all popups; `will-navigate` blocks navigation away from the app; `spotify:open-auth` only opens `https://accounts.spotify.com/…` URLs.
- **DevTools shortcut** now window-scoped via `before-input-event` (Cmd+Opt+I / Ctrl+Alt+I, still available in packaged builds) instead of a system-wide `globalShortcut` that stole the combo from every app while Nishboard ran.
- **Server shared lib** (`packages/server/src/lib/`) — `HttpError`/`UpstreamError` + a central `setErrorHandler` replace ~30 per-route try/catch→502 blocks; `fetchJson`/`fetchText` add a 10s timeout to every upstream call (a hung API can no longer stall a route); `TtlCache<K,V>` replaces the four ad-hoc `Map` cache idioms; `cred()` centralizes the env-then-`_BUILTIN` fallback. All routes converted; `SpotifyApiError` folded into `UpstreamError` (informative upstream statuses 401/403/404/429 now pass through on every route, not just now-playing). Dead `ws` dependency removed.
- **Renderer API base** — `apiClient` exports `API_BASE` (`http://127.0.0.1:7432` — matches the server's v4-only bind; Windows can resolve `localhost` to `::1`) and everything fetches through it (`useYoutube`/`useTwitch` raw-fetch copies and the SettingsModal hardcoded URL removed). Embed iframes intentionally stay on `localhost` via `embedUrl()` — Twitch's `parent=` param rejects bare IPs. CORS adds the `'null'` origin defensively.
- **Shared renderer hooks** — `useElementSize` (callback-ref + retry-RAF + ResizeObserver, was copy-pasted 4×), `useDeferredSlider` (drag-safe polled sliders, 3×), `useDragScroll` (2×), and `lib/time` (six scattered formatters, two byte-identical). Spotify's ProgressBar keeps `onTick` in a ref so its 1s interval survives poll re-renders (stutter fix).
- **YouTube/Twitch unified** — both widgets were ~90% identical; a generic `widgets/embed/EmbedSearchWidget` owns the state machine/search/iframe-kept-mounted logic and each service is now a small adapter. Search-error copy now points at Settings → Developer instead of `.env` (which doesn't exist in packaged builds).
- **Titlebar extracted** — the 1053-line component split into `components/menus/` (ThemeMenu, LayoutsMenu, WidgetsMenu, PinnedLayouts + shared primitives: `WidgetPinList`, `SaveAsForm`, `SavedItemRow`, `ConfirmDeleteDialog`); the duplicated delete modals and editor footers are now single implementations. Titlebar itself is ~120 lines. No behavior change.

### Added
- **Minimize button** in the titlebar (the IPC existed unused); **`credentials:encryption-available` IPC** — Settings shows an explicit "stored unencrypted" warning when safeStorage has no OS keychain instead of falsely claiming keychain encryption.
- **YouTube server-side quota budget** — 90 searches/day (429 with a clear message past that) + a 10-min server response cache; a stuck client can no longer burn the ~100/day quota.

### Perf
- **ThemeManager null-component** — theme/scale changes (incl. live color-picker drags) no longer re-render the whole widget tree; `data-theme` + custom vars move to `<html>`.
- **WorldClock** 1s tick isolated to the clock list; **Hardware** cards memoized + history snapshots copy-on-write (fixes the stale-array-identity trap); config/view toggles stop redrawing all six Recharts charts.
- **Server hardware route** — fsSize cached 60s, battery 30s, graphics 10s on macOS only (Windows keeps 1s for live nvidia-smi GPU util).
- **Bundle** — vite `manualChunks` splits recharts/react-grid-layout/vendor (app chunk 973kB → 288kB); sourcemaps `'hidden'` (no 4MB map referenced from the packaged bundle). Root `engines: node >=20`.
- Deliberately skipped: blanket narrow-Zustand-selector conversion — the flagged widgets consume every field of their small stores; per-field selectors would be churn with no re-render benefit.

### Decisions (final batch)
- **Stocks cadence** — kept at 5-min (deliberate; minimal Alpaca usage). CLAUDE.md/SPEC interval tables corrected from the stale "5s"; the market-session dot no longer pulses (it marks the session, not a live feed) and tooltips the refresh rate. Missing Alpaca keys now yield a 503 pointing at Settings → Developer instead of a raw upstream 403.
- **Credentials are write-only** — `credentials:get-all` removed; `credentials:get-status` returns booleans and the status check never decrypts. Settings shows stored keys masked with Replace (inline, cancelable) / Clear (undo-able before save); `writeCredentials` merges (`''` clears, absent keeps) so stored values never round-trip through the renderer. Trade-off: keys can't be viewed in the app anymore.
- **Spotify redirect URI = `http://127.0.0.1:7432/api/spotify/callback`** everywhere (code default was `localhost` — mismatched the URI registered in the Spotify dashboard; exact-match). Verify the Connect flow once on-device.
- **ESLint adopted** — root flat config (typescript-eslint recommended + react-hooks in the renderer; the React-Compiler-era rules are off with in-config rationale), per-package `lint` scripts make `turbo lint` real, and the codebase lints clean. First pass caught dead code in `colorUtils` and a component-defined-during-render in `SpotifySearchDialog` (hoisted).

### Notes
- `winSwitchDevice`'s `''`-escaping was audited and is safe (single-quoted inside a `-File` script, never through cmd.exe) — now documented in-code.
- Settings polish: credential save now shows "Restarting server…" and invalidates all queries once the server is back (widgets used to sit in error until their next poll); import errors are inline (no `window.alert`); backup import validates `app`/`version` and only restores known/`dashboard-*` keys.
- `window.electron` is now typed optional (it is, outside Electron); hardware config toggles are real keyboard-focusable checkboxes; sound master slider stays usable while muted; news dot indicator replaced by an n/total counter past 8 items; `index.html` title → Nishboard.
- Docs: PROJECT_INSTRUCTIONS.md replaced with a pointer to CLAUDE.md (all four of its architecture claims had drifted); SPEC.md fixed (Spotify tokens are plain JSON at `~/.dash/`, IPC table completed, env list completed); README rename leftovers.
- Verify on Windows: single-instance focus behavior and the sound mixer after the `execFile` switch. Verify on macOS: window close → Dock reopen keeps widgets alive.

---

## [PR #61] feat: responsive titlebar + compact-mode toggle
**Branch:** `feat/titlebar-responsive` → `master`
**Date:** 2026-07-03

### Context
#59 made the compact (icon-only + pinned-layouts dropdown) titlebar the *only* mode, so it applied even full-screen. It should compact only when the window is narrow (so the left content stops crowding the centered clock), with an opt-in to force it always.

### Added
- **Compact-titlebar setting** — `settingsStore.compactTitlebar` (persisted, default off) + a **Compact titlebar** toggle in Settings → App → Top bar. On = always compact regardless of width.

### Changed
- **Titlebar is now responsive** — below `COMPACT_BREAKPOINT` (900px, via a `useIsNarrow` window-resize hook) **or** when the setting is on, it compacts: right-side menus become icon-only squares and the left pinned presets collapse into the `PinnedLayoutsMenu` dropdown. At/above the breakpoint with the setting off, it shows the full labeled menus + inline pinned-preset buttons (`InlinePinnedPresets`, restored from pre-#59). `menuBtn` gains a `compact` flag; the three menu components + Settings button take a `compact` prop.

## [PR #60] docs: sync widget catalog in README / CLAUDE.md / SPEC
**Branch:** `docs/sync-widget-catalog` → `master`
**Date:** 2026-07-03

### Context
The batch work (Notes/Tasks/World Clock, Timer/Alarm/Countdown, News, weather alerts, stocks detail) had landed in code + CHANGELOG, but the feature/widget catalogs in the docs still listed only the original eight widgets.

### Changed
- **README** — Features table adds News, Notes, Tasks, World Clock, Timer & Alarm, Countdown; Weather now notes severe-weather alerts and Stocks the click-through detail chart + headlines. Project-structure `widgets/` list updated.
- **CLAUDE.md** — Widgets & APIs table adds the six new widgets and updates the Weather (NWS alerts) and Stocks (detail + Benzinga news) rows.
- **SPEC.md** — "Out of Scope" corrected: shipped phase-2 items (notifications/alerts, news) moved out; Google Calendar integration + a generic widget-config UI flagged as still-unbuilt; added a note that SPEC's per-widget sections need a fuller behavior refresh (CLAUDE.md table + CHANGELOG are the current source of truth).

---

## [PR #59] feat: compact titlebar — icon-only menus + pinned-layouts dropdown
**Branch:** `feat/titlebar-compact` → `master`
**Date:** 2026-07-03

### Context
On narrower windows the titlebar overflowed: the inline pinned-layout buttons on the left collided with the centered clock, and the labeled menu buttons on the right ate too much room. This compacts both sides.

### Changed
- **Right side is now icon-only** — `Titlebar.tsx`: the Themes / Widgets / Layouts / Settings buttons drop their text labels and become uniform 24px square icon buttons, right-aligned in the corner (labels moved to `title` tooltips). The Themes button keeps the active-theme color as a small corner-swatch badge. `menuBtn` restyled to a centered square accordingly.
- **Left pinned layouts collapsed into a dropdown** — the inline per-preset buttons are replaced by a single `PinnedLayoutsMenu`: a compact trigger showing the active pinned preset (or "Layouts" once the layout's been modified) that opens a menu of the pinned presets; selecting one calls `applyPreset`. Rendered only when at least one preset is pinned.

### Notes
- Pinning/unpinning still lives in the right-side Layouts menu; the new left menu is just a quick-switcher for already-pinned presets.

---

## [PR #58] chore: package.json name → nishboard + Windows memory path
**Branch:** `chore/nishboard-name` → `master`
**Date:** 2026-07-03

### Context
Salvages the two still-relevant bits from the abandoned #45 (the rest was superseded by #47's docs rewrite): the project is branded **Nishboard** everywhere — README, app title, installer — *except* the root `package.json`, and CLAUDE.md's Memory Protocol only documented the macOS auto-memory path even though Nish develops on both machines.

### Changed
- Root **`package.json`** `name`: `desktop-dashboard` → `nishboard` (the package `name` field only — no deps or scripts touched).
- **CLAUDE.md → Memory Protocol** now lists the local auto-memory directory for **both** machines (macOS + Windows), noting the dir is derived from the checkout path so it differs per machine.

---

## [PR #57] feat: stocks ticker detail — intraday chart + recent news
**Branch:** `feat/stocks-detail` → `master`
**Date:** 2026-06-30

### Context
Batch 3, part 3 — click a stock to drill into an intraday chart + recent headlines. Uses the **existing Alpaca keys** (the News API is included with them); no new API.

### Added
- **Detail route** — `packages/server/src/routes/stocks.ts`: `GET /api/stocks/detail?symbol=` returns chart bars + recent news (Alpaca News API `/v1beta1/news`, Benzinga), 2-min cache. Bars come from a `start`-windowed Alpaca `/stocks/bars` query (`sort=desc` → reversed to chronological) so the **most recent session renders even when the market is closed**; if intraday is empty it falls back to ~2 months of **daily** closes. `StockBar` / `StockNewsItem` / `StockDetail` (with a `range: 'intraday' | 'daily'` discriminator) shared types + `useStockDetail(symbol)` hook.
- **Detail panel** — `StocksWidget.tsx`: clicking a quote card opens an in-widget panel with a Recharts area chart (emerald/red by direction, hover tooltip, date-vs-time axis by range) + a small range label (`Intraday` / `Daily · ~2mo`) + a list of recent headlines (click → browser); a back arrow returns to the grid.
- **`openExternal` IPC** — `app:open-external` → `shell.openExternal` (http(s) only), exposed as `window.electron.openExternal`. (Shared with the News widget; identical addition.)

### Fixed
- **"No intraday data" on a closed market** — the original detail query had no `start`, so the Alpaca IEX feed returned nothing once the market had been closed a while. Now a 5-day `start` window (last ~100 5-min bars) reliably shows the last session, with a daily-close fallback for long-closed / illiquid symbols; the empty state only fires when *both* are empty.

---

## [PR #56] feat: weather severe-weather alerts (NWS)
**Branch:** `feat/weather-alerts` → `master`
**Date:** 2026-06-30

### Context
Batch 3, part 2 — surface active US severe-weather alerts in the Weather widget. Keyless (NWS api.weather.gov); the previous Open-Meteo forecast has no alerts.

### Added
- **NWS alerts** — `packages/server/src/routes/weather.ts`: `fetchAlerts(lat, lon)` queries `api.weather.gov/alerts/active?point=…` (keyless, US-only, requires a descriptive User-Agent), fetched in parallel with the forecast; returns `[]` on any failure / non-US. `WeatherData.alerts: WeatherAlert[]` (`event`, `severity`, `headline`) added in `packages/shared`.
- **Alert banner** — `WeatherWidget.tsx`: when alerts exist, a banner above the current conditions shows the top alert's `event` + "+N more" (full headlines on hover), colored **red** for Extreme/Severe and **amber** otherwise.

### Fixed
- **Weather 502 on geolocation failure** — the route had a single catch-all that returned a bare **502** whenever anything failed, including ip-api being unable to locate the user (reserved/private IP, downtime). Now failures are split: auto-geolocation failure with no ZIP set returns **422** with an actionable message — *"Couldn't detect your location automatically. Add a ZIP code in Settings → App."* (the ZIP path uses zippopotam.us over HTTPS, a different provider that **bypasses ip-api**); an unknown ZIP returns its own 422; only a genuine forecast-provider failure returns 502 (*"Weather service is unavailable, try again shortly."*). `getGeoFromIp` now also checks ip-api's `status` field and **serves the last-known location on a transient blip** instead of erroring. `WeatherWidget` renders the server's message (via the query `error`) rather than a generic "Failed to load weather".
- Repaired the CHANGELOG: the `## [PR #53]` header + a separator had been dropped by an earlier merge reorder, leaving a malformed entry + orphan `---`.

### Notes
- `WeatherWidget` defaults `alerts` to `[]` defensively, so a cached pre-update response can't crash the widget.

---

## [PR #55] feat: News widget (Google News RSS) + open-external IPC
**Branch:** `feat/news-widget` → `master`
**Date:** 2026-06-30

### Context
Batch 3 (info & markets), part 1 — a keyless news-headline widget. No API key or developer app needed; the server reads Google News RSS directly.

### Added
- **News route** — `packages/server/src/routes/news.ts`: `GET /api/news?topic=` fetches Google News RSS (keyless), parses items with a small regex (title with the trailing source stripped, link, source, `pubDate` → ISO), 10-minute cache keyed by topic. Registered at `/api/news`.
- **`NewsItem` / `NewsData`** types (`packages/shared`).
- **News widget** — `widgets/news/NewsWidget.tsx` + `useNews`: a rotating-headline ticker (auto-advances every 6s, pauses on hover, prev/next + dots); shows source + relative time; clicking opens the article in the default browser.
- **`openExternal` IPC** — new `app:open-external` channel → `shell.openExternal` (http(s) only), exposed as `window.electron.openExternal`. Reusable for any external link.
- Wired via the add-widget pattern (`lib/layouts.ts` + `DashboardGrid.tsx`).

### Notes
- Google News `<link>` values are Google redirect URLs that resolve to the article on click — expected, and keyless.

---

## [PR #54] feat: Timer, Alarm & Countdown widgets + notification IPC
**Branch:** `feat/time-tools` → `master`
**Date:** 2026-06-30

### Context
Batch 2 of the roadmap — time tools. Adds the app's first native desktop-notification capability plus an asset-free chime, then two widgets that use them.

### Added
- **Notification IPC** — new `app:notify` channel: `preload.notify(title, body)` → `apps/main/src/ipc/index.ts` shows a native `Notification` (with the OS sound). `apps/renderer/src/lib/alerts.ts` adds `playAlarm()` (a Web Audio three-beep chime, no audio asset) and `fireAlert()` that does toast + chime.
- **Timer / Alarm widget** — `widgets/timer/TimerWidget.tsx` + `store/timersStore.ts` (persist `dashboard-timers`). Tabs: **Timer** (multiple countdowns; start/pause/reset; fires at zero; survives reload via an absolute `endsAt` timestamp) and **Alarm** (multiple; set a time — defaults to today / next occurrence — fires at that time).
- **Countdown widget** — `widgets/countdown/CountdownWidget.tsx` + `store/countdownStore.ts` (persist `dashboard-countdown`): add events with a datetime, shows time remaining, fires a notification + chime when reached while the app is open.
- Both widgets wired via the add-widget pattern (`lib/layouts.ts` + `DashboardGrid.tsx`).

### Fixed
- `autoFillLayout` / `generateLayout` no longer place auto-appended widgets narrower than their `minW` (which made react-grid-layout warn `minWidth larger than item width`). New `appendWidgets()` helper gives each appended widget at least its `minW` and wraps to a new row when a row fills — surfaced once the widget count crossed 12.

### Notes
- Alerts fire only while the app is running; the native toast plays the OS notification sound, backed by an in-app Web Audio chime.

---

## [PR #53] feat: settings export/import + UI scale & density
**Branch:** `feat/settings-export-scale` → `master`
**Date:** 2026-06-29

### Context
Batch 1B — dual-machine portability (export/import all non-secret settings) plus display preferences (UI scale + grid density), all under Settings → App.

### Added
- **Settings export/import** — `apps/renderer/src/lib/backup.ts`: serializes all non-secret prefs (layout, theme, app settings, watchlist, hardware config, any `dashboard-*` widget store) into one JSON; import writes them back and reloads. **Secrets excluded** — API keys live in the main process via safeStorage, never in localStorage. Buttons in Settings → App → Backup.
- **UI scale** — `settingsStore.uiScale` (persisted); a stepper (80–140%) in Settings → App → Display, applied via Electron `webFrame.setZoomFactor` (`ElectronAPI.setZoom` in `preload.ts`/`ipc.ts`, called from `App.tsx`) so everything scales correctly including the grid. No-op outside Electron.
- **Density** — `settingsStore.density` (`comfortable` | `compact`); a toggle in Settings → App → Display; `DashboardGrid` uses it for the grid margin/padding (8px ↔ 4px).

### Changed
- `SettingsModal.tsx` — the App tab gains **Display** (UI scale + density) and **Backup** (export/import) sections; added a defensive guard so a missing `window.electron` can't crash the modal.

### Notes
- The zoom effect is Electron-only; in a plain browser the `setZoom` call still fires but does nothing.

---

## [PR #52] feat: Notes, Tasks, and World Clock widgets
**Branch:** `feat/widgets-notes-tasks-clock` → `master`
**Date:** 2026-06-29

### Context
First batch of the feature roadmap (Batch 1A) — three self-contained widgets, no server/API, with state persisted to localStorage. Adding a widget is cheap (the grid auto-places new widgets and the Widgets menu auto-lists them), so this is mostly widget UI + per-widget stores.

### Added
- **Tasks widget** — `widgets/tasks/TasksWidget.tsx` + `store/tasksStore.ts` (persist `dashboard-tasks`): add (Enter or +), checkbox toggle with strikethrough, per-row delete, "Clear completed", remaining count.
- **World Clock widget** — `widgets/worldclock/WorldClockWidget.tsx` + `store/worldClockStore.ts` (persist `dashboard-worldclock`): digital ↔ analog (SVG) toggle, add/remove timezones from a curated list, live per-second tick, defaults to the local zone.
- **Notes widget** — `widgets/notes/NotesWidget.tsx` + `store/notesStore.ts` (persist `dashboard-notes`): textarea ↔ rendered-markdown toggle via `react-markdown` (lists, headings, bold, code, links). Added `.md-render` styles in `index.css` (Tailwind preflight strips list styling).
- Wired via the add-widget pattern: `lib/layouts.ts` (`WidgetId`, `ALL_WIDGET_IDS`, `WIDGET_TITLES`, `WIDGET_CONSTRAINTS` at `minW:3, minH:2`) + `DashboardGrid.tsx` (`WIDGET_COMPONENTS`). Fresh layouts show them automatically; existing layouts toggle them on from the Widgets menu.

### Notes
- New renderer dependency: `react-markdown`.

---

## [PR #51] feat: Windows UX parity — rounded corners + mac-style scrollbars
**Branch:** `fix/windows-ux` → `master`
**Date:** 2026-06-29

### Context
On Windows the frameless window showed square corners around the rounded content, and scrollbars were the chunky stock grey-with-arrows bars — both jarring next to macOS's rounded window + thin scrollbars. macOS handles both natively; these changes bring Windows to parity **without touching macOS**.

### Added
- **Platform exposed to the renderer** — `apps/main/src/preload.ts` exposes `process.platform`; `ElectronAPI.platform` added in `packages/shared/src/types/ipc.ts`; `App.tsx` tags `<html data-platform="…">` so CSS can target the OS. Falls back to `web` outside Electron.

### Changed
- **Mac-style scrollbars (Windows only)** — `apps/renderer/src/index.css`: under `[data-platform="win32"]`, `::-webkit-scrollbar` becomes thin (8px) with a rounded, theme-colored thumb and no arrow buttons. macOS keeps its native overlay scrollbars; the existing `.scrollbar-none` hidden areas are unaffected.
- **Rounded window corners (Windows only)** — `apps/main/src/index.ts` creates the BrowserWindow `transparent` on Windows; `index.css` rounds the `.app-shell` (`border-radius: 10px; overflow: hidden`) and makes `body`/`#root` transparent so the desktop shows through the corners, matching macOS's native rounded frameless window. macOS stays opaque (it rounds natively).

### Notes / verify on Windows
- Mac-untestable by nature. Verified on macOS via the `data-platform="win32"` CSS path: `.app-shell` `border-radius: 10px` + `overflow: hidden`, transparent `body`/`#root`, 8px scrollbar; default platform is `web`/`darwin`, so macOS is untouched.
- Transparent frameless windows on Windows lose the native drop shadow and edge-resize near the rounded corners may need tuning; maximized-state rounding isn't special-cased — flagged for on-device iteration.

---

## [PR #50] fix: every widget can shrink to a minimal vertical size
**Branch:** `fix/widget-sizing` → `master`
**Date:** 2026-06-29

### Context
Several widgets couldn't be resized below a tall floor (Spotify/Stocks ≥ 5 rows, YouTube/Twitch ≥ 6), so they hogged vertical space. Every widget should shrink vertically as far as is practical.

### Changed
- `apps/renderer/src/lib/layouts.ts` — `WIDGET_CONSTRAINTS` `minH` lowered to **2** for every widget (≈ a header + sliver); `minW` unchanged (horizontal sizing was fine). The 8 static presets' `minH` props lowered to 2 to match, and `autoFillLayout` now derives appended widgets' mins from `WIDGET_CONSTRAINTS` instead of a hardcoded `minH: 3`.
- Added `applyConstraints(layout)` — clamps each item's `minW`/`minH` to the authoritative `WIDGET_CONSTRAINTS`.
- `apps/renderer/src/store/layoutStore.ts` — `onRehydrateStorage` now runs `applyConstraints` over the persisted active layout **and** every saved custom layout, so existing users' stored layouts adopt the new, smaller floors instead of staying stuck at the old ones.

### Known / TODO
- **Windows resize jank (off-by-pixels)** is *not* addressed here. `DashboardGrid` already uses react-grid-layout's `WidthProvider` (measured width), so it isn't a width-measurement bug — the offset is almost certainly fractional display scaling (`devicePixelRatio` ≠ 1) and can't be reproduced on macOS. Needs on-device diagnosis on the Windows machine.
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
