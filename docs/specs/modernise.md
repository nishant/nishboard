# Nishboard modernisation (audit item 21 + nishboard parts of 13, 18, 19)

Status: in progress · Slug: modernise · Date: 2026-10-31 · Size: large
Repos: nishboard (spec lives here), checkout `C:\Code\nishboard-modern`, branch `feat/modernise` from `origin/master`
ROADMAP: `ROADMAP.md` → "Modernise Nishboard"

## Goal
Bring Nishboard up to a supported Electron with real auto-update, make it usable in narrow windows, close the
remaining local hardening gaps, and cut bundle and CPU cost. Outcomes:

1. Electron 45 (`45.2.1`), electron-builder 26, all existing features (Discord `<webview>`, Twitch/RainViewer CSP strip, embeds, origins) still work in the packaged app.
2. Dependabot opens PRs for Electron majors.
3. Windows builds auto-update through electron-updater (GitHub provider); macOS keeps a semver-correct check plus a DMG link.
4. Releases are created as drafts, the installers built and attached, `SHA256SUMS` added, then published. The release gate runs typecheck, lint, test and build.
5. The dashboard grid stacks into one column below 600px and uses 2–3 columns up to 1200px, without touching the saved desktop layout.
6. The main window remembers its bounds; every window (main and popouts) is kept on a connected display.
7. OAuth tokens in `~/.dash` are encrypted at rest (key protected by Electron `safeStorage`) and written with mode 0600.
8. The packaged renderer has a Content-Security-Policy; no `*.map` file ships in the installer.
9. The hand-built CommandPalette, InboxWidget and recharts chart are replaced by `@nish/ui` `CommandPalette`, `Inbox` and `LineChart`; `recharts` and `react-is` are removed.
10. Widgets are lazy-loaded (one chunk per widget).
11. The sound widget talks to one long-lived PowerShell process; the network widget polls every 5s.
12. A second launch never touches the first instance's server; the update check compares semver.

## Out of scope
- The server's auth, bearer token, CORS and Host checks (`packages/server/src/app.ts`, CORS bits of `routes/claude.ts`, the token plumbing in preload/spawn, renderer `lib/apiClient.ts`). Another session (sec-fixes) owns them. Do not edit `app.ts`, `routes/claude.ts` or `lib/apiClient.ts`.
- Code signing / notarisation (needs paid certificates).
- macOS auto-install (Squirrel.Mac refuses unsigned apps).
- Moving palette extras upstream into `@nish/ui` (another session is changing ui right now; not trivial).
- Changing CI Node versions beyond what the build needs; adopting other new `@nish/ui` 1.0 components.
- dash.nish.software (audit question 3, undecided).

## Decisions
- **Electron 45.2.1** (latest stable, supported). `electronVersion` pin in `electron-builder.yml` follows it. electron-builder `^26.18.1`, electron-updater `^6.8.11`.
- **apps/main is bundled with esbuild** (like the server), not shipped as tsc output: electron-updater has runtime dependencies and the packaged app has no `node_modules`. Two bundles: `dist/index.js` (entry `src/index.ts`) and `dist/preload.js` (entry `src/preload.ts`), `platform: node`, `format: cjs`, `external: ['electron']`. `@dash/shared` is then bundled, so `electron-builder.yml` stops copying it into `node_modules`. `tsc --noEmit` stays as the typecheck.
- **Windows: full auto-update** (check 30s after launch and every 6h, download in the background, install on quit or on "Restart to update"). **macOS: check only** (GitHub API, semver compare) with the DMG download link, because the builds are unsigned. Dev builds (`!app.isPackaged`): updater off.
- **NSIS artifact name without spaces** (`${productName}-Setup-${version}.${ext}`, i.e. `Nishboard-Setup-1.2.3.exe`): GitHub turns spaces into dots on upload, which would break `latest.yml`.
- **Release uploads use `gh release upload`**, not softprops, because softprops cannot find a draft release by tag and would create a second release.
- **Token encryption:** main keeps a random 32-byte key, encrypted with `safeStorage`, at `~/.dash/.token-key` (next to the tokens, so both survive a reinstall together). Main passes it to the server as env `DASH_TOKEN_KEY` (base64). The server encrypts token files with AES-256-GCM and deletes the env var after reading it so child processes (claude CLI, PowerShell) never inherit it. No key (dev via `pnpm dev`, safeStorage unavailable): plaintext with mode 0600, as today. An encrypted file without a key reads as "not connected" and is left on disk untouched.
- **Narrow layouts are derived, never saved:** below 1200px of grid width the grid renders a computed layout (fixed row height, drag and resize off, page scrolls). The saved desktop layout is never written in narrow mode. Breakpoints by grid container width: `< 600` → 1 column, `600–899` → 2 columns, `900–1199` → 3 columns, `≥ 1200` → today's 24-column grid. (default; the brief said "~600 / 2–3 columns at ~840").
- **Command palette:** use `@nish/ui` `CommandPalette` in function mode (`items={(q) => …}`); nishboard keeps its registry, ranking, recents, fixed group order, Ctrl/Cmd+K toggle and double-Shift locally. "Fill" rows (which typed a prefix and kept the palette open) become plain rows that show the syntax as a hint, because the ui palette's query is not controllable (accepted small loss).
- **Inbox:** use `@nish/ui` `Inbox`. Local Ack is kept as a synthetic per-item action (`__ack` / `__unack`) handled locally in `onAction`; severity order is applied before passing items; links open through `window.electron.openExternal` by intercepting anchor clicks inside the widget (Electron denies `target=_blank` windows).
- **Network widget**: 5000 ms poll, 60-sample history (5 minutes). Not persisted, so no migration.
- **Sound:** one PowerShell process per server, started on first use, stopped after 60s idle, restarted on crash or timeout. macOS path unchanged.
- **Dependabot:** a second npm entry for `/apps/main` that allows only `electron` with no major ignore; the root entry keeps ignoring majors for everything else.

