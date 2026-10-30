# Inbox widget

Status: in progress · Slug: inbox-widget · Date: 2026-10-30 · Size: medium
Repos: nishboard (spec lives here). Reads only: nishant/inbox (API), nishant/ui (`@nish/ui/inbox-client` types, v0.9.2)
ROADMAP: `ROADMAP.md` → "Inbox widget"

## Goal
Nish's PC runs the inbox service (`nishant/inbox`, loopback `127.0.0.1:8805`) that collects events from every app. Nishboard gets an **Inbox** widget that lists the open items grouped by severity, with **Ack**, **Snooze** and **Resolve** on each row. Nishboard's Fastify server is the only thing that talks to the inbox (`/api/*` only, never `/ingest/*`). On the Mac (no inbox service) the widget shows a quiet "Inbox is on the PC" state instead of an error.

1. `GET /api/inbox/items` on the Fastify server returns the inbox's list (open / snoozed / handled) or a state of `offline`, `no-password` or `bad-password`, always HTTP 200 for those states.
2. `POST /api/inbox/items/:id/{handle,unhandle,snooze,unsnooze}` and `POST /api/inbox/items/handle-all` proxy to the inbox.
3. The Inbox widget lists items grouped Urgent → Normal → Info, with Ack / Snooze / Resolve per row, Snoozed and Handled views with Unsnooze / Move back.
4. Unreachable inbox → quiet "Inbox is on the PC" empty state; missing or wrong password → an empty state with an "Open Settings" button.
5. `INBOX_PASSWORD` is a write-only credential in Settings → Developer (service "Inbox").

## Out of scope
- Item `actions` buttons (S5 has not landed them in `@nish/ui` v0.9.2 or the inbox service): ROADMAP entry "Inbox item actions".
- Inbox settings (quiet hours, digest, push subscriptions), source muting, desktop notifications for new items.
- Any change to nishant/inbox or nishant/ui.
- Calling `/ingest/*` ever.

## Decisions
- **Auth = the inbox's own password login.** The inbox API needs the `inbox_session` cookie from `POST /api/login {password}`. Fastify logs in with `cred('INBOX_PASSWORD')`, keeps the cookie **in memory only** (never on disk, never logged, never sent to the renderer), and logs in again once on a 401. Login is single-flight (the inbox allows 10 wrong passwords a minute per IP).
- **`INBOX_PASSWORD` is NOT baked by `build.mjs`** (not in `BUILTIN_KEYS`): a personal password, same reasoning as `CLAUDE_CODE_OAUTH_TOKEN`. Settings → Developer only. (default)
- **No Origin header, Host `127.0.0.1:8805`.** The inbox refuses any request with `Origin` or a non-loopback Host. Node's global `fetch` sends neither Origin nor a foreign Host, so use plain `fetch` to `http://127.0.0.1:8805/api/...`. Never forward the renderer's headers.
- **Base URL constant** `INBOX_API = 'http://127.0.0.1:8805/api'` in `lib/inboxClient.ts`; overridable only by env `INBOX_API_URL` (tests, dev). Not a credential. (default)
- **Offline detection:** any fetch rejection (ECONNREFUSED, DNS, abort) or a 2s timeout (`AbortSignal.timeout(2000)`) = `offline`. 5xx from the inbox = HttpError 502 with its message.
- **"Ack" is local to Nishboard.** The inbox has no ack concept. Ack = "seen, leave it open": stored in a persisted renderer store as `{ [itemId]: countAtAck }`. Acked rows render dimmed and sort after unacked rows within their severity group. If the item's `count` grows past the acked count (it happened again), the ack lapses automatically. Ack again = un-ack (toggle). Ids no longer in the open list are pruned. (default)
- **"Resolve" = inbox `handle`** (`handledBy: 'user'`). **"Snooze"** = inbox `snooze {until}` with the same four options as `@nish/ui`'s Inbox page: 1 hour, 4 hours, Tomorrow 8 AM, Monday 8 AM.
- **Compact widget list, not the shared `<Inbox>` page component**: `@nish/ui`'s `Inbox` is a page-sized Card (px-4 rows, viewport-based `wide` breakpoint) and has no ack. The widget builds dense rows from `@nish/ui` primitives (`StatusDot`, `IconButton`, `DropdownMenu`, `MenuItem`, `Chip`, `ChipGroup`, `EmptyState`, `SkeletonLines`, `Button`, `RelativeTime`) to match sibling widgets.
- **Shared types mirror `@nish/ui`'s `InboxItem` / `InboxListResponse`** in `packages/shared/src/types/inbox.ts` (the server does not depend on `@nish/ui`; CLAUDE.md: shared types live in `packages/shared`).
- **Polling:** 60s via `useGatedInterval(60_000)`, `staleTime` 30s. Offline also polls at 60s (cheap loopback refusal) so the widget wakes up when the service starts. (default)
- **Widget id `inbox`, title "Inbox", category `feeds`**, constraints `{ minW: 3, minH: 2 }`, popout default size 380×480. Not added to any preset (keeps preset gap-free proofs untouched).
- **Links** open with `window.electron?.openExternal?.(url)` (same as the News widget), only for `http:`/`https:` urls.

