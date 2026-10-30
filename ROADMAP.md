# Roadmap

## Ideas

- ~~**Inbox widget** (2026-10-30): a widget that lists the PC inbox service's open items by severity, with ack, snooze and resolve, through the Fastify server (`127.0.0.1:8805/api/*`). Shows a quiet "Inbox is on the PC" state when the service is not reachable. Repos: inbox (read only), ui (event schema).~~ Done 2026-10-30, nishant/nishboard#149.
- **Inbox item actions** (2026-10-30): built in nishant/nishboard#149 against S5's contract (optional `actions`/`lastAction`, `POST /api/items/:id/actions/:actionId`). Left: once the inbox service with actions is live on the PC, click one real action in the widget, and switch the mirrored types in `packages/shared/src/types/inbox.ts` to match the released `@nish/ui` `InboxAction`/`InboxActionResult` if they differ.