## Current state
(From research; paths relative to the checkout.)
- `apps/main/src/index.ts`: `requestSingleInstanceLock()` at :40-50 only calls `app.quit()` when the lock fails, but `app.whenReady().then(...)` at :121 is registered regardless, so a second instance can reach `spawnServer()` → `killStaleOnPort(7432)` and kill the first instance's server. Main window is fixed 1920×1080, no min size, nothing saved (:60-77).
- `apps/main/src/popout.ts`: popout bounds in `userData/popouts.json` as `Partial<Record<widgetId,{x,y,width,height}>>`, read on open (:89), saved on `close` (:132). No `screen` use anywhere in main → windows can reopen off-screen.
- `apps/main/src/prefs.ts` / `windowTheme.ts`: the userData JSON pattern (cached module value, validate field by field, defaults on any error, exported pure validator for tests).
- `apps/main/src/server/spawn.ts`: spawns `process.execPath server/index.js` with `ELECTRON_RUN_AS_NODE=1`, env `{...process.env, NODE_ENV, SERVER_PORT, ...readCredentials()}`; waits on `GET /health`; `killStaleOnPort` (:72-85) matches `findstr :7432` (also hits `:74320`) — production only. In `pnpm dev` the server is started by `concurrently` and gets no env from main.
- `apps/main/src/updates.ts:75`: `hasUpdate = latestVersion !== normalize(currentVersion)` (inequality, not semver). Memo 24h. UI is `AboutSection` in `apps/renderer/src/components/SettingsModal.tsx:129-189`. IPC `app:check-updates` in `ipc/index.ts:121`, preload `:43-47`, type `UpdateCheckData` in `packages/shared/src/types/ipc.ts:75-89`.
- `packages/server/src/lib/userTokenStore.ts`: the single choke point for OAuth tokens (`spotify_tokens.json`, `twitch_tokens.json`, `youtube_tokens.json`, `google_calendar_tokens.json`, `discord_rpc_tokens.json`). `load()` :72-78 and `save()` :80-83 are plain JSON with default file mode. Stores are built at module scope (route modules), so the key must be read at module load.
- `packages/server/src/routes/sound.ts`: `psRun` writes a temp `.ps1` and spawns `powershell.exe` per call; every poll spawns 2–3 processes and `Add-Type`-compiles the WASAPI C# each time. Routes: `GET /` (5s cache, no in-flight dedupe), `POST /volume`, `/mute`, `/device`, `/sessions/volume`.
- Renderer grid: `components/DashboardGrid.tsx` uses `WidthProvider(ReactGridLayout)`, `cols={24}`, `useRowHeight` fits all rows to the window height (`:101-118`), shell is `overflow-hidden` (`App.tsx:144`). Write-backs: `onLayoutChange → syncLayout` (fires on mount too), `onDragStop/onResizeStop → markUserEdited`, `onToggleCollapse → setWidgetCollapsed`, and the collapse-height effect (`:165-179`). `WIDGET_REGISTRY` (`:46-70`) maps 21 ids to `{Component, Actions?}` with static imports; `PopoutShell.tsx:5` imports the registry from `DashboardGrid` (so popouts load RGL too).
- `components/CommandPalette.tsx` + `lib/commandRegistry.ts` + `lib/fuzzy.ts` + `lib/paletteActions.ts`: actions rebuilt from live state on open, async refreshers, fixed group order, 8 recents in localStorage `dashboard-palette-recents`, 40-row cap, parameterised commands ("timer 25m tea") with preview row, `fill` rows, double-Shift (300ms) and Ctrl/Cmd+K toggle; open state in `overlayStore.paletteOpen`.
- `widgets/inbox/InboxWidget.tsx` (368 lines) + `inboxSort.ts` + `store/inboxUiStore.ts` (local Ack, lapses when count grows) + `useInbox.ts` (data hooks, keep). Types hand-copied in `packages/shared/src/types/inbox.ts`, shape-identical to `@nish/ui` `InboxItem`/`InboxListResponse`; nishboard wraps them in `InboxFeedData = ok | offline | no-password | bad-password`.
- recharts is used only by `widgets/stocks/StocksWidget.tsx:4,154-176` (an `AreaChart` of `bars{t,c}`, gradient in ok/loss, `h-28`).
- `widgets/netmon/useNetwork.ts:31` `useGatedInterval(1000)`, `staleTime: 900` (:36), `HISTORY_SIZE = 60` (:8).
- `apps/renderer/vite.config.ts`: `sourcemap: 'hidden'` (maps emitted into `dist/`, and `electron-builder.yml` copies `apps/renderer/dist/**/*` → maps ship). The theme-init `<script>` is inlined into `<head>` by the `themeInit()` plugin. `manualChunks`: `vendor` + `grid-layout`.
- Renderer origins: API `http://127.0.0.1:7432` (`lib/apiClient.ts`), embed iframes `http://localhost:7432/api/<svc>/embed` (`embedUrl`), RainViewer iframe `https://www.rainviewer.com/...` (`WeatherWidget.tsx:130`), Discord `<webview src="https://discord.com/...">` (`DiscordHost.tsx`), images from many https hosts (news, YouTube, Twitch thumbnails, favicons) and data URIs.

## Design