## Current state
- Server plugins register in `packages/server/src/app.ts` (`server.register(xRoutes, { prefix: '/api/x' })`). Errors: throw `HttpError(status, msg)` from `lib/http.ts`; the central handler maps it. `cred(key)` in `lib/env.ts`.
- Tests: `packages/server/src/routes/*.integration.test.ts` use `buildServer({ logger: false })` + `app.inject` and `stubFetch` / `jsonRes` / `textRes` from `src/test/fetchStub.ts` (URL-substring routing; unmatched URL throws). For Set-Cookie, build a `new Response(null, { status: 204, headers: { 'set-cookie': '...' } })` and read with `res.headers.getSetCookie()`.
- Credentials: `packages/shared/src/types/credentials.ts` (`CREDENTIAL_KEYS` whitelist + `CREDENTIAL_DEFS`, grouped by `service` in `SettingsModal`). Main's safeStorage injection iterates `CREDENTIAL_KEYS`, so adding the key is enough.
- Shared exports: `packages/shared/src/index.ts` (type-only re-exports per file).
- Renderer: widget registry `apps/renderer/src/components/DashboardGrid.tsx` (`WIDGET_REGISTRY`), ids/titles/categories/constraints `apps/renderer/src/lib/layouts.ts` (`WidgetId`, `ALL_WIDGET_IDS`, `WIDGET_TITLES`, `WIDGET_CATEGORIES` (each id in exactly one, unit-tested), `WIDGET_CONSTRAINTS`). Popout sizes `apps/main/src/popout.ts` `DEFAULT_SIZES`.
- Widget pattern to copy: `apps/renderer/src/widgets/crypto/` (`useCrypto.ts` with `useQuery` + `apiClient` + `useGatedInterval`, `CryptoWidget.tsx` with `CryptoActions` header actions using `HeaderAction` and `RefreshAction` from `components/`). Widget error state: `components/ErrorState.tsx` (`message`, `queryKey`). Toasts: `toast(title, body?, 'error')` from `lib/alerts`. Settings opener: `useOverlayStore.getState().openSettings('dev')`.
- `apiClient.get/post` (`lib/apiClient.ts`) throw `Error(serverErrorMessage)` on non-2xx.
- Persisted stores: zustand `persist` with a `name` like `dashboard-<x>`, tests seed localStorage `{state, version}` then `vi.resetModules()` + dynamic import (see `store/discordUiStore.test.ts`).
- Theming: role classes only (`text-th-hi|hi2|hi3`, `bg-th-surface`, …), `text-2xs`/`text-3xs`, `IconButton size="2xs"` for small row buttons. No raw palette colors.

## Design

