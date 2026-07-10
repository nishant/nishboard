# Dashboard Project — Claude Instructions

> Full spec: [SPEC.md](./SPEC.md) — source of truth for widget behavior, polling intervals, API choices.

## What We're Building
Personal ambient desktop dashboard for Nish, running all day on a secondary monitor. Electron + React. Windows primary, macOS secondary. Personal use only.

## Stack (non-negotiable)
- **Shell:** Electron 33 (`electronVersion` pinned in `electron-builder.yml`), TypeScript main process
- **Frontend:** React 18 + TypeScript strict, Vite, Tailwind CSS, shadcn/ui, Zustand, TanStack Query v5, Recharts
- **Backend:** Fastify + TypeScript, runs as child process on localhost:7432
- **Monorepo:** Turborepo + pnpm workspaces
- **Packages:** `apps/renderer`, `apps/main`, `packages/server`, `packages/shared`

## Architecture Rules
- All external API calls go through Fastify — never directly from renderer
- Secrets never reach the renderer or git. Three storage paths — see **Secrets & Credentials** below
- Renderer ↔ Fastify: HTTP on localhost:7432
- Renderer ↔ Electron main: contextBridge IPC with typed wrappers only
- Shared types live in `packages/shared` — import from there, never redefine
- Embedded players (YouTube, Twitch) are served from a localhost Fastify route, never framed directly — see **Embedding & Platform Gotchas**

