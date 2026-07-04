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
| Calendar | none (pure-JS date rendering) | none | n/a |
| YouTube | YouTube Data API v3 (search) + localhost embed proxy | YOUTUBE_API_KEY (~100 searches/day free) | on demand |
| Twitch | Twitch Helix (search) + localhost embed proxy | client-credentials app token (TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET) | on demand |
| News | Google News RSS (keyless) | none | 10min |
| Notes | none (Markdown scratchpad, localStorage) | none | n/a |
| Tasks | none (checklist, localStorage) | none | n/a |
| World Clock | none (pure-JS timezones, digital/analog) | none | n/a |
| Timer / Alarm | none (fires via notification IPC + Web Audio chime) | none | n/a |
| Countdown | none (target datetime, localStorage; fires via notification IPC) | none | n/a |

## Secrets & Credentials
Three places a key can live — checked in this order at runtime:
1. **Runtime env from safeStorage** — user-entered keys are encrypted with Electron `safeStorage` in `userData/credentials.json`, decrypted on launch, and injected as env vars into the spawned Fastify process. Saving in Settings restarts the server.
2. **Build-time baked values** — `packages/server/build.mjs` reads the root `.env` at package time and bakes each key into the server bundle via esbuild `--define` as `process.env.<KEY>_BUILTIN`. The *value* lands in the compiled bundle only — never in source or git (`.env` is gitignored). This is what lets a distributed DMG/EXE "just work". Each route reads runtime env first, then falls back to the `_BUILTIN` value.
3. **`.env`** — only loaded in local `pnpm dev` (dotenv). Never committed.

**Spotify OAuth tokens** are *not* in safeStorage — they're plain JSON at `~/.dash/spotify_tokens.json` (home dir, survives reinstalls). A refresh token is bound to the `client_id` that minted it; if the client_id changes, stale tokens fail refresh → Disconnect→Connect to reset.

## Embedding & Platform Gotchas
- **`file://` null origin** — the packaged renderer loads from `file://`, so `window.location.hostname` is empty. YouTube/Twitch embeds and Spotify's redirect validation all break under `file://`. Fix pattern: serve the embed HTML from `http://localhost:7432/api/<svc>/embed`, where the iframe parent is a valid HTTP origin (`localhost`).
- **Electron UA** — YouTube returns Error 153 for the Electron UA; the main process strips `Electron/x.x.x` from the session user-agent.
- **Spotify Dev Mode** — caps at 25 allowlisted users; a non-allowlisted account gets 403 on the API.
- Always label Windows-only vs macOS-only branches explicitly.

## Code Conventions
- Strict TypeScript — no `any`, no untyped `as` casts
- Named exports only (no default exports on hooks/stores)
- Components: `PascalCase` files
- Hooks: `use` prefix — e.g. `useSpotifyPlayer`
- Stores: `Store` suffix — e.g. `useStocksStore`
- API response types: `Data` suffix — e.g. `WeatherData`, `TrackData`
- API routes: lowercase kebab — `/api/spotify/now-playing`

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