### Data (`packages/shared/src/types/inbox.ts`)
```ts
export type InboxSeverityData = 'info' | 'normal' | 'urgent';
export type InboxViewData = 'open' | 'snoozed' | 'handled';

/** Mirrors @nish/ui InboxItem (v0.9.2). Times are ISO strings. */
export interface InboxItemData {
  id: number;
  source: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  severity: InboxSeverityData;
  count: number;
  createdAt: string;
  updatedAt: string;
  occurredAt: string;
  handledAt: string | null;
  handledBy: 'user' | 'source' | 'expired' | null;
  snoozedUntil: string | null;
  data: Record<string, string | number | boolean | null> | null;
}

/** Mirrors @nish/ui InboxListResponse. */
export interface InboxListData {
  items: InboxItemData[];
  nextCursor: string | null;
  counts: { open: number; snoozed: number; handled: number; urgent: number };
  sources: Array<{ id: string; open: number }>;
}

/** GET /api/inbox/items. Non-ok states are HTTP 200 so the widget never shows an error for them. */
export type InboxFeedData =
  | { state: 'ok'; list: InboxListData }
  | { state: 'offline' }        // service not reachable (Nishboard on the Mac, or inbox down)
  | { state: 'no-password' }    // INBOX_PASSWORD not set
  | { state: 'bad-password' };  // inbox answered 401 to the login

export interface InboxSnoozeRequestBody { until: string } // ISO 8601
export interface InboxHandleAllRequestBody { source?: string }
```
Export all of them type-only from `packages/shared/src/index.ts`.

### Server: `packages/server/src/lib/inboxClient.ts`
```ts
export const INBOX_API = process.env.INBOX_API_URL || 'http://127.0.0.1:8805/api';
export class InboxOfflineError extends Error {}      // unreachable / timeout
export class InboxNoPasswordError extends Error {}   // cred('INBOX_PASSWORD') === ''
export class InboxBadPasswordError extends Error {}  // login answered 401
export class InboxUpstreamError extends Error { constructor(public status: number, message: string) }
/** Exported for tests. */ export function resetInboxSession(): void  // clears the cached cookie + in-flight login
export async function inboxRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T>
```
Behavior of `inboxRequest`:
1. `password = cred('INBOX_PASSWORD')`; empty → throw `InboxNoPasswordError`.
2. If no cached cookie, `await login()` (single-flight: a module-level `Promise<string> | null` shared by concurrent callers, cleared when it settles).
3. `fetch(INBOX_API + path, { method, headers, body, signal: AbortSignal.timeout(2000) })` with headers `{ cookie: 'inbox_session=<token>', accept: 'application/json' }` and, for POST, `content-type: application/json` and `body: JSON.stringify(body ?? {})` (the inbox requires JSON on every non-GET, even with no body). Never send `origin`.
4. Fetch rejects (any error, including `TimeoutError`/`AbortError`) → throw `InboxOfflineError`.
5. 401 → clear the cookie, login again once, retry the request once; a second 401 → `InboxBadPasswordError`.
6. 204 → return `undefined as T`. 2xx → `res.json()`.
7. Other non-2xx → read `{ error }` from the JSON body if any (fallback `Inbox ${status}`), throw `InboxUpstreamError(status, message)`.

`login()`: `POST INBOX_API + '/login'`, headers `content-type: application/json`, body `{"password": password}`, 2s timeout. Fetch rejects → `InboxOfflineError`. 401 → `InboxBadPasswordError`. 429 → `InboxUpstreamError(429, 'Too many Inbox login tries. Wait a minute.')`. 204 → find the `inbox_session=` entry in `res.headers.getSetCookie()`, take the value up to the first `;`; missing → `InboxUpstreamError(502, 'Inbox login returned no session.')`. Never log the password or cookie.

