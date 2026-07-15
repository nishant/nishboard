<div align="center">

# 🖥️ Nishboard

### A personal ambient desktop dashboard — weather, music, markets, and machine vitals, all day on your second monitor.

[![Electron](https://img.shields.io/badge/Electron-33-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-build-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-:7432-000000?style=for-the-badge&logo=fastify&logoColor=white)](https://fastify.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Turborepo](https://img.shields.io/badge/Turborepo-monorepo-EF4444?style=for-the-badge&logo=turborepo&logoColor=white)](https://turbo.build/)
[![pnpm](https://img.shields.io/badge/pnpm-11-F69220?style=for-the-badge&logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS-2ea44f?style=for-the-badge)](#-building--distributing)
[![License](https://img.shields.io/badge/license-personal%20use-lightgrey?style=for-the-badge)](#-license)

</div>

> **Nishboard** is a frameless Electron + React app built to run all day on a secondary monitor. It glances at the things you keep half-watching — the weather, what's playing on Spotify, your watchlist, CPU/GPU load, who's live on Twitch — without you ever alt-tabbing. Windows is the primary target, macOS the secondary. It's a personal project, not a product.

---

## 📑 Table of Contents

- [✨ Features](#-features)
- [🧱 Tech Stack](#-tech-stack)
- [🗂️ Monorepo Layout](#️-monorepo-layout)
- [🏗️ Architecture](#️-architecture)
- [🚀 Getting Started](#-getting-started)
- [⚙️ Configuration](#️-configuration)
- [📜 Scripts](#-scripts)
- [📦 Building & Distributing](#-building--distributing)
- [🤖 CI & Releases](#-ci--releases)
- [🧭 Conventions](#-conventions)
- [⚠️ Gotchas](#️-gotchas)
- [📁 Project Structure](#-project-structure)
- [📄 License](#-license)

---

## ✨ Features

| Widget | What it shows | Data source |
|---|---|---|
| 🌤️ **Weather** | Current conditions, hourly strip, 5-day forecast, severe-weather alerts | Open-Meteo + NWS alerts (location via IP, or a ZIP override) |
| 🎧 **Spotify** | Now playing, transport controls, ♥ save/unsave, playlists + Liked Songs + Recently Played, search, devices | Spotify Web API (PKCE OAuth) — *remote control*¹ |
| 📈 **Stocks** | Editable watchlist, % change, sparklines, market session; click a ticker for an intraday/daily chart + headlines | Alpaca Markets IEX (REST snapshots + Benzinga news) |
| 🧮 **Hardware** | CPU / GPU / RAM / disk / network as bars or live sparklines | `systeminformation` (nvidia-smi / WASAPI under the hood) |
| 🔊 **Sound** | Master volume, mute, output switching, per-app mixer (Windows) | `osascript` (mac) / PowerShell + WASAPI (Windows) |
| 📅 **Calendar** | Month grid + Google Calendar: event dots, click a day for its events, inline quick-add | Google Calendar API (shares the YouTube OAuth client) |
| ▶️ **YouTube** | Search, Trending/Music/Gaming, and — signed in — your Subs feed, Playlists, Liked; click any channel name for its uploads; watch inline; optionally hide Shorts across every tab, or switch the Subs tab to a plain channel list (click a channel for its uploads) — both in Settings → App | YouTube Data API v3 + Google OAuth + localhost embed proxy |
| 🟣 **Twitch** | Search channels; signed in: Live + All followed channels, go-live notifications; watch inline | Twitch Helix (app token + user OAuth) + localhost embed proxy |
| 📰 **News** | Rotating headline ticker, click to open the article | Google News RSS — no key |
| 📝 **Notes** | Markdown scratchpad, edit ↔ rendered toggle | Local (localStorage) |
| ✅ **Tasks** | Quick checklist — add, check off, clear completed | Local (localStorage) |
| 🕐 **World Clock** | Multiple timezones, digital or analog faces | Pure JS — no API |
| ⏱️ **Timer & Alarm** | Countdown timers + wall-clock alarms with a native notification | Local + notification IPC |
| 🎯 **Countdown** | Days/hours remaining to a target datetime | Local (localStorage) |
| 🪙 **Crypto** | Coin watchlist — price, 24h change, 7-day sparkline | CoinGecko (optional key) |
| 🚀 **Launcher** | App + link launcher with groups, launch-all, real icons | Local (typed IPC, targets stored main-side) |
| 📋 **Clipboard** | Rolling text-clipboard history (in-memory, never persisted) | Electron clipboard poller (only while visible) |
| 📶 **Net Monitor** | Per-host latency / jitter / packet-loss + up/down throughput sparklines | System `ping` via a server-side sampler + `systeminformation` |
| 🤖 **Claude** | Chat with Claude — streaming replies, GFM markdown, multi-turn context, thinking blocks, animated status shimmer. **Interactive prompts**: in **Ask** mode writes/commands pop Allow/Deny cards (reads run freely), the model can ask you **multiple-choice questions**, and **Plan** mode ends with an Approve-plan card — with a chime + native notification when Claude blocks on you. Composer: **Ask / Auto / Plan** switch, **model picker + effort slider**, `/` **slash & skill autocomplete**, **usage popover** (5h session + weekly + context meter). Workspace + extra folders configurable in Settings → Claude | Your installed **Claude Code CLI** (bills your claude.ai plan, not API keys) |
| 💬 **Discord** | The **real Discord**, embedded whole — servers, DMs & group chats, replying, **voice channels**, and **screen sharing** with an in-widget screen/window picker (system audio shared on Windows). Log in once inside the widget and the session persists — switching layouts, collapsing, or unpinning never logs you out or drops a voice call (the embed lives for the whole app session); mention-count badge from the tab title; header actions for Home/Reload/Sign out. **Native mode** (header toggle, persisted): drives your RUNNING Discord **desktop app** over its local RPC — browse servers & channels, a **read-only live chat feed**, **join/leave voice channels**, **mute/deafen**, see who's in voice with **green speaking rings**, and a "Reply in Discord" button that jumps the desktop client to the channel | Embed: Discord web app in an Electron `<webview>` (own `persist:discord` session) — **no keys, no bot, no API setup**. Native: your own Discord application's client id/secret + the desktop app running |

Everything lives on a **draggable, resizable grid** (react-grid-layout) with built-in presets, saveable custom layouts — either kind pinnable to the titlebar for one-click switching — and 15 themes plus a custom theme editor. The **Widgets menu groups every widget into categories** (Media / Feeds / Productivity / System / AI) with hover arrows to reorder rows within a category, and any widget can be **disabled entirely** from Settings → App → Widgets — it vanishes from the menu, the grid, and the command palette until re-enabled. Any widget **collapses accordion-style to just its title bar** (chevron in the header) and the state persists across restarts — collapsing hands its space to the widget directly below and expanding takes it back, so the rest of the grid stays exactly where it was. The **Ctrl/Cmd+K command palette** understands typed commands with arguments — `timer 1h5m3s tea`, `alarm 7:30am`, `task buy milk`, `volume 40`, `ticker AAPL`, `zone tokyo` — alongside fuzzy search over every action.

> ¹ Spotify is a **remote control**, not a player — stock Electron has no Widevine CDM, so it can't decode DRM audio. It drives playback on a device you already have open (phone, desktop app, etc.).

---

## 🧱 Tech Stack

| Layer | Tech |
|---|---|
| **Shell** | Electron 33 (frameless), TypeScript main process |
| **Frontend** | React 18 · Vite · Tailwind CSS · shadcn/ui · Zustand · TanStack Query v5 · Recharts |
| **Backend** | Fastify + TypeScript, spawned as a child process on `localhost:7432` |
| **Monorepo** | Turborepo + pnpm workspaces |
| **Language** | TypeScript everywhere, strict mode — no `any`, no untyped casts |

---

## 🗂️ Monorepo Layout

Four workspaces, each with a single responsibility:

| Package | Responsibility |
|---|---|
| **`apps/main`** | Electron main process — `BrowserWindow`, preload/`contextBridge`, IPC handlers, spawning + restarting the Fastify server |
| **`apps/renderer`** | The React UI — widgets, stores, the grid, theming |
| **`packages/server`** | Fastify API on `:7432` — **the only place that talks to external APIs or touches secrets** |
| **`packages/shared`** | Shared TypeScript types — the single source of truth, imported by everyone, never redefined |

> In dev, Vite and the `tsc` path aliases point `@dash/shared` straight at its TypeScript source, so there's no separate build step for shared types while iterating.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Electron main · apps/main                                    │
│ frameless window · spawns Fastify · typed IPC host           │
└────────────────────────────┬─────────────────────────────────┘
                             │  loads the renderer
                             ▼
┌──────────────────────────────────────────────────────────────┐
│ Renderer · apps/renderer                                     │
│ React + TanStack Query · apiClient.get / post                │
│ talks to main via typed window.electron.*                    │
└────────────────────────────┬─────────────────────────────────┘
                             │  HTTP · localhost:7432
                             ▼
┌──────────────────────────────────────────────────────────────┐
│ Fastify server · packages/server                             │
│ the ONLY layer that calls external APIs / holds secrets      │
└────────────────────────────┬─────────────────────────────────┘
                             ▼
     Open-Meteo · Spotify · Alpaca · YouTube · Twitch · OS audio
```

**Rules that never bend:**

- The renderer **never** calls an external API or sees a secret directly — everything routes through Fastify.
- Renderer ↔ main is **typed contextBridge IPC only** (`window.electron.*`), never raw `ipcRenderer`.

**Where secrets live** (checked in this order at runtime):
1. **safeStorage** — user-entered keys are encrypted with Electron `safeStorage` in `userData/credentials.json`, decrypted on launch, and injected as env vars into the spawned server. Saving in Settings restarts the server.
2. **Build-time baked values** — `packages/server/build.mjs` bakes `.env` values into the server bundle at package time as a single esbuild-defined JSON blob (`BUILTINS_JSON`). The *values* land in the compiled bundle only — never in source or git. This is what lets a distributed DMG/EXE "just work".
3. **`.env`** — loaded only in local `pnpm dev`. Gitignored.

**User OAuth tokens** (Spotify, Twitch, YouTube) are stored separately as plain JSON at `~/.dash/<service>_tokens.json` (home dir, survives reinstalls).

**Embed proxy** — the packaged app loads from `file://`, which breaks origin checks. YouTube/Twitch players are served from `http://localhost:7432/api/<svc>/embed`, giving the iframe a valid HTTP parent origin.

---

## 🚀 Getting Started

**Prerequisites**

- **Node.js ≥ 20**
- **pnpm 11.3.0** — `corepack enable && corepack prepare pnpm@11.3.0 --activate`

**Install & run**

```bash
git clone <repo-url>
cd nishboard
pnpm install

cp .env.example .env      # then fill in your API keys (see Configuration)

pnpm dev                  # builds shared types, then runs everything
```

`pnpm dev` builds `@dash/shared`, then launches the server, renderer, and Electron together (color-coded output). The window opens automatically once the Vite dev server and Fastify are up.

---

## ⚙️ Configuration

All keys are optional to *start* the app — each widget degrades gracefully if its key is missing. Copy `.env.example` → `.env` and fill what you want.

| Variable | Used by | Required? | Where to get it |
|---|---|---|---|
| `SPOTIFY_CLIENT_ID` | Spotify | for Spotify | [developer.spotify.com](https://developer.spotify.com/dashboard) → create an app |
| `SPOTIFY_CLIENT_SECRET` | Spotify | optional (PKCE doesn't need it) | same app |
| `SPOTIFY_REDIRECT_URI` | Spotify | yes (exact match) | set to `http://127.0.0.1:7432/api/spotify/callback` **and** register that exact URI in the Spotify app |
| `ALPACA_API_KEY` / `ALPACA_API_SECRET` | Stocks | for Stocks | [alpaca.markets](https://alpaca.markets/) → free IEX data keys |
| `ALPACA_BASE_URL` | Stocks | preset | `https://data.alpaca.markets/v2` |
| `YOUTUBE_API_KEY` | YouTube | for search/browse | Google Cloud Console → YouTube Data API v3 |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | YouTube + Calendar | for the signed-in tabs / calendar events | Google Cloud Console → OAuth client (Web application), redirects `http://localhost:7432/api/youtube/callback` **and** `http://localhost:7432/api/calendar/callback`; enable the YouTube Data + Google Calendar APIs¹ |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Twitch | for Twitch | [dev.twitch.tv/console](https://dev.twitch.tv/console) → register an app, redirect `http://localhost:7432/api/twitch/callback`² |
| `COINGECKO_API_KEY` | Crypto | optional | [coingecko.com](https://www.coingecko.com/en/developers/dashboard) demo key — keyless works but throttled |
| `GITHUB_TOKEN` | update check | optional | fine-grained PAT, read-only Contents — only needed while the repo is private |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude | optional | only if Claude Code isn't logged in on the machine — `claude setup-token`. **Never baked into builds** (personal account token); the widget otherwise just uses your local `claude /login` session |
| `SERVER_PORT` | server | preset | `7432` |

> **Spotify redirect URI is exact-match.** Spotify's form rejects `localhost` for some apps, so this project uses the `127.0.0.1` form — whatever you put in `.env` must match the dashboard registration character-for-character.
>
> ¹ Publish the Google OAuth consent screen to **In production** (unverified is fine for personal use) — apps left in *Testing* get refresh tokens that expire every 7 days.
>
> ² Twitch search uses an app token; the Following tabs use user OAuth via that redirect. Twitch only permits `http` for the literal host `localhost` (not `127.0.0.1`).

**Two ways to supply keys:** enter them in **Settings → Developer** at runtime (encrypted via `safeStorage`), or bake them at package time from `.env` so a distributed build needs no setup. See [Architecture](#️-architecture).

---

## 📜 Scripts

Run from the repo root:

| Command | What it does |
|---|---|
| `pnpm dev` | Builds `@dash/shared`, then runs **shared + server + renderer + main** concurrently (color-coded). Your everyday command. |
| `pnpm build` | `turbo build` across every package (type-checks + bundles). |
| `pnpm package` | `build` → `scripts/prepare-wincodesign.cjs` → `electron-builder`. Produces a distributable DMG/EXE (unsigned, `CSC_IDENTITY_AUTO_DISCOVERY=false`). |
| `pnpm typecheck` | `turbo typecheck` — `tsc --noEmit` everywhere. |
| `pnpm lint` | `turbo lint`. |

**Per-workspace** (handy when iterating on one piece):

```bash
pnpm --filter @dash/server   dev   # tsx watch  — Fastify only
pnpm --filter @dash/renderer dev   # vite       — UI only
pnpm --filter @dash/main     dev   # tsc-watch → electron
pnpm --filter @dash/shared   dev   # tsc --watch — rebuild shared types
```

---

## 📦 Building & Distributing

```bash
pnpm package
```

Artifacts land in `release/`. Both targets are **unsigned** (no code-signing certs).

> **Build archive:** every locally-packaged installer is uploaded to a Google Drive builds folder via an [rclone](https://rclone.org) remote (`nishboard-builds`) → `rclone copy "release/<installer>" nishboard-builds: -P`. One-time `rclone config` (Google OAuth) sets up the remote.

### 🍎 macOS
- Output: `release/Nishboard-0.1.0-arm64.dmg` (APFS, arm64).
- First launch is Gatekeeper-blocked because it's unsigned → **right-click the app → Open** (one-time).

### 🪟 Windows (Microsoft / NSIS)
- Output: `release/Nishboard Setup 0.1.0.exe` (NSIS installer).
- **SmartScreen** will warn on an unsigned installer: **"Windows protected your PC" → More info → Run anyway.**
- **Non-admin builds are supported.** `electron-builder` normally extracts `winCodeSign` (which contains macOS dylib *symlinks*), and creating symlinks on Windows needs admin/Developer Mode — so the build would abort for a normal user. `scripts/prepare-wincodesign.cjs` runs first and extracts the archive with `-xr!darwin`, skipping the symlink entries entirely.

### Packaging notes
- **`asar: false`** — the Fastify server is spawned from disk as a child process and can't run from inside an `.asar` archive, so app files stay unpacked.
- **`electronVersion` is pinned** in `electron-builder.yml` because Electron lives in `apps/main/node_modules` (a workspace), not the repo root, where the builder would otherwise look.

---

## 🤖 CI & Releases

Two GitHub Actions workflows (`.github/workflows/`):

| Workflow | Trigger | What it does |
|---|---|---|
| **CI** (`ci.yml`) | every PR + push to master | `pnpm typecheck` + `lint` + full `turbo build` |
| **Release** (`release.yml`) | every merge to master | derives the semver bump from the PR title, tags `vX.Y.Z` (tag-only — master is protected; the tag, not package.json, is the version source of truth), builds the macOS DMG + Windows EXE, publishes a GitHub Release |

**Versioning is fully automated — never bump by hand.** The squash-commit subject (= PR title) picks the bump:

| PR title | Bump |
|---|---|
| `feat!: …` / any `<type>!:` / `BREAKING CHANGE` in body | major |
| `feat: …` | minor |
| `fix:` / `chore:` / `docs:` / `refactor:` / anything else | patch |
| contains `[skip release]` | no release |

Manual/off-cycle release: **Actions → Release → Run workflow** (choose the bump). Hand-pushed tags no longer trigger anything.

CI-built installers carry **no baked API keys** (there's no `.env` in CI) — enter keys once in Settings → Developer. Locally-built (`pnpm package`) installers bake whatever is in your `.env`. The in-app update check (Settings → About) polls the latest GitHub Release and offers a direct download of the right installer for your platform.

---

## 🧭 Conventions

- **Branch first.** `git checkout -b <branch>` before touching any files — never edit `master` then branch.
- **Naming:** `feat/<slug>` · `fix/<slug>` · `chore/<slug>` · `docs/<slug>`.
- **Update `CHANGELOG.md` before every PR.** One section per PR, newest first, following the canonical `## [PR #N] type: description` format (see [CLAUDE.md](./CLAUDE.md) → *Changelog Format*).
- **No auto-merge.** Open the PR and stop — wait for an explicit "merge".
- **PR titles are load-bearing** — they pick the release bump (see [CI & Releases](#-ci--releases)). Keep the `<type>: description` format exact.
- **Strict TypeScript**, named exports, `PascalCase` components, `use*` hooks, `*Store` stores, `*Data` API types, kebab API routes.

---

## ⚠️ Gotchas

- **Spotify Development Mode caps at 25 allowlisted users** — a non-allowlisted account gets a 403. Add accounts under your Spotify app → *User Management*.
- **Stale Spotify token after a client_id change** — refresh tokens are bound to the client_id that minted them; if it changes, hit **Disconnect → Connect** (or delete `~/.dash/spotify_tokens.json`).
- **YouTube** needs the Electron UA stripped (done automatically) plus the localhost embed proxy; the Data API free tier is ~100 searches/day.
- **macOS GPU usage** isn't available on Apple Silicon via `systeminformation`; **audio device switching** needs `brew install switchaudio-osx`.
- **Windows audio device switching** needs `Install-Module AudioDeviceCmdlets` (volume/mute work without it via WASAPI).
- **Alpaca IEX** covers US equities only — no futures or crypto.

---

## 📁 Project Structure

```
nishboard/
├── apps/
│   ├── main/              # Electron main: BrowserWindow, preload, IPC, server spawn
│   │   └── src/
│   │       ├── index.ts          # window + session setup
│   │       ├── preload.ts        # contextBridge API
│   │       ├── ipc/              # app:* and spotify:* handlers
│   │       ├── credentials.ts    # safeStorage read/write
│   │       └── server/spawn.ts   # spawn + killStaleOnPort
│   └── renderer/          # React UI
│       └── src/
│           ├── components/       # Titlebar, DashboardGrid, WidgetShell, SettingsModal
│           ├── widgets/          # weather, spotify, stocks, hardware, sound, calendar, youtube, twitch, news, notes, tasks, worldclock, timer, countdown, crypto, launcher, clipboard, claude, discord, embed (shared search+player frame)
│           ├── store/            # Zustand stores (layout, theme, …)
│           ├── lib/              # layouts.ts (grid engine), apiClient, utils
│           └── index.css         # theme tokens + global styles
├── packages/
│   ├── server/            # Fastify API on :7432
│   │   ├── src/routes/           # one file per widget
│   │   └── build.mjs             # esbuild bundle + build-time key baking
│   └── shared/            # shared TypeScript types
├── .github/workflows/     # ci.yml (checks) + release.yml (auto semver + installers)
├── build/                 # app icons
├── scripts/               # prepare-wincodesign.cjs, bump-version.mjs
├── electron-builder.yml   # packaging config (DMG + NSIS)
├── turbo.json             # build pipeline
├── CLAUDE.md              # project + workflow instructions
└── CHANGELOG.md           # per-PR history
```

---

## 📄 License

Personal use. Built by and for Nish — not currently licensed for redistribution.