### Electron 45 upgrade (T1)
- `apps/main/package.json`: `electron` `45.2.1` (exact), add `electron-updater` `^6.8.11` to `dependencies`, add `esbuild` `^0.28.2` to devDependencies. Root: `electron-builder` `^26.18.1`. Renderer: remove `recharts` and `react-is`.
- `apps/main/build.mjs` (new): esbuild bundles as described in Decisions; `target: 'node22'`; `sourcemap: false`; `logLevel: 'warning'`. With `--watch` it rebuilds on change.
- `apps/main/package.json` scripts: `"build": "tsc --noEmit && node build.mjs"`, `"typecheck": "tsc --noEmit"`, `"dev": "node build.mjs --dev"` where `--dev` builds once, starts `electron .` with `NODE_ENV=development`, then watches and restarts Electron after each successful rebuild (kill the old child, spawn a new one; exit when Electron exits on its own). Remove `tsc-watch` from devDependencies.
- `apps/main/tsconfig.json`: keep `composite`/references for typecheck; set `"noEmit": true` is not allowed with `composite` — instead keep the config as is and only stop using its emit (`tsc --noEmit` works with composite in TS 5.x; if it errors, drop `composite` and the reference and keep `paths`).
- `electron-builder.yml`:
  - `electronVersion: "45.2.1"`.
  - renderer files filter: `["**/*", "!**/*.map"]`; main files filter: `["index.js", "preload.js"]` (no maps, no stray tsc output).
  - remove the two `@dash/shared` → `node_modules/@dash/shared` entries (now bundled).
  - add
    ```yaml
    publish:
      provider: github
      owner: nishant
      repo: nishboard
      releaseType: release
    ```
  - `nsis.artifactName: ${productName}-Setup-${version}.${ext}`.
  - `dmg.artifactName: ${productName}-${version}-${arch}.${ext}` (today's name, made explicit).
- Breaking-change fixes from Electron 34–45: see "Electron 34–45 changes that apply" below.
- `scripts/prepare-wincodesign.cjs`: delete (see below) and remove it from the root `package` script.

### Electron 34–45 changes that apply
(Researched against the official breaking-changes doc and the electron-builder 26.18 / electron-updater 6.8.11 sources.)
- **Clipboard is async in main (Electron 44):** `clipboard.readText()` returns `Promise<string>`, `writeText()` returns `Promise<void>`. `apps/main/src/clipboardHistory.ts` (T1): make `poll()` async, await the read inside the try/catch, add an in-flight guard so 1s ticks never overlap, await `writeText` in `copyClipboardEntry`.
- **safeStorage sync API is deprecated in 45 (removed in 46):** switch to `isAsyncEncryptionAvailable()`, `encryptStringAsync()`, `decryptStringAsync()` (check the exact signatures in `node_modules/electron/electron.d.ts`; existing ciphertext decrypts with the async call).
  - `apps/main/src/credentials.ts` (T5): add `export async function loadCredentials(): Promise<void>` that decrypts once into a module cache; `readCredentials()` stays sync and returns the cache (empty object before load); `writeCredentials()` becomes async (encrypt async, then refresh the cache); `readCredentialStatus()` reads the cache. Encryption-available checks use the async call.
  - `apps/main/src/ipc/index.ts` (T3): await `writeCredentials` before `restartServer()`; `credentials:encryption-available` returns `await safeStorage.isAsyncEncryptionAvailable()`.
  - `apps/main/src/index.ts` (T4): `await loadCredentials()` in `whenReady` before `spawnServer()`.
  - `apps/main/src/tokenKey.ts` (T5): async API from the start (`loadTokenKey(): Promise<string | null>`), and `spawnServer` awaits it.
- **macOS notifications need a signed app (42):** an unsigned DMG fires `failed` instead of showing. Every `new Notification(...)` in main gets `.on('failed', (_e, err) => console.warn('[notify] failed:', err))` (T3 in `ipc/index.ts` and `updates.ts`). No other change.
- **Screen capture permission is `display-capture` (45):** `discord.ts` already allows both `media` and `display-capture`; no change.
- **Sandboxed preload lost `Buffer`/`setImmediate`/node shims (45):** `preload.ts` uses none; no change. Keep it that way.
- **electron npm package downloads its binary on first run (42):** no CI impact (tests use the stub).
- **macOS minimum is 13 Ventura (44).** Note it in README requirements.
- `electron-builder.yml` (T1): add `NSAudioCaptureUsageDescription: Screen sharing in the Discord widget can include system audio.` to `mac.extendInfo`.
- **electron-builder 26 no longer uses 7zip-bin/rcedit for unsigned Windows builds**, and `scripts/prepare-wincodesign.cjs` now exits 1 because `7zip-bin` is gone. T1 deletes the script and removes `node scripts/prepare-wincodesign.cjs &&` from the root `package` script.
- `CSC_IDENTITY_AUTO_DISCOVERY=false` still works; keep it.
- Root `engines.node`: `>=22.12`.
- `--publish never` still writes `latest.yml`, `latest-mac.yml` and `*.blockmap` into `release/` when `publish:` is configured; `app-update.yml` goes into resources. Do not set `publisherName` / `verifyUpdateCodeSignature` (unsigned updates would then fail verification).
- The test stub `apps/main/test/electron-stub.ts` (T1 owns it): `clipboard.readText: async () => ''`, `writeText: async () => undefined`; `safeStorage` gains `isAsyncEncryptionAvailable: async () => false`, `encryptStringAsync: async (s) => Buffer.from(s)`, `decryptStringAsync: async (b) => b.toString()`; add `screen` (`getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }]`, `getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } })`, `on: () => undefined`), and inert `globalShortcut`, `ipcMain`, `nativeImage` if absent.

### Release workflow (T2)
`.github/workflows/release.yml` becomes:
1. `gate` (ubuntu-latest, Node 22, pnpm): `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
2. `version` (needs gate): unchanged logic (tag from PR title).
3. `create-release` (needs version, if released): `gh release create "$TAG" --draft --generate-notes --title "$TAG" --repo "$GITHUB_REPOSITORY"` with `GH_TOKEN: ${{ github.token }}`.
4. `build` (matrix macos-14 / windows-latest, needs version + create-release): as today up to `pnpm package`, then upload with bash:
   - Windows: `gh release upload "$TAG" release/*.exe release/*.exe.blockmap release/latest.yml --clobber`
   - macOS: `gh release upload "$TAG" release/*.dmg --clobber`, plus `release/*.dmg.blockmap` and `release/latest-mac.yml` only if they exist.
   Use a matrix field `upload` holding the glob list; `shell: bash`; fail if no installer matched.
5. `publish` (needs version + build, if released): `gh release download "$TAG" -D assets`, then in `assets`: `sha256sum -- * > SHA256SUMS` (exclude any existing `SHA256SUMS`), `gh release upload "$TAG" assets/SHA256SUMS --clobber`, then `gh release edit "$TAG" --draft=false --latest`.
   If any build leg fails, `publish` does not run and the release stays a draft (invisible to the updater and to `releases/latest`).
- `permissions: contents: write` stays. Keep the `concurrency` block and the header comment (update its text to describe draft → build → publish).
- `.github/workflows/ci.yml`: unchanged.
- `.github/dependabot.yml`: add a second `npm` entry with `directory: /apps/main`, same schedule, `open-pull-requests-limit: 1`, `allow: [{dependency-name: electron}]`, no ignore. Root entry: add `ignore: - dependency-name: electron` (so the two entries never both propose Electron), keeping the existing major ignore.

### Auto-update (T3)
Shared types (`packages/shared/src/types/ipc.ts`):
```ts
export interface UpdateCheckData {
  currentVersion: string;
  latestVersion: string | null;
  url: string | null;
  hasUpdate: boolean;
  assetUrl: string | null;
  assetName: string | null;
  /** true when this build installs updates itself (Windows packaged). The UI then
   *  shows UpdateStatusData instead of the download button. */
  autoUpdate: boolean;
  message?: string;
}
export type UpdateState = 'idle' | 'checking' | 'downloading' | 'downloaded' | 'error';
export interface UpdateStatusData {
  state: UpdateState;
  /** Version being downloaded or ready to install; null otherwise. */
  version: string | null;
  /** 0..100 while downloading; null otherwise. */
  percent: number | null;
  /** Error text for state 'error'; null otherwise. */
  message: string | null;
}
```
New IPC channels: `app:get-update-status` (invoke → `UpdateStatusData`), `app:install-update` (invoke → void), `app:update-status` (main → renderer push). `ElectronAPI.app` gains `getUpdateStatus()`, `installUpdate()`, `onUpdateStatus(cb): () => void` (same listener pattern as `popout.onChanged`).

`apps/main/src/updates.ts`:
- `export function compareSemver(a: string, b: string): number` — parse `MAJOR.MINOR.PATCH` with optional `-prerelease` (leading `v` ignored); compare numerically; a version with a prerelease is lower than the same version without; prereleases compare by dot-separated identifiers (numeric < alphanumeric, numeric compared as numbers). Unparseable input compares as equal (returns 0) so it never reports an update.
- `checkUpdates()`: `hasUpdate = latestVersion !== null && compareSemver(latestVersion, currentVersion) > 0`; result gains `autoUpdate: autoUpdateSupported()`; when `autoUpdateSupported()` and `hasUpdate`, also call `void autoUpdater.checkForUpdates()` (starts the download). Memo unchanged.
- `export function autoUpdateSupported(): boolean` → `app.isPackaged && process.platform === 'win32'`.
- `export function startAutoUpdates(getWindows: () => BrowserWindow[]): void` — no-op unless supported. Sets `autoUpdater.autoDownload = true`, `autoUpdater.autoInstallOnAppQuit = true`, `autoUpdater.allowPrerelease = false`, `autoUpdater.logger` = a small logger writing to `userData/logs/updater.log` (append, one line per message, rotate at 1 MB by truncating). Wires events → `status` (module state) and broadcasts `app:update-status` to every window from `getWindows()`:
  - `checking-for-update` → `checking`; `update-not-available` → `idle`; `update-available` → `downloading` (version, percent 0); `download-progress` → `downloading` (percent rounded); `update-downloaded` → `downloaded` (version) and a native `Notification` once per version: title `Nishboard ${version} is ready`, body `It installs when you quit. Or restart now from Settings → About.`; `error` → `error` (message = `err.message`, max 200 chars).
  - First check 30s after start, then every 6h (`setInterval(...).unref?.()`); errors are caught (never thrown).
- `export function getUpdateStatus(): UpdateStatusData`, `export function installUpdate(): void` → `autoUpdater.quitAndInstall(false, true)` only when state is `downloaded`.
- The close-to-tray intercept must not block the install: `installUpdate` sets a flag exported as `isInstallingUpdate()`; T4's `close` handler treats it like `quitting`.
- `ipc/index.ts`: register `app:get-update-status` and `app:install-update`.
- `preload.ts`: add the three API members (minimal addition; sec-fixes also edits this file, keep the diff to those lines).
- `SettingsModal.tsx` `AboutSection`:
  - Subscribe to `onUpdateStatus` and read `getUpdateStatus()` on mount (only when `window.electron?.app?.getUpdateStatus` exists).
  - When `result?.autoUpdate` or status state is not `idle`: show the status line instead of the download button:
    - `checking`: "Checking for updates…"
    - `downloading`: "Downloading v{version}… {percent}%"
    - `downloaded`: "v{version} is ready." + primary Button "Restart to update" → `installUpdate()`
    - `error`: "Update failed: {message}" (text-th-loss)
    - `idle` after a check: `result.message ?? 'You are up to date.'`
  - macOS / non-auto: today's UI, unchanged (release-page link + Download DMG/EXE).
  - Not packaged: the manual check still works (it is useful in dev); no change.
- Tests: `updates.test.ts` adds `compareSemver` cases (`1.10.0 > 1.9.9`, `v2.0.0 > 1.99.99`, `1.0.0 > 1.0.0-beta.2`, `1.0.0-beta.10 > 1.0.0-beta.2`, equal, garbage → 0) and `checkUpdates` hasUpdate false when local is newer (stub `fetch` with `vi.stubGlobal`). Mock `electron-updater` with `vi.mock('electron-updater', () => ({ autoUpdater: {...} }))`.

### Windows, bounds and second launch (T4)
- `apps/main/src/windowBounds.ts` (new):
  ```ts
  export interface Rect { x: number; y: number; width: number; height: number }
  export interface SavedBounds extends Rect { maximized: boolean }
  /** Pure: keep `r` if at least 64×64 px of it overlaps some work area; otherwise centre it
   *  on `fallback` (the primary work area). Always shrink width/height to fit the chosen
   *  work area. Exported for tests. */
  export function clampToDisplays(r: Rect, workAreas: Rect[], fallback: Rect): Rect
  export function readMainBounds(): SavedBounds | null   // userData/window-bounds.json key "main"
  export function trackMainBounds(win: BrowserWindow): void // save getNormalBounds()+isMaximized() on 'resize'/'move' (debounced 500ms) and on 'close'
  export function ensureOnScreen(win: BrowserWindow): void  // apply clampToDisplays to win.getBounds() if it changes anything
  export function watchDisplays(getWindows: () => BrowserWindow[]): void // screen 'display-removed' and 'display-metrics-changed' → ensureOnScreen on every window
  ```
  File `userData/window-bounds.json`: `{ "main": { "x":0,"y":0,"width":1920,"height":1080,"maximized":false } }`; validated field by field (finite numbers, width ≥ 360, height ≥ 400), invalid → null.
- `index.ts`:
  - Wrap everything after the lock in `if (gotLock) { … }`: `const gotLock = app.requestSingleInstanceLock(); if (!gotLock) app.quit(); else { second-instance handler; whenReady handler; window-all-closed; before-quit; activate }`. No `spawnServer`, `killStaleOnPort` or window code runs in a second instance.
  - `createWindow`: default 1920×1080 centred; if `readMainBounds()` exists, use its rect after `clampToDisplays` against `screen.getAllDisplays().map(d => d.workArea)` and `screen.getPrimaryDisplay().workArea`; `minWidth: 360`, `minHeight: 480`; call `win.maximize()` when saved `maximized`; then `trackMainBounds(win)`.
  - After the window exists: `watchDisplays(() => BrowserWindow.getAllWindows())` (once) and `startAutoUpdates(() => BrowserWindow.getAllWindows())` (from T3).
  - Close-to-tray handler: `if (!quitting && !isInstallingUpdate() && readPrefs().closeAction === 'tray')`.
  - Electron 34–45 fixes that touch `index.ts` (see end section).
- `popout.ts`: clamp the stored rect with `clampToDisplays` before creating the window (keep default sizes when nothing stored); save on close as today.
- `apps/main/test/electron-stub.ts` is owned by T1 (which adds `screen` etc.); T4 does not edit it.
- Tests `windowBounds.test.ts`: on-screen rect kept; rect on a removed second monitor (x=3000) moved to primary and centred; 64px overlap rule (63px overlap → moved); oversize window shrunk to the work area; negative-coordinate monitor to the left kept; invalid file → null.

### Token encryption (T5)
- `packages/server/src/lib/tokenCrypto.ts` (new):
  ```ts
  /** Reads DASH_TOKEN_KEY once at module load, then deletes it from process.env. */
  export function tokenKey(): Buffer | null          // 32 bytes or null (missing/invalid → null)
  export interface EncryptedFile { v: 1; alg: 'aes-256-gcm'; iv: string; tag: string; data: string } // base64 fields
  export function encryptJson(value: unknown, key: Buffer): EncryptedFile   // random 12-byte iv
  export function decryptJson<T>(file: EncryptedFile, key: Buffer): T       // throws on tamper/wrong key
  export function isEncryptedFile(x: unknown): x is EncryptedFile
  /** Write `text` to `file` atomically (tmp file in the same dir + rename), mode 0o600,
   *  creating the dir with mode 0o700. On Windows rename-over-existing works with fs.renameSync. */
  export function writePrivateFile(file: string, text: string): void
  ```
- `userTokenStore.ts`: `load()` parses the file; if `isEncryptedFile` → decrypt with `tokenKey()` (no key or decrypt failure → `null`, file untouched, one `console.warn('[tokens] <filename>: cannot decrypt — reconnect the service')`); if plaintext tokens and a key exists → return them and immediately re-`save()` (migration). `save()` → `writePrivateFile(file, JSON.stringify(key ? encryptJson(t, key) : t))`. Also `chmod 0o600` best-effort is implied by the write. Update the class comment ("encrypted at rest when the app supplies a key").
- `apps/main/src/tokenKey.ts` (new): `export async function loadTokenKey(): Promise<string | null>` — path `~/.dash/.token-key`; if it exists, `await safeStorage.decryptStringAsync(buf)` and validate base64 of 32 bytes; else if `await safeStorage.isAsyncEncryptionAvailable()`, generate `randomBytes(32).toString('base64')`, write `await safeStorage.encryptStringAsync(key)` with mode 0o600 (dir 0o700); return the key. An existing but undecryptable key file is NOT overwritten (return null; tokens then read as disconnected). Any failure → `null` (logged once, never the key). Cache the promise in module state.
- `apps/main/src/server/spawn.ts`: add `...(tokenKey ? { DASH_TOKEN_KEY: tokenKey } : {})` to the child env, where `tokenKey = await loadTokenKey()` (spawnServer is already async). Also make `killStaleOnPort` on Windows match the local-address column exactly (`/^\s*TCP\s+\S+:7432\s+\S+\s+LISTENING\s+(\d+)\s*$/m` over `netstat -ano -p tcp` output) instead of `findstr :7432`. Keep the rest of the file unchanged (sec-fixes edits it too).
- Tests: `tokenCrypto.test.ts` (round trip, tamper → throws, wrong key → throws, `isEncryptedFile`), `userTokenStore.test.ts` adds store tests using a temp HOME (`vi.spyOn(os, 'homedir')` before a fresh import): encrypted write, plaintext migration, no-key plaintext write, encrypted-without-key → not authenticated and file unchanged, file mode 0o600 on POSIX (skip the mode assertion on win32). `tokenKey.test.ts` with the electron stub (stub `safeStorage.isEncryptionAvailable` true via `vi.spyOn`).

### CSP and source maps (T6)
- `vite.config.ts`: add a `csp()` plugin with `apply: 'build'` that, in `transformIndexHtml` with `order: 'post'`, finds every inline `<script>` (no `src`) in the final HTML, hashes its exact text with SHA-256, and injects as the first child of `<head>`:
  ```
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-…'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http://127.0.0.1:7432 http://localhost:7432; font-src 'self' data:; connect-src 'self' http://127.0.0.1:7432 http://localhost:7432; frame-src http://localhost:7432 http://127.0.0.1:7432 https://www.rainviewer.com https://discord.com https://*.discord.com; media-src 'self' data: blob: https:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'">
  ```
  The meta must come before the inline theme script (CSP from a meta applies only to content after it), so it is injected at `head-prepend` and the plugin runs after `themeInit()`.
  Export the pure helper `buildCsp(inlineScripts: string[]): string` from `src/csp.ts` (new, imported by `vite.config.ts`) and test it in `src/csp.test.ts` (hash of a known string, directive list).
- `sourcemap`: change to `false` (nothing ships maps; the builder filter is the second guard).
- `manualChunks`: keep `vendor` + `grid-layout`, drop the recharts comment; react-markdown/remark-gfm (Claude, Notes) go to a `markdown` chunk (leaf, depends on vendor one way).
- Verification in a real build is part of the acceptance (see T6 below).

### Lazy widgets (T7)
- `apps/renderer/src/widgets/registry.tsx` (new) exports `WIDGET_REGISTRY: Record<WidgetId, { Component: ComponentType<WidgetProps>; Actions?: ComponentType }>` (same shape as today's, check the existing prop types in `DashboardGrid.tsx`). Each entry is built by
  ```tsx
  function lazyWidget<P>(load: () => Promise<ComponentType<P>>): ComponentType<P>
  ```
  which wraps `React.lazy(() => load().then((C) => ({ default: C })))` in `<Suspense fallback={<WidgetFallback />}>`; actions use the same helper with `fallback={null}`. Both the widget and its actions import the SAME module (`() => import('./stocks/StocksWidget').then(m => m.StocksWidget)` and `.then(m => m.StocksActions)`), so one chunk per widget.
  `WidgetFallback` = `<SkeletonLines lines={3} />` from `@nish/ui` inside `p-3`.
- `DashboardGrid.tsx` stops defining the registry and imports it (done by T8, which owns `DashboardGrid.tsx`); `PopoutShell.tsx` imports from `../widgets/registry` (T7).
- Tests importing widget modules directly keep working (named exports unchanged).

### Responsive grid (T8)
- `lib/layouts.ts` adds:
  ```ts
  export const NARROW_ROW_HEIGHT = 32;
  export function gridColumnsFor(width: number): 1 | 2 | 3 | 24  // <600→1, <900→2, <1200→3, else 24
  /** Pure: a layout for 1–3 columns from the desktop layout. Order by (y, x); each item w=1;
   *  1 column: stacked in order; 2–3 columns: each item goes to the column whose current bottom
   *  is lowest (ties → leftmost). Height: collapsed ids → collapsedRows; else
   *  clamp(round(h * 1.4), 6, 24). Every item static (isDraggable/isResizable false). */
  export function deriveNarrowLayout(desktop: Layout[], cols: 1 | 2 | 3, collapsed: ReadonlySet<string>, collapsedRows: number): Layout[]
  ```
- `DashboardGrid.tsx`:
  - Measure the grid container width (`useElementSize` on a wrapper div, or RGL's `WidthProvider` width via a wrapper) → `cols = gridColumnsFor(width)`; narrow = `cols !== 24`.
  - Narrow: `layout = deriveNarrowLayout(visibleLayout, cols, collapsedSet, collapsedRowsFor(NARROW_ROW_HEIGHT, gap))`, `rowHeight = NARROW_ROW_HEIGHT`, `isDraggable={false}`, `isResizable={false}`, `onLayoutChange` / drag / resize handlers NOT wired (no `syncLayout`, no `markUserEdited`), wrapper `overflow-y-auto overscroll-contain` with `h-full`. Collapse toggle still calls the existing `onToggleCollapse` (it uses the desktop `rowHeight` from `useRowHeight`, which depends on window height only, so the desktop layout stays consistent).
  - Desktop: unchanged behaviour.
  - Import `WIDGET_REGISTRY` from `../widgets/registry` and delete the local registry and widget imports.
- `App.tsx`: the grid wrapper stays `flex-1 min-h-0`; the scroll lives inside `DashboardGrid` (so the Titlebar stays put). No other change.
- `Titlebar.tsx`: at window width < 600px, hide text labels and secondary buttons behind the existing menus so the bar never scrolls horizontally; every control keeps a ≥ 44px hit area on touch (`pointer: coarse`) — check what is there first and change only what overflows at 360px.
- Tests: `layouts.test.ts` adds `gridColumnsFor` boundaries (599/600/899/900/1199/1200) and `deriveNarrowLayout` (1 col stacking order, 2 col balancing, collapsed heights, clamp 6..24, input not mutated); a `DashboardGrid` test (jsdom) is optional — if added, assert `syncLayout` is never called in narrow mode.

### Stocks chart (T9)
- `StocksWidget.tsx`: replace the recharts `AreaChart` with `<LineChart data={bars.map(b => ({ x: Date.parse(b.t), y: b.c }))} area tone={up ? 'ok' : 'loss'} height={112} label={`${symbol} price`} xFormat={…same date/time label as the old tooltip…} yFormat={(v) => `$${v.toFixed(2)}`} />` from `@nish/ui`. Keep the same container and empty state. Remove `recharts` imports and the `tk` gradient code that only fed recharts.
- `StocksWidget.test.tsx`: keep passing; drop any recharts mock.

### Inbox (T10)
- `InboxWidget.tsx` renders the `@nish/ui` `Inbox` inside the widget body for the `ok` feed state; keeps today's offline / no-password / bad-password states (wording unchanged) and the `InboxActions` header export unchanged.
- Map: `items` = the current view's items sorted with `groupBySeverity` (open view: severity order, acked last); `view`/`onViewChange`, `counts`, `sources`, `source`/`onSourceChange` from the existing hooks/state; `onHandle` = existing resolve call; `onUnhandle`, `onSnooze`, `onUnsnooze` = existing calls; `onHandleAll` = existing resolve-all; `onAction(itemId, actionId)`: `__ack` / `__unack` → `inboxUiStore` ack/unack locally (resolve immediately), otherwise the existing `POST /api/inbox/items/:id/actions/:actionId` call; rejections toast `toast.error('Action failed', { body: message })`.
- Inject the Ack action: for open-view items, append `{ id: isAcked ? '__unack' : '__ack', label: isAcked ? 'Unack' : 'Ack' }` to a copy of `item.actions` (match the `InboxAction` shape from `@nish/ui`; fill any other required fields with neutral values).
- Links: wrap `Inbox` in a `div` with `onClickCapture` that finds `(e.target as Element).closest('a[href]')`; for `http(s)` hrefs call `e.preventDefault()` and `window.electron?.openExternal(href)`.
- `loading`, `error`, `onRetry` from the query. `sourceLabels` = `INBOX_SOURCE_LABELS`.
- Delete code made dead by this (row components, local snooze menu); keep `inboxSort.ts` helpers that are still used and their tests; delete tests of deleted helpers.

### Command palette (T11)
- `components/CommandPalette.tsx` renders `@nish/ui` `CommandPalette` with `open={paletteOpen}`, `onOpenChange`, `hotkey={false}`, `placeholder` = today's placeholder text, `items={(q) => buildRows(q)}`.
- Keep in nishboard: Ctrl/Cmd+K toggles (`keydown` listener, as today), double-Shift within 300ms opens, recents (8, same localStorage key), fixed group order, 40-row cap, async refreshers on open.
- `buildRows(q)` returns `CommandItem[]` in display order: parameterised preview row first when the query parses (label = today's preview text, `onSelect` runs it and records recent); when a parameterised command matches by name but its arguments do not parse, a row with label = the command title, `hint` = its syntax (e.g. `timer 25m [label]`) and an `onSelect` that does nothing; empty query → "Recent" group then the rest in group order; otherwise fuzzy-ranked rows (today's `lib/fuzzy.ts` scoring) grouped in the fixed order. `fill` rows become rows with `hint` = the syntax and no-op `onSelect`.
- Async refresh: when refreshers settle while the palette is open and the user has not typed yet (track via `onQuery`), remount the ui palette (`key` bump) so the new rows show.
- Keep `overlayStore.paletteOpen`.
- Tests: existing palette/registry tests updated; add `buildRows` tests (empty query → recents first, parameterised preview row first, unparsable args → hint row, group order).

### Sound + network (T12)
- `packages/server/src/lib/psHost.ts` (new, Windows only):
  ```ts
  export class PsHost {
    constructor(opts?: { idleMs?: number; timeoutMs?: number; spawnFn?: typeof spawn; bootstrap?: string })
    /** Run a PowerShell snippet in the long-lived process; resolves with its trimmed stdout text. */
    run(script: string): Promise<string>
    dispose(): void
  }
  ```
  - Process: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command -` with `windowsHide: true`, stdin/stdout pipes; started lazily on the first `run`.
  - Bootstrap (written once to stdin at start): sets `[Console]::OutputEncoding = [Text.Encoding]::UTF8`, `$ErrorActionPreference='Stop'`, runs the WASAPI `Add-Type` (from `sound.ts`) once, tries `Import-Module AudioDeviceCmdlets` once (sets `$HasCmdlets`), then loops: read one line from stdin; the line is `<id> <base64 utf8 script>`; run it in `try { $out = (& ([ScriptBlock]::Create($s)) | Out-String) ; ok } catch { err }`; write one JSON line `{"id":…,"ok":true,"out":"…"}` or `{"id":…,"ok":false,"error":"…"}` (`ConvertTo-Json -Compress`).
  - Requests are serialised (one in flight; a queue). Per-request timeout 10s → kill the process, reject that request, the next request starts a fresh process. Process exit/crash → reject in-flight and queued requests with `Error('PowerShell host exited')`; next request restarts. Idle 60s with no request → stop the process. `dispose()` on server shutdown.
  - Lines not starting with `{` on stdout are ignored (PowerShell noise).
