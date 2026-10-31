# Roadmap

## Ideas

- **Modernise Nishboard** (2026-10-31, audit item 21 + nishboard parts of 13/18/19): Electron 45 with electron-updater auto-update (draft → build → publish releases with `SHA256SUMS`), responsive grid (1 column under 600px, 2–3 to 1200px), saved and on-screen window bounds, encrypted OAuth tokens, renderer CSP and no shipped source maps, `@nish/ui` CommandPalette/Inbox/LineChart instead of hand-built ones, lazy widgets, one long-lived PowerShell for Sound, 5s network polling, second-launch and semver fixes. Spec: `docs/specs/modernise.md`.
- ~~**Inbox widget** (2026-10-30): a widget that lists the PC inbox service's open items by severity, with ack, snooze and resolve, through the Fastify server (`127.0.0.1:8805/api/*`). Shows a quiet "Inbox is on the PC" state when the service is not reachable. Repos: inbox (read only), ui (event schema).~~ Done 2026-10-30, nishant/nishboard#149.
- ~~**Inbox item actions** (2026-10-30): render the inbox's per-item `actions` as buttons through `/api/inbox/items/:id/actions/:actionId`.~~ Done 2026-10-31, nishant/nishboard#149 (inbox side: nishant/inbox#2; types match `@nish/ui` v0.10.0).
