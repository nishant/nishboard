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
  /** Producer-defined buttons (@nish/ui InboxAction). Absent on inbox builds before actions shipped. */
  actions?: InboxActionData[];
  /** Outcome of the last action run on this item, or null. */
  lastAction?: InboxActionResultData | null;
}

/** Mirrors @nish/ui InboxAction. The service keeps the target; the client only sends the id. */
export interface InboxActionData {
  id: string;
  label: string;
  method: 'POST';
  target: string;
}

/** Mirrors @nish/ui InboxActionResult. `error` is a short user-facing sentence when ok is false. */
export interface InboxActionResultData {
  actionId: string;
  ok: boolean;
  status: number | null;
  error: string | null;
  at: string;
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