- `routes/sound.ts`: Windows functions use one shared `PsHost` instead of `psRun`; WASAPI is preloaded so snippets call `[W]::…` directly; `winGetDeviceData` uses `if ($HasCmdlets) { … } else { [W]::GetMaster() … }` in one round-trip; `winGetData` runs device data and sessions in ONE snippet (two output sections split by a line `---SESSIONS---`). `GET /` dedupes concurrent requests (share one in-flight promise). Remove `psRun`, temp files and `WASAPI_CS_B64` per-call embedding. macOS unchanged. Register `onClose` hook to `dispose()`.
- `widgets/netmon/useNetwork.ts`: `useGatedInterval(5000)`, `staleTime: 4500`, keep `HISTORY_SIZE = 60` and update its comment to "5 min at 5s".
- Tests `psHost.test.ts` with a fake `spawnFn` (an EventEmitter-based fake child with writable stdin and readable stdout): request/response by id, serialisation, timeout kills and restarts, crash rejects pending, idle stop, noise lines ignored.

### Security (summary)
- No new routes. New IPC: `app:get-update-status`, `app:install-update` (no arguments).
- `DASH_TOKEN_KEY` never logged, removed from the server's `process.env` after reading, not passed to grandchildren.
- CSP blocks inline/remote scripts in the renderer; `object-src 'none'`, `base-uri 'none'`.
- Updates come only from `nishant/nishboard` GitHub releases over HTTPS; electron-updater checks the sha512 from `latest.yml`.

