import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CalendarAuthStatus, CalendarEventData, CalendarEventsData } from '@dash/shared';
import { apiClient } from '../../lib/apiClient';
import { useGatedInterval } from '../../hooks/useGatedInterval';

// ── Account (Google OAuth, calendar.events scope) ────────────────────────────
// Separate consent + token file from YouTube's — connecting/disconnecting one
// never touches the other, even though both share the Google OAuth client.

/** Poll auth state so the widget flips to signed-in automatically after the
 *  browser OAuth round-trip completes against the server. */
export function useCalendarAuthStatus() {
  const interval = useGatedInterval(15_000);
  return useQuery<CalendarAuthStatus>({
    queryKey: ['calendar-auth'],
    queryFn: () => apiClient.get<CalendarAuthStatus>('/api/calendar/auth-status'),
    refetchInterval: interval,
    staleTime: 10_000,
  });
}

export function useCalendarConnect() {
  return useMutation({
    mutationFn: async () => {
      const { url } = await apiClient.get<{ url: string }>('/api/calendar/auth-url');
      // Guarded in the main process to https://accounts.google.com/ only.
      window.electron?.openGoogleAuth?.(url);
    },
  });
}

export function useCalendarLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post('/api/calendar/logout'),
    onSuccess: () => {
      qc.setQueryData<CalendarAuthStatus>(['calendar-auth'], { authenticated: false });
      void qc.invalidateQueries({ queryKey: ['calendar-events'] });
    },
  });
}

// ── Events ────────────────────────────────────────────────────────────────────

/** All events in [startIso, endIso] (inclusive YYYY-MM-DD bounds — the whole
 *  visible month range in one query). Server caches 5 min per range; match it
 *  client-side. `enabled` MUST be false when signed out so a day click never
 *  fires the query. */
export function useCalendarEvents(startIso: string, endIso: string, enabled: boolean) {
  const interval = useGatedInterval(5 * 60 * 1000);
  return useQuery<CalendarEventsData>({
    queryKey: ['calendar-events', startIso, endIso],
    queryFn: () =>
      apiClient.get<CalendarEventsData>(
        `/api/calendar/events?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`,
      ),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: interval,
    retry: 1,
  });
}

export interface AddCalendarEventInput {
  summary: string;
  /** YYYY-MM-DD. No `time` → all-day event. */
  date: string;
  /** HH:mm (local). Present → timed event. */
  time?: string;
  /** Minutes, timed events only; server defaults to 60. */
  durationMinutes?: number;
}

export function useAddCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddCalendarEventInput) =>
      apiClient.post<CalendarEventData>('/api/calendar/events', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['calendar-events'] });
    },
  });
}
