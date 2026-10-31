import type { InboxItemData, InboxSeverityData } from '@dash/shared';

export const SEVERITY_ORDER: InboxSeverityData[] = ['urgent', 'normal', 'info'];

export interface InboxGroup {
  severity: InboxSeverityData;
  items: InboxItemData[];
}

function severityOf(item: InboxItemData): InboxSeverityData {
  return item.severity === 'urgent' || item.severity === 'info' ? item.severity : 'normal';
}

/** Groups by severity (urgent, normal, info; empty groups dropped). Within a group: unacked first,
 *  then newest updatedAt first; ties by id desc. Unknown severity counts as 'normal'. */
export function groupBySeverity(
  items: InboxItemData[],
  isAcked: (item: InboxItemData) => boolean,
): InboxGroup[] {
  const buckets: Record<InboxSeverityData, InboxItemData[]> = { urgent: [], normal: [], info: [] };
  for (const item of items) buckets[severityOf(item)].push(item);
  const ackedMemo = new Map<number, boolean>();
  const acked = (i: InboxItemData): boolean => {
    let v = ackedMemo.get(i.id);
    if (v === undefined) {
      v = isAcked(i);
      ackedMemo.set(i.id, v);
    }
    return v;
  };
  return SEVERITY_ORDER.filter((s) => buckets[s].length > 0).map((severity) => ({
    severity,
    items: buckets[severity].slice().sort((a, b) => {
      const aa = acked(a) ? 1 : 0;
      const ba = acked(b) ? 1 : 0;
      if (aa !== ba) return aa - ba;
      const ta = Date.parse(a.updatedAt) || 0;
      const tb = Date.parse(b.updatedAt) || 0;
      if (ta !== tb) return tb - ta;
      return b.id - a.id;
    }),
  }));
}

/** http/https href or null. */
export function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