### Performance
- Widget chunks load on demand; recharts (~300 KB) removed. Budget: initial JS (entry + vendor) at least 25% smaller than today's (record both sizes in the PR body from `vite build` output).
- One PowerShell process instead of 2–3 spawns + C# compile every 5s.
- Network widget: 1 request per 5s instead of every 1s.

### Mobile / sizes
- Electron window min 360×480. Grid at 360px: single column, page scrolls, no horizontal scroll; at 840px: 2 columns; at 1440px and above: unchanged desktop grid. Light and dark both via existing tokens.

## Tasks

### T1 Electron 45, builder 26, esbuild main bundle, dependencies
- Owns: `package.json`, `apps/main/package.json`, `apps/renderer/package.json`, `pnpm-lock.yaml`, `apps/main/build.mjs` (new), `apps/main/tsconfig.json`, `electron-builder.yml`, `scripts/prepare-wincodesign.cjs` (delete), `scripts/package-app.mjs`, `apps/main/src/clipboardHistory.ts`, `apps/main/test/electron-stub.ts`, `README.md` (requirements line only)
- Reads: everything in `apps/main/src`, `packages/server/build.mjs`
- Depends on: none
- Change: Design → "Electron 45 upgrade" and the end section "Electron 34–45 changes that apply" for the files it owns. Run `pnpm install` to update the lockfile.
- Edge cases: `pnpm dev` must still start Electron (the `--dev` mode of `build.mjs`); `pnpm --filter @dash/main test` still uses vitest from source.
- Acceptance: `pnpm install`, `pnpm --filter @dash/main typecheck`, `pnpm --filter @dash/main build` (produces `apps/main/dist/index.js` and `dist/preload.js`, no other files), `pnpm --filter @dash/main test`, `pnpm --filter @dash/server build`. (The renderer will not typecheck until T9 removes recharts; that is expected.)