### Server: `packages/server/src/routes/inbox.ts` (`inboxRoutes`, prefix `/api/inbox`)
- `GET /items?view=&source=&cursor=&limit=` → validate: `view` ∈ open|snoozed|handled (default `open`, else HttpError 400 `Bad view.`); `source` must match `/^[a-z0-9][a-z0-9-]{0,31}$/` or be absent/empty (else 400 `Bad source.`); `cursor` passed through only if it matches `/^[A-Za-z0-9_\-=.:]{1,200}$/` (else 400 `Bad cursor.`); `limit` integer 1–100, default 50. Build the query with `URLSearchParams`. Call `inboxRequest<InboxListData>('GET', '/items?' + qs)`. Map: `InboxOfflineError` → `{ state: 'offline' }`, `InboxNoPasswordError` → `{ state: 'no-password' }`, `InboxBadPasswordError` → `{ state: 'bad-password' }`, `InboxUpstreamError` → `HttpError(status in [400,404,409,429] ? status : 502, message)`. Success → `{ state: 'ok', list }`.
- `POST /items/:id/handle`, `/unhandle`, `/unsnooze` → `id` must match `/^\d{1,15}$/` (else 404 `Not found.`). Proxy with `{}`; reply with the inbox's item JSON (`InboxItemData`).
- `POST /items/:id/snooze` body `InboxSnoozeRequestBody` → `until` must be a string with `Number.isFinite(Date.parse(until))` (else 400 `Pick a snooze time.`); proxy `{ until }`.
- `POST /items/handle-all` body `InboxHandleAllRequestBody` → `source` optional, same regex; proxy `{ source }` or `{}`; reply `{ count }`.
- Mutation error mapping: Offline → `HttpError(503, 'Inbox is not reachable.')`; NoPassword → `HttpError(400, 'Add the Inbox password in Settings → Developer.')`; BadPassword → `HttpError(401, 'The Inbox password was not accepted.')`; Upstream → same as GET.
- Register `/handle-all` before `/:id/...` routes (Fastify matches static first anyway, but keep the order readable).
- Register in `app.ts`: `import { inboxRoutes } from './routes/inbox';` + `server.register(inboxRoutes, { prefix: '/api/inbox' });` after discord.

### Credential (`packages/shared/src/types/credentials.ts`)
Append `'INBOX_PASSWORD'` to `CREDENTIAL_KEYS` (after `CLAUDE_CODE_OAUTH_TOKEN`) and a def:
```ts
{
  // Deliberately NOT in build.mjs BUILTIN_KEYS — a personal password.
  key: 'INBOX_PASSWORD',
  label: 'Password',
  service: 'Inbox',
  hint: 'The Inbox page password (the inbox service on the PC, 127.0.0.1:8805). Leave empty on the Mac.',
},
```

### Renderer
Files under `apps/renderer/src/widgets/inbox/` plus `store/inboxUiStore.ts`.

**`inboxSort.ts`** (pure, tested):
```ts
export const SEVERITY_ORDER: InboxSeverityData[] = ['urgent', 'normal', 'info'];
export interface InboxGroup { severity: InboxSeverityData; items: InboxItemData[] }
/** Groups by severity (urgent, normal, info; empty groups dropped). Within a group: unacked first,
 *  then newest updatedAt first; ties by id desc. Unknown severity counts as 'normal'. */
export function groupBySeverity(items: InboxItemData[], isAcked: (item: InboxItemData) => boolean): InboxGroup[]
/** The next 08:00 local, `days` ahead of `now`. */
export function at8(now: Date, days: number): Date
export const SNOOZE_OPTIONS: Array<{ label: string; until: (now: Date) => Date }>
// '1 hour' (+1h), '4 hours' (+4h), 'Tomorrow 8 AM' (at8(now,1)), 'Monday 8 AM' (at8(now, (8 - now.getDay()) % 7 || 7))
/** http/https href or null. */
export function safeHref(url: string | null): string | null
```

**`store/inboxUiStore.ts`** — `useInboxUiStore`, zustand `persist` name `dashboard-inbox-ui`, version 1, partialize `{ acked, view, source }`:
```ts
interface InboxUiState {
  acked: Record<string, number>;          // itemId -> count at ack
  view: InboxViewData;                     // default 'open'
  source: string | null;                   // default null (All)
  toggleAck: (item: InboxItemData) => void;  // acked & still valid -> remove; else set acked[id] = item.count
  pruneAcked: (openIds: number[]) => void;   // drop keys not in openIds (no-op set when nothing changes)
  setView: (v: InboxViewData) => void;       // also resets source to null
  setSource: (s: string | null) => void;
}
/** True when acked and the item has not repeated since. */
export function isAckedIn(acked: Record<string, number>, item: InboxItemData): boolean // acked[id] !== undefined && item.count <= acked[id]
```

**`useInbox.ts`**:
- `useInboxFeed()`: `useInfiniteQuery<InboxFeedData>` with key `['inbox', view, source]`, `queryFn` → `apiClient.get('/api/inbox/items?' + new URLSearchParams({ view, ...(source ? { source } : {}), ...(pageParam ? { cursor: pageParam } : {}) }))`, `initialPageParam: null as string | null`, `getNextPageParam: (last) => last.state === 'ok' ? last.list.nextCursor : null` (return `undefined` for null so TanStack sees no next page), `refetchInterval: useGatedInterval(60_000)`, `staleTime: 30_000`.
  Derive: `state` = first page's state; `list` merge = items of all ok pages concatenated (dedupe by id, first wins); `counts`/`sources` from the first page.
