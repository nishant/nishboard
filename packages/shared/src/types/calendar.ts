export interface CalendarAuthStatus {
  authenticated: boolean;
}

/** One Google Calendar event as the renderer sees it.
 *  `start`/`end` are ISO dateTime strings for timed events, or plain
 *  YYYY-MM-DD for all-day events. All-day `end` is EXCLUSIVE (Google
 *  semantics — a one-day event ends on the NEXT calendar date). */
export interface CalendarEventData {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
}

export interface CalendarEventsData {
  events: CalendarEventData[];
}