### T2 Release workflow, checksums, Dependabot
- Owns: `.github/workflows/release.yml`, `.github/dependabot.yml`
- Depends on: none
- Change: Design → "Release workflow".
- Acceptance: re-read both files for indentation and quoting; every `gh` call has `GH_TOKEN` set and runs after checkout (or passes `--repo "$GITHUB_REPOSITORY"`). The planner validates the YAML with a parser before pushing.

### T3 Auto-update
- Owns: `apps/main/src/updates.ts`, `apps/main/src/updates.test.ts`, `apps/main/src/ipc/index.ts`, `apps/main/src/preload.ts`, `packages/shared/src/types/ipc.ts`, `apps/renderer/src/components/SettingsModal.tsx`, `apps/renderer/src/types/electron.d.ts` (only if it re-declares the API)
- Depends on: T1 (electron-updater installed)
- Change: Design → "Auto-update".
- Acceptance: `pnpm --filter @dash/shared build`, `pnpm --filter @dash/main typecheck`, `pnpm --filter @dash/main test`.

### T4 Window bounds, display clamping, second-launch fix
- Owns: `apps/main/src/index.ts`, `apps/main/src/popout.ts`, `apps/main/src/windowBounds.ts` (new), `apps/main/src/windowBounds.test.ts` (new)
- Depends on: T1, T3 (`startAutoUpdates`, `isInstallingUpdate`), T5 (`loadCredentials`)
- Change: Design → "Windows, bounds and second launch" and the `index.ts` items of the end section.
- Acceptance: `pnpm --filter @dash/main typecheck`, `pnpm --filter @dash/main test`, `pnpm --filter @dash/main build`.

