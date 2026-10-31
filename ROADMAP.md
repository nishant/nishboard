# Roadmap

## Ideas

- ~~**Inbox widget** (2026-10-30): a widget that lists the PC inbox service's open items by severity, with ack, snooze and resolve, through the Fastify server (`127.0.0.1:8805/api/*`). Shows a quiet "Inbox is on the PC" state when the service is not reachable. Repos: inbox (read only), ui (event schema).~~ Done 2026-10-30, nishant/nishboard#149.
- ~~**Inbox item actions** (2026-10-30): render the inbox's per-item `actions` as buttons through `/api/inbox/items/:id/actions/:actionId`.~~ Done 2026-10-31, nishant/nishboard#149 (inbox side: nishant/inbox#2; types match `@nish/ui` v0.10.0).