## Widgets & APIs
| Widget | API | Key | Interval |
|---|---|---|---|
| Weather | Open-Meteo forecast + NWS severe-weather alerts (+ ip-api geolocation, zippopotam.us for ZIP) | none | 15min |
| Spotify | Spotify Web API (remote control — no Web Playback SDK; stock Electron lacks Widevine) | PKCE OAuth (`SPOTIFY_CLIENT_ID`) | 3s REST |
| Stocks | Alpaca Markets IEX REST snapshots (+ per-ticker detail: intraday/daily bars + Benzinga news) | ALPACA_API_KEY + ALPACA_API_SECRET | 5min poll |
| Hardware | systeminformation | none | 1s |
| Sound | PowerShell/WASAPI (Win) / osascript + SwitchAudioSource (mac) | none | 5s |
| Calendar | pure-JS month grid + Google Calendar v3 (primary calendar) for day drill-in/quick-add — reuses the YouTube Google OAuth client with its OWN token file (`~/.dash/google_calendar_tokens.json`, scope `calendar.events`) — register redirect `http://localhost:7432/api/calendar/callback` | YOUTUBE_CLIENT_ID/_SECRET (shared) | events: 5min per visible range |
| YouTube | YouTube Data API v3 (search/browse) + localhost embed proxy; user OAuth (auth-code, `youtube.readonly`) for Subs feed / Playlists / Liked + channel drill-in — register redirect `http://localhost:7432/api/youtube/callback`. Server enriches every video list with `contentDetails` duration (1 quota unit/50 ids); a "Hide YouTube Shorts" setting client-filters ≤60s (or `#shorts`-tagged) videos out of every tab | YOUTUBE_API_KEY (~100 searches/day free) + optional YOUTUBE_CLIENT_ID/_SECRET | on demand / subs 45min cache |
| Twitch | Twitch Helix (search + followed-live) + localhost embed proxy | app token for search; user OAuth (auth-code, `user:read:follows`) for Following — register redirect `http://localhost:7432/api/twitch/callback` | on demand / 60s followed |
| News | Google News RSS (keyless) | none | 10min |
| Crypto | CoinGecko `/coins/markets` (price + 24h change + 7d sparkline, one call) | COINGECKO_API_KEY optional (demo tier 30/min, 10k/mo; keyless = throttled) | 5min poll |
| Notes | none (Markdown multi-note tabs, localStorage) | none | n/a |
| Tasks | none (checklist, localStorage) | none | n/a |
| World Clock | none (pure-JS timezones, digital/analog) | none | n/a |
| Timer / Alarm | none (fires via notification IPC + Web Audio chime) | none | n/a |
| Countdown | none (target datetime, localStorage; fires via notification IPC) | none | n/a |
| Launcher | none (apps + links via typed IPC; targets stored main-side in `userData/launcher.json`, launch by id; groups with launch-all; icons resolved main-side — `app.getFileIcon` / google s2 favicon — and sent as data URIs only) | none | n/a |
| Clipboard | none (main-process 1s `clipboard.readText` poller, ONLY while widget mounted+unpaused; text-only, in-memory, cap 50, never persisted) | none | 1s while active |
| Net Monitor | system `ping` via server-side background sampler (2s tick, 30-sample ring/host, lazy start + 60s idle stop) + `si.networkStats()` throughput — Win `ping -n 1 -w 1000` (localized output — parse the `=Nms` token, never the word "time") / mac `ping -c 1 -W 1000` | none | 1s poll (pings decoupled at 2s) |
| Claude | spawns the user-installed **Claude Code CLI** (`claude -p --output-format stream-json --include-partial-messages --verbose`, prompt via stdin, `--resume` for context) — bills the claude.ai **Max subscription**, never API keys; `ANTHROPIC_API_KEY` is stripped from the child env | none (CLI's own OAuth login; optional CLAUDE_CODE_OAUTH_TOKEN fallback) | SSE stream on demand |

## Secrets & Credentials
Settings → Developer is **write-only**: the renderer only ever learns *which* keys are set (`credentials:get-status` booleans); stored values can be replaced or cleared but never viewed. Decrypted keys exist only in the main process and the spawned server's env.

Three places a key can live — checked in this order at runtime:
1. **Runtime env from safeStorage** — user-entered keys are encrypted with Electron `safeStorage` in `userData/credentials.json`, decrypted on launch, and injected as env vars into the spawned Fastify process. Saving in Settings restarts the server.
2. **Build-time baked values** — `packages/server/build.mjs` reads the root `.env` at package time and bakes ALL keys into the server bundle as ONE esbuild define: a JSON blob replacing the static `process.env.BUILTINS_JSON` reference in `lib/env.ts`. ⚠️ It must stay a single static reference — esbuild `define` cannot rewrite dynamic `process.env[computed]` access, which is why the original per-key `<KEY>_BUILTIN` defines silently never worked. Values land in the compiled bundle only — never in source or git (`.env` is gitignored). This is what lets a distributed DMG/EXE "just work". `cred()` reads runtime env first, then the baked map.
3. **`.env`** — only loaded in local `pnpm dev` (dotenv). Never committed.

**User OAuth tokens** (Spotify/YouTube/Twitch/Calendar) are *not* in safeStorage — they're plain JSON under `~/.dash/` (`spotify_tokens.json`, `youtube_tokens.json`, `google_calendar_tokens.json`, …; home dir, survives reinstalls). A refresh token is bound to the `client_id` that minted it; if the client_id changes, stale tokens fail refresh → Disconnect→Connect to reset. YouTube and Calendar share ONE Google OAuth client but hold separate tokens/consents — scopes don't upgrade in place, so keep it that way.

**`CLAUDE_CODE_OAUTH_TOKEN` is deliberately NOT in `build.mjs` BUILTIN_KEYS** — it's a personal account token; baking it into a distributable installer would ship Nish's Claude account. Settings/safeStorage only.

## Embedding & Platform Gotchas
- **`file://` null origin** — the packaged renderer loads from `file://`, so `window.location.hostname` is empty. YouTube/Twitch embeds and Spotify's redirect validation all break under `file://`. Fix pattern: serve the embed HTML from `http://localhost:7432/api/<svc>/embed`, where the iframe parent is a valid HTTP origin (`localhost`).
- **`frame-ancestors` checks the WHOLE chain** — the localhost embed proxy fixes the *immediate* parent, but a framed doc whose CSP sends `frame-ancestors` (e.g. Twitch `player.twitch.tv`, RainViewer radar `www.rainviewer.com`) still sees `file://` at the top of the ancestor chain and blocks. Fix: strip the CSP header from *those document responses only* in the main process via `session…onHeadersReceived` (see `apps/main/src/index.ts`) — leave media/tile CDNs untouched. These only break under `file://`, so `pnpm dev` (renderer on `http://localhost:5173`) won't reproduce them.
- **Electron UA** — YouTube returns Error 153 for the Electron UA; the main process strips `Electron/x.x.x` from the session user-agent.
- **SSE routes bypass @fastify/cors** — `/api/claude/chat` streams via `reply.hijack()` + `reply.raw`, so the CORS plugin never runs; the route mirrors the allowed-origin list from `app.ts` manually. Keep the two lists in sync when adding origins.
- **Spotify Dev Mode** — caps at 25 allowlisted users; a non-allowlisted account gets 403 on the API.
- **`apps/main` is `tsc`-compiled, NOT bundled** — so `import type … from '@dash/shared'` is safe (erased), but a **value** import (e.g. `import { CREDENTIAL_KEYS }`) survives as a runtime `require('@dash/shared')`. The packaged app has no `node_modules`, so that require crashes launch unless the module is shipped. `electron-builder.yml` ships `@dash/shared` into `node_modules/@dash/shared`; keep it there, and prefer `import type` from shared in main whenever possible. (The server is esbuild-bundled, so it's immune.) Bugs like this never show in `pnpm dev` — only in the packaged/built app.
- **Renderer `manualChunks` — don't hand-split React out of its consumers.** recharts reads React internals (`__SECRET_INTERNALS…`) at module-init; putting `recharts` and `react` in separate chunks creates a circular chunk and a bad init order → white screen under `file://`. Keep all `node_modules` in one `vendor` chunk (see `vite.config.ts`). If Rollup logs "Circular chunk", the build is broken even though dev works.
- Always label Windows-only vs macOS-only branches explicitly.

## Code Conventions
- Strict TypeScript — no `any`, no untyped `as` casts
- Named exports only (no default exports on hooks/stores)
- Components: `PascalCase` files
- Hooks: `use` prefix — e.g. `useSpotifyPlayer`
- Stores: `Store` suffix — e.g. `useStocksStore`
- API response types: `Data` suffix — e.g. `WeatherData`, `TrackData`
- API routes: lowercase kebab — `/api/spotify/now-playing`

## Testing
- `pnpm test` = turbo → per-package `vitest run`. Tests are colocated `*.test.ts` next to their source (renderer allows `.test.tsx`).
- **vitest is pinned to v3** — v4 needs vite 6; the renderer pins vite 5.
- Renderer tests run in **jsdom** with the same aliases as vite.config.ts; zustand persist stores are tested by seeding localStorage (`{state, version}` envelope) then `vi.resetModules()` + dynamic import.
- Main-process tests alias `electron` → `apps/main/test/electron-stub.ts` (module-scope `import { app } from 'electron'` would otherwise crash under node). Keep the stub's exports in sync with what main modules destructure. `apps/main/tsconfig.json` excludes tests from the build so they never reach the packaged `dist/`.
- Server upstreams all go through global `fetch` → stub with `vi.stubGlobal('fetch', …)`. `lib/env.ts` parses `BUILTINS_JSON` at module load — set the env var **before** a fresh `vi.resetModules()` import.
- Helpers exported solely for tests are marked `/** Exported for tests. */`.
- **Releases are test-gated**: `release.yml`'s `version` job (tag creation) `needs: test` — a red suite means no tag/build/release, including manual dispatches. CI also runs `pnpm test` on every PR.
- Unit tests don't cover packaged-app-only failures (`file://`, chunking, electron-builder file lists) — see **Embedding & Platform Gotchas**; verify those in a real packaged build.

## Working With Nish
- Senior software engineer (7 years), TypeScript/Angular/Node expert — no hand-holding
- Generate complete working files, not snippets
- Make surgical edits — don't rewrite files unnecessarily
- Always note side effects on other files

## Response Style
- Lead with code, follow with explanation if needed
- Call out TODOs, gotchas, and platform-specific branching explicitly
- Label Windows-only vs macOS-only behavior clearly
- Flag API rate limits or auth quirks immediately

## Git Workflow
1. **Branch first** — `git checkout -b <branch>` before touching any files. Never make changes on `master` then branch for the PR.
2. **Update CHANGELOG.md** on the branch before opening the PR. New entries go at the top (newest first). Cover every meaningful change and architectural decision. Follow the **Changelog Format** below.
3. **Commit, push, `gh pr create`** — in that order. **Do NOT auto-merge** — wait for Nish to explicitly say "merge".
4. Branch naming: `feat/<slug>` features · `fix/<slug>` fixes · `chore/<slug>` tooling/deps · `docs/<slug>` docs-only.
5. Commit message footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
6. **Feature PRs include tests + docs** — unit tests for logic that warrants them (parsers, stats/mapping fns — vitest lives in all three packages), and keep README.md + this file's widget/credential tables current when features change them.

## Versioning & Releases (automated — never bump versions by hand)
Every merge to master triggers `.github/workflows/release.yml`: it derives the semver bump from the **squash-commit subject (= the PR title)**, computes the next version from the **latest `v*` tag** (master is branch-protected — CI pushes only a tag, never commits; the repo's package.json version fields are placeholders, the tag is the source of truth), then the build jobs inject the version into their workspace via `scripts/bump-version.mjs set` before `pnpm package`, and publish the DMG + EXE on a GitHub Release.

**Bump rules (PR title):**
- `feat!:` / `fix!:` (any `<type>!:`) or `BREAKING CHANGE` in the body → **major**
- `feat:` → **minor**
- everything else (`fix|chore|docs|refactor`) → **patch**
- `[skip release]` anywhere in the title → merge without releasing (docs-only tweaks)

Consequences for Claude:
- **PR titles are load-bearing** — they choose the version bump. Keep the `<type>: description` convention exact.
- Never edit the `version` field in any package.json; never `git tag` or push tags by hand. Manual/off-cycle release: GitHub → Actions → Release → Run workflow (pick bump).
- CI builds bake no `_BUILTIN` keys (no `.env` in CI) — released installers need keys entered once in Settings → Developer.

### Changelog Format
One section per merged PR, newest first. Canonical structure:
```
## [PR #<n>] <type>: <concise description>
**Branch:** <branch> → master
**Date:** YYYY-MM-DD

### Context        (optional — why the change was needed)
### Added / ### Changed / ### Fixed / ### Removed / ### Notes   (only those that apply)
```
- `<type>` ∈ `feat | fix | chore | docs | refactor`.
- `[PR #<n>]` is the **real GitHub PR number** (squash-merge shows it as `(#n)` in the commit).
- Group all of a PR's changes under that single section — don't split one PR into multiple entries.

## Memory Protocol
When Nish gives feedback or states a preference, add it to **both**:
- `CLAUDE.md` (this file, committed — travels with the repo to all machines)
- Local auto-memory (per-machine, **not** committed). The dir is derived from the checkout path, so it differs per machine — Nish develops on both:
  - **macOS:** `~/.claude/projects/-Users-nishant-Code-desktop-dashboard/memory/`
  - **Windows:** `C:\Users\nish5\.claude\projects\C--Code-desktop-dashboard-desktop-dashboard\memory\`

  Prefer `CLAUDE.md` for anything that should follow the repo; use local auto-memory for machine-specific facts.