### T5 Token encryption
- Owns: `packages/server/src/lib/tokenCrypto.ts` (new) + test, `packages/server/src/lib/userTokenStore.ts`, `packages/server/src/lib/userTokenStore.test.ts`, `apps/main/src/tokenKey.ts` (new) + test, `apps/main/src/server/spawn.ts`, `apps/main/src/credentials.ts`
- Depends on: T1
- Acceptance: `pnpm --filter @dash/server test`, `pnpm --filter @dash/server build`, `pnpm --filter @dash/main typecheck`, `pnpm --filter @dash/main test`.

### T6 CSP and no source maps
- Owns: `apps/renderer/vite.config.ts`, `apps/renderer/src/csp.ts` (new), `apps/renderer/src/csp.test.ts` (new)
- Depends on: T1
- Acceptance: `pnpm --filter @dash/renderer test -- csp`; after integration (T7–T11 done) the integrator runs `pnpm build` and checks `apps/renderer/dist/index.html` has the meta before the inline script and `dist` has no `.map`.

### T7 Lazy widget registry
- Owns: `apps/renderer/src/widgets/registry.tsx` (new), `apps/renderer/src/components/PopoutShell.tsx`
- Depends on: none
- Acceptance: `pnpm --filter @dash/renderer exec tsc --noEmit -p .` may fail only on recharts (until T9); `pnpm --filter @dash/renderer test`.

