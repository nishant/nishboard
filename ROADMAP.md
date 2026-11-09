# Roadmap

Open work only. Delete an entry in the PR that finishes it; git history is the record.

## Ideas

- Server log: give each server child its own log stream, so a respawn never interleaves with the previous child's output (audit NISHBOARD-002 follow-up).
- PowerShell/osascript spawns: apply the same env filter as `buildChildEnv` (they still inherit the full server env).
- Claude permission card: have the server send an explicit `truncated` flag instead of the client matching the `...truncated` marker.

## Audit 2026-11-08 follow-ups

The overnight audit's high findings shipped in #190. Its 70 medium, 169 low and 32 nit findings are still open (the full list with file:line and fixes is in Nish's local audit report, `C:\Code\.audit\2026-11-08\nishboard.md`). The main groups:

- Main process: close-to-tray blocks Windows shutdown; `isDev` comes from `NODE_ENV`; the default session has no permission handlers; the clipboard poller outlives its window and records concealed (password-manager) clips; storage-migration retry can overwrite newer `app://` data; an updater error after download hides "Restart to update"; macOS `killStaleOnPort` kills non-listeners.
- Renderer robustness: no per-widget error boundary; no fetch timeout in `apiClient`; layout rehydrate does not validate widget ids; presets re-add disabled widgets and ignore collapse state; a fresh install shows every widget instead of the Default preset; the timers rehydrate sweep repeats its notice and runs in popouts; popped-out tiles still mount header actions.
- Claude widget: remote images in Markdown output; whole-transcript Markdown re-render per token; Auto mode is one Shift+Tab away and persists; Esc on a popover stops the stream; is_error results end silently; a quick follow-up hits the 409 single-flight; the transcript is unbounded in localStorage and goes into backups.
- Discord: the popout starts a second guest; native feed never reconnects; message frames reach every SSE stream; voice-channel adoption races; pipe payload errors can crash the server.
- Server: the 1s hardware poll spawns about 11 PowerShell processes a second, and Windows disk I/O always reads 0; `si.networkStats()` is shared between routes; macOS sound calls have no timeout; Twitch followed-live is capped at 20; the weather cache TTL equals the poll interval; a failed YouTube durations call throws away a paid search; `cmd.exe /c` shim quoting; `build.mjs` `.env` parsing differs from dotenv, and it bakes `ALPACA_API_SECRET` into local installers.
- Widgets: keyboard seeking and keyboard sliders do not commit; Spotify optimistic updates race the poll and errors show as "Nothing playing"; stock market status ignores holidays; Notes preview links do nothing or navigate the app; the Notes tab strip is not keyboard-navigable; widget header actions are 20px and hover-only.
- Build, CI and docs: Dependabot Electron bumps never reach `electronVersion`; `buildChunks.test.ts` never runs in CI; the release jobs keep a write token while running install scripts; `app-themes.css` is stale (missing `--nish-line-control`); SPEC.md's IPC table and source-of-truth note are stale, and so is the `package-app.mjs` comment.