- `useInboxMutations()`: `useMutation`s for `handle(id)`, `unhandle(id)`, `snooze(id, until: Date)` (sends `until.toISOString()`), `unsnooze(id)`, `handleAll(source?)`. `onSettled` → `queryClient.invalidateQueries({ queryKey: ['inbox'] })`. `onError` → `toast('Inbox', err.message, 'error')`.

**`InboxWidget.tsx`** — exports `InboxWidget` and `InboxActions`.

`InboxActions` (header): `RefreshAction queryKey={['inbox']} title="Refresh inbox"` and a `HeaderAction title="Open Inbox page"` (lucide `ExternalLink` size 11) that calls `window.electron?.openExternal?.('https://start.nish.software/#/inbox')`.

`InboxWidget` layout (`h-full flex flex-col overflow-hidden`):
1. **Toolbar row** (`px-2 pt-2 pb-1 flex items-center gap-1.5 flex-wrap`), only when state is `ok`: a `ChipGroup label="Inbox view"` with three `Chip size="sm"` (pressed = current view): `Open {counts.open}`, `Snoozed {counts.snoozed}`, `Handled`. When `sources.length > 1`, a second `ChipGroup label="Filter by source" scroll` row: `All` + one chip per source (label from `INBOX_SOURCE_LABELS` in `@nish/ui` if exported, else the id; trailing open count `text-th-hi3 tabular-nums`). In the open view with items, a right-aligned `Button size="sm" variant="ghost"` "Resolve all" that opens `ConfirmDialog` (from `@nish/ui`) titled `Resolve {n} item(s)?` (n = filtered source's open count or `counts.open`; "1 item" vs "N items"), confirm label "Resolve", then `handleAll(source ?? undefined)`.
2. **Body** (`flex-1 min-h-0 overflow-y-auto`):
   - Loading (no data yet): `<SkeletonLines lines={4} className="p-2" />`.
   - Query error (thrown): `<ErrorState message={err.message || 'Failed to load the inbox'} queryKey={['inbox']} />` (widget ErrorState from `components/`).
   - `offline`: `<EmptyState compact className="h-full" icon={<Inbox size={18} />} title="Inbox is on the PC" description="It shows up here when Nishboard runs on the same PC as the inbox service." />` — no button, no error color.
   - `no-password`: `EmptyState compact` icon `KeyRound`, title `Add the Inbox password`, description `Settings → Developer → Inbox.`, action `<Button size="sm" variant="subtle" onClick={() => openSettings('dev')}>Open Settings</Button>`.
   - `bad-password`: same, title `Inbox password not accepted`, description `Update it in Settings → Developer → Inbox.`.
   - ok, zero items: `EmptyState compact` title `Nothing open` / `Nothing snoozed` / `Nothing handled in the last 30 days` (append ` from {sourceLabel}` when a source filter is set).
   - ok, open view: `groupBySeverity(items, isAcked)`; each group renders a header `<div className="px-2 pt-2 pb-1 text-3xs uppercase tracking-wide text-th-hi3">{Urgent|Normal|Info} · {n}</div>` then a `<ul className="divide-y divide-th-line">` of rows.
   - ok, snoozed / handled views: one flat list, newest `updatedAt` first, no groups.
   - `hasNextPage` → a centered `Button size="sm" variant="ghost" loading={isFetchingNextPage}` "Load more" under the list.
3. **Row** (`li`, `flex items-start gap-2 px-2 py-1.5`, `opacity-60` when acked in the open view):
   - `StatusDot` tone `loss` (urgent) / `accent` (normal) / `neutral` (info), label `Urgent`/`Normal`/`Info`, `className="mt-1 shrink-0"`.
   - Text column `min-w-0 flex-1`: meta line `text-3xs text-th-hi3 flex flex-wrap gap-x-1.5` = source label · `<RelativeTime value={item.updatedAt} style="short" />` · `×{count}` when count > 1 (`aria-label="Happened {count} times"`) · `Acked` when acked; title `text-xs font-medium text-th-hi line-clamp-2 break-words` — a `button` styled as a link (`hover:underline text-left`) calling `openExternal(href)` when `safeHref(item.url)` is non-null, else plain text; body (if any) `text-2xs text-th-hi2 line-clamp-2 break-words whitespace-pre-line`. Snoozed view adds `Until {localized date+time}`; handled view adds `Resolved {RelativeTime handledAt}` + ` by the app` / ` automatically` for `handledBy` source / expired.
   - Actions `shrink-0 flex items-center gap-0.5` (`IconButton size="2xs"`, lucide icons size 12):
     - open view: Ack (`Eye` when not acked, label `Ack`; `EyeOff` when acked, label `Un-ack`) → `toggleAck(item)`; Snooze (`Clock`, label `Snooze`) → `DropdownMenu align="end"` with the four `SNOOZE_OPTIONS` as `MenuItem`s → `snooze(id, opt.until(new Date()))`; Resolve (`Check`, label `Resolve`) → `handle(id)`.
     - snoozed view: `Button size="xs" variant="subtle"` "Unsnooze" → `unsnooze(id)`.
     - handled view: `Button size="xs" variant="subtle"` "Move back" → `unhandle(id)`.
     - Buttons are disabled while that row's mutation is pending.
   - Pointer-coarse (Fold 7 touch): add `pointer-coarse:min-h-11 pointer-coarse:min-w-11` to the row's IconButtons so touch targets are ≥ 44px.
4. Effects: when state is `ok` and view is `open` and the source filter is null and there is no next page, call `pruneAcked(items.map(i => i.id))`.

Width behavior: tiles can be ~240px wide; rows wrap meta, titles clamp at 2 lines; actions stay in a fixed-width column. 360px / 840px / desktop all render the same component; no horizontal scroll (`min-w-0` everywhere, chip rows use `ChipGroup scroll`).

If a `@nish/ui` export named above does not exist in v0.9.2 (check `node_modules/@nish/ui/dist/index.d.ts`), use the nearest existing one and say so in the task notes. Verified exports: `Chip`, `ChipGroup`, `StatusDot`, `DropdownMenu`, `MenuItem`, `ConfirmDialog`, `EmptyState`, `SkeletonLines`, `Button`, `IconButton`, `RelativeTime`, `INBOX_SOURCE_LABELS`.

**Registry wiring:**
- `lib/layouts.ts`: add `'inbox'` to `WidgetId`, `ALL_WIDGET_IDS` (append), `WIDGET_TITLES` (`inbox: 'Inbox'`), the `feeds` category (append after `'news'`), `WIDGET_CONSTRAINTS` (`inbox: { minW: 3, minH: 2 }`).
- `components/DashboardGrid.tsx`: import and add `inbox: { Component: InboxWidget, Actions: InboxActions }`.
- `apps/main/src/popout.ts`: `DEFAULT_SIZES` add `inbox: { width: 380, height: 480 }`.

### Security
- The renderer never sees the password or cookie; it only gets `InboxFeedData` states.
- Every proxied path is built from validated pieces (numeric id, fixed verbs, regex-checked source/cursor, enum view). No renderer-supplied path segments or headers reach the inbox.
- Fastify never calls `/ingest/*`; `inboxClient` only builds `INBOX_API + '/items…'` and `'/login'`.
- Fastify CORS already limits the renderer origins; new routes are ordinary (not hijacked).

### Performance
- One loopback GET per minute while visible (paused when hidden by `useGatedInterval`); 2s timeout so an unreachable service never stalls. Page size 50.

### Ops
- New credential `INBOX_PASSWORD` (Settings → Developer → Inbox). No ports, no hosting change. Inbox stays loopback-only.

## Tasks

### T1 Server proxy + shared types + credential
- Repo / checkout: nishboard at `/home/user/nishboard`
- Owns: `packages/shared/src/types/inbox.ts` (new), `packages/shared/src/index.ts`, `packages/shared/src/types/credentials.ts`, `packages/server/src/lib/inboxClient.ts` (new), `packages/server/src/routes/inbox.ts` (new), `packages/server/src/routes/inbox.integration.test.ts` (new), `packages/server/src/app.ts`
- Reads: `packages/server/src/lib/http.ts`, `lib/env.ts`, `src/test/fetchStub.ts`, `routes/crypto.ts`, `routes/crypto.integration.test.ts`, `/home/user/inbox/server/api.ts` (the real API)
- Depends on: none
- Change: as in Design → Data, Server, Credential.
- Edge cases: password unset → `no-password` without any fetch; ECONNREFUSED → `offline`; login 401 → `bad-password`; cached cookie rejected (401) → one re-login + retry succeeds; two concurrent first requests → exactly one login fetch; snooze with bad `until` → 400 without upstream call; non-numeric id → 404 without upstream call; bad view → 400; inbox 409 on handle → 409 with the inbox's message; no request ever carries an `origin` header; POST bodies are JSON with content-type json.
- Acceptance: `pnpm --filter @dash/shared build && pnpm --filter @dash/server typecheck && pnpm --filter @dash/server test` pass. `inbox.integration.test.ts` covers every edge case above (set `process.env.INBOX_PASSWORD` in `beforeEach`, delete it for the no-password case, call `resetInboxSession()` in `beforeEach`; for offline, stub fetch to throw `new TypeError('fetch failed')`).

### T2 Renderer widget + store + wiring
- Repo / checkout: nishboard at `/home/user/nishboard`
- Owns: `apps/renderer/src/widgets/inbox/InboxWidget.tsx` (new), `apps/renderer/src/widgets/inbox/useInbox.ts` (new), `apps/renderer/src/widgets/inbox/inboxSort.ts` (new), `apps/renderer/src/widgets/inbox/inboxSort.test.ts` (new), `apps/renderer/src/store/inboxUiStore.ts` (new), `apps/renderer/src/store/inboxUiStore.test.ts` (new), `apps/renderer/src/lib/layouts.ts`, `apps/renderer/src/components/DashboardGrid.tsx`, `apps/main/src/popout.ts`. May also update any existing renderer test fixture that enumerates every widget id (say so).
- Reads: `widgets/crypto/*`, `widgets/news/NewsWidget.tsx`, `components/ErrorState.tsx`, `components/HeaderAction.tsx`, `components/RefreshAction.tsx`, `store/discordUiStore.ts` + test, `store/overlayStore.ts`, `lib/alerts.ts`, `node_modules/@nish/ui/dist/index.d.ts`
- Depends on: T1 (shared types)
- Change: as in Design → Renderer.
- Edge cases: unknown severity → grouped as normal; item repeated after ack (count grew) → shows unacked; ack toggle twice → unacked; pruneAcked keeps only open ids; `javascript:` url → title not clickable; empty sources → no source row; filter set and view changed → source resets to null; next-page cursor null → no "Load more".
- Acceptance: `pnpm --filter @dash/shared build && pnpm --filter @dash/renderer typecheck && pnpm --filter @dash/renderer test && pnpm --filter @dash/renderer lint && pnpm --filter @dash/main typecheck` pass. Tests: `inboxSort.test.ts` (grouping order, acked-last, unknown severity, at8/Monday math incl. when today is Monday, safeHref) and `inboxUiStore.test.ts` (toggleAck, lapse on count growth via `isAckedIn`, pruneAcked, setView resets source, persisted rehydrate).

## Waves
W1: T1 · W2: T2 (needs T1's shared types)

## Review focus
- No `/ingest` call, no Origin header, password/cookie never logged or returned; validation of every proxied path piece.
- Offline/no-password/bad-password states really return 200 + state and the widget shows the quiet copy (no red error) for offline.
- Re-login single-flight and the one-retry-only rule (no login loop that burns the inbox's 10/min limit).
- Widget at narrow tile widths and in a 360px popout: no horizontal scroll, clamped text, 44px targets on coarse pointers; light + dark via role classes only.

## Release
Single repo. PR title `feat: Inbox widget` (minor bump). After merge, watch `Release` on master to green and confirm the GitHub Release has the DMG + EXE. Live check from the cloud is the green release; the inbox itself is PC-only (loopback), so the widget's ok-state is verified by tests + a dev-server screenshot with a stubbed server.

## Open questions for the research phase
None.
