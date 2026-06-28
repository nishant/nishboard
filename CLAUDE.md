# Nishboard — Claude Instructions

> Full spec: [SPEC.md](./SPEC.md) — source of truth for widget behavior, polling intervals, API choices.

## What We're Building
Nishboard — a personal ambient desktop dashboard for Nish, running all day on a secondary monitor. Electron + React. Windows primary, macOS secondary. Personal use only.

> The GitHub repo is `nishboard` (`github.com/nishant/nishboard`). The local checkout folder may still be named `desktop-dashboard` on either machine — that's fine, it doesn't affect the build. Internal workspace package names keep the `@dash/*` prefix.

## Where Nish Works
Nish actively develops Nishboard on **both** machines and switches between them:
- **Windows** (primary dev + the box this runs on) — `C:\Code\desktop-dashboard\desktop-dashboard`
- **macOS** (secondary)

Keep all changes cross-platform. Label any Windows-only or macOS-only code paths explicitly (see Sound widget, `safeStorage`, port-kill on relaunch).

## Stack (non-negotiable)
- **Shell:** Electron (latest stable), TypeScript main process
- **Frontend:** React 18 + TypeScript strict, Vite, Tailwind CSS, shadcn/ui, Zustand, TanStack Query v5, Recharts
- **Backend:** Fastify + TypeScript, runs as child process on localhost:7432
- **Monorepo:** Turborepo + pnpm workspaces
- **Packages:** `apps/renderer`, `apps/main`, `packages/server`, `packages/shared`

## Architecture Rules
- All external API calls go through Fastify — never directly from renderer
- Secrets in `.env`, loaded only by Fastify server
- Electron `safeStorage` for OAuth tokens (Spotify)
- Renderer ↔ Fastify: HTTP on localhost:7432
- Renderer ↔ Electron main: contextBridge IPC with typed wrappers only
- Shared types live in `packages/shared` — import from there, never redefine

## Build & Run
- `pnpm dev` — Vite + Fastify + Electron concurrently (renderer on :5173, server on :7432)
- `pnpm build` — `turbo build` across all workspaces
- `pnpm package` — `pnpm build` → `prepare-wincodesign.cjs` → electron-builder. Output: `release/Nishboard Setup <ver>.exe` (NSIS, unsigned — SmartScreen shows "More info → Run anyway"). `asar: false`, so the Fastify server is spawned from disk as a child process.
- **Key baking:** at package time, `packages/server/build.mjs` reads the root `.env` and bakes the API keys into the server bundle via esbuild `--define` (the `*_BUILTIN` fallbacks). The `.env` is **never** shipped. At runtime, routes prefer Settings/`safeStorage` values and fall back to the baked-in ones — so a distributed build works out of the box but users can still override. Put the `.env` at the repo root **before** running `pnpm package`.

## Widgets & APIs
| Widget | API | Key | Interval |
|---|---|---|---|
| Weather | Open-Meteo | none | 15min |
| Spotify | Spotify Web API | PKCE OAuth (`SPOTIFY_CLIENT_ID`) | 3s REST |
| Stocks | Alpaca Markets WebSocket (IEX) | ALPACA_API_KEY + ALPACA_API_SECRET | real-time / 5s fallback |
| Hardware | systeminformation | none | 1s |
| Sound | PowerShell (Win) / osascript (mac) | none | 5s |
| Calendar | local (system clock) | none | renders current month, no fetch |
| Twitch | Twitch Helix | TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET | 60s staleTime (stream on/offline) |
| YouTube | YouTube Data API v3 | YOUTUBE_API_KEY | 5min staleTime |

> Twitch & YouTube players are served through the Fastify proxy (`/api/twitch/embed`, `/api/youtube/...`) so the embed origin is `localhost`, not the renderer's `file://`. Don't point iframes straight at the providers in the packaged app.

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
2. **Update CHANGELOG.md** on the branch before opening the PR. New entries go at the top (newest first). Cover every meaningful change and architectural decision.
3. **Commit, push, `gh pr create`** — in that order. **Do NOT auto-merge** — wait for Nish to explicitly say "merge".
4. Branch naming: `feat/<slug>` for features, `fix/<slug>` for fixes.

## Memory Protocol
When Nish gives feedback or states a preference, add it to **both**:
- `CLAUDE.md` (this file, committed — travels with the repo to all machines)
- Local auto-memory (per-machine, **not** committed). The dir is derived from the checkout path, so it differs per machine:
  - **Windows:** `C:\Users\nish5\.claude\projects\C--Code-desktop-dashboard-desktop-dashboard\memory\`
  - **macOS:** `~/.claude/projects/-Users-nishant-Code-desktop-dashboard/memory/`

  Since Nish works on both machines, prefer `CLAUDE.md` for anything that should follow the repo; use local auto-memory for machine-specific facts. If you re-clone into a differently-named folder, the slug changes to match the new path.
