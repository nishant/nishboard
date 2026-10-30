# Roadmap

## Ideas

- **Inbox widget** (2026-10-30): a widget that lists the PC inbox service's open items by severity, with ack, snooze and resolve, through the Fastify server (`127.0.0.1:8805/api/*`). Shows a quiet "Inbox is on the PC" state when the service is not reachable. Repos: inbox (read only), ui (event schema).
- **Inbox item actions** (2026-10-30): when `@nish/ui`'s inbox schema gains optional `actions` and the inbox service gains `POST /api/items/:id/actions/:actionId`, render each action as a button on the Inbox widget's rows and proxy the call through `/api/inbox/items/:id/actions/:actionId`.