### T8 Responsive grid
- Owns: `apps/renderer/src/components/DashboardGrid.tsx`, `apps/renderer/src/lib/layouts.ts`, `apps/renderer/src/lib/layouts.test.ts`, `apps/renderer/src/App.tsx`, `apps/renderer/src/components/Titlebar.tsx`, `apps/renderer/src/components/Titlebar.test.tsx`
- Depends on: T7
- Acceptance: `pnpm --filter @dash/renderer test`; then `pnpm --filter @dash/renderer dev` and check 360, 840 and 1440 widths in a browser (the renderer runs standalone at `http://localhost:5173`; widgets that need the server show their error states, which is fine).

### T9 Stocks chart on @nish/ui LineChart
- Owns: `apps/renderer/src/widgets/stocks/StocksWidget.tsx`, `apps/renderer/src/widgets/stocks/StocksWidget.test.tsx`
- Depends on: T1
- Acceptance: `pnpm --filter @dash/renderer test -- stocks`; no `recharts` import left (`grep -r recharts apps/renderer/src` empty).

### T10 Inbox on @nish/ui Inbox
- Owns: `apps/renderer/src/widgets/inbox/InboxWidget.tsx`, `apps/renderer/src/widgets/inbox/inboxSort.ts`, `apps/renderer/src/widgets/inbox/inboxSort.test.ts`
- Depends on: none
- Acceptance: `pnpm --filter @dash/renderer test -- inbox`.

### T11 Command palette on @nish/ui CommandPalette
- Owns: `apps/renderer/src/components/CommandPalette.tsx`, `apps/renderer/src/lib/commandRegistry.ts`, `apps/renderer/src/lib/fuzzy.ts`, `apps/renderer/src/lib/fuzzy.test.ts`, `apps/renderer/src/lib/commandRegistry.test.ts` (new)
- Depends on: none
- Acceptance: `pnpm --filter @dash/renderer test -- fuzzy commandRegistry`.

### T12 PowerShell host + network interval
- Owns: `packages/server/src/lib/psHost.ts` (new), `packages/server/src/lib/psHost.test.ts` (new), `packages/server/src/routes/sound.ts`, `apps/renderer/src/widgets/netmon/useNetwork.ts`
- Depends on: none
- Acceptance: `pnpm --filter @dash/server test`, `pnpm --filter @dash/server build`. On this Windows PC, a quick manual check: start the server (`pnpm --filter @dash/server dev`), `curl http://127.0.0.1:7432/api/sound` twice, confirm only one `powershell.exe` child exists (`Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ? ParentProcessId -eq <server pid>`). If sec-fixes has already landed a bearer token requirement, skip the curl and rely on the tests.

## Waves
W1: T1, T2, T7, T10, T11, T12 · W2: T3, T5, T6, T8 (T8 needs T7), T9 · W3: T4 (needs T3, T5)

## Review focus
- Packaged app: does it start, load the renderer under the CSP, show embeds (YouTube/Twitch proxy iframes, RainViewer radar), the Discord webview, and talk to the server? CSP violations in the console.
- `electron-builder.yml` output: `latest.yml` produced, no `.map`, `app/dist` holds only the two bundles, server starts from `app/server/index.js`.
- Narrow mode never writes the saved desktop layout.
- Token migration never loses a working session; the key never reaches logs or grandchildren.
- Release workflow ordering (draft → upload → checksums → publish) and that a failed leg leaves a draft.
- PsHost: no leaked processes, timeouts recover.

## Release
Single repo. Merge after the sec-fixes nishboard PR if it is open by then (rebase/merge master first). PR title `feat: modernise Nishboard (Electron 45, auto-update, responsive grid, hardening)` → minor bump. Watch the Release run: gate → version → draft release → both installers → publish with `SHA256SUMS`. Verify: the GitHub Release is published (not draft) with `Nishboard-Setup-<v>.exe`, `.exe.blockmap`, `latest.yml`, the DMG and `SHA256SUMS`, and the checksums match (`sha256sum -c`). Install the EXE locally is NOT done by the session (it would replace Nish's running app); instead run the packaged build from `release/win-unpacked` once before merging.

## Open questions for the research phase
- Does Dependabot accept a second `npm` entry for `/apps/main` in a pnpm workspace whose lockfile is at the root, and does it then open Electron major PRs? If not, what is the supported way to get Electron majors only?
- Does esbuild bundle `electron-updater` 6.8 cleanly for `platform: node` with `electron` external (any dynamic requires, `.node` files or `__dirname` assets it needs, e.g. `app-update.yml` lookup via `process.resourcesPath`)?
