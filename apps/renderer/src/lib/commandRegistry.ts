// Command-palette action registry. Inversion keeps imports acyclic: the
// palette imports only this module; action-source modules import only their
// own store (calling useXStore.getState() imperatively) plus this registry,
// and are wired up via a side-effect import in main.tsx.

import type { CommandItem } from '@nish/ui';
import { fuzzyScore } from './fuzzy';

export interface PaletteAction {
  /** Stable id — also the recents (MRU) key, so keep it deterministic. */
  id: string;
  title: string;
  /** Section header in the palette list. */
  group: string;
  /** Extra match text (e.g. aliases) — searched but not displayed. */
  keywords?: string;
  /** When set, selecting the action prefills the palette input with this text
   *  and keeps it open instead of running — discoverability rows for the
   *  parameterized commands below. `run` is ignored. */
  fill?: string;
  run: () => void;
}

/** Called every time the palette opens, so titles/sets reflect live state
 *  (e.g. "Hide widget: X" vs "Show widget: X"). */
type ActionSource = () => PaletteAction[];

const sources: ActionSource[] = [];

export function registerActionSource(source: ActionSource): void {
  sources.push(source);
}

export function collectActions(): PaletteAction[] {
  return sources.flatMap((s) => s());
}

/** Async refreshers behind sync sources (e.g. the launcher IPC snapshot).
 *  The palette kicks these on open, then re-collects once they settle. */
type SourceRefresher = () => Promise<void>;

const refreshers: SourceRefresher[] = [];

export function registerSourceRefresher(refresher: SourceRefresher): void {
  refreshers.push(refresher);
}

export function refreshSources(): Promise<void> {
  return Promise.allSettled(refreshers.map((r) => r())).then(() => undefined);
}

// ── Parameterized commands ("timer 25m tea") ──────────────────────────────────

/** A successfully parsed invocation — ready to preview and execute. */
export interface ParsedInvocation {
  preview: string;
  run: () => void;
}

export interface ParameterizedCommand {
  /** Stable id — pushed to recents on execution. Also reused as the id of the
   *  command's discoverability fill row, so running "timer 25m" surfaces
   *  "Start a timer…" under Recent. */
  id: string;
  /** First-token names that select this command ("timer", "t"). */
  triggers: string[];
  /** Palette group for the command's discoverability fill row. */
  group: string;
  /** Grammar hint shown while the args don't parse yet. */
  argHint: string;
  /** null = args don't (yet) parse — the palette shows argHint instead. */
  parse: (args: string) => ParsedInvocation | null;
}

const paramCommands: ParameterizedCommand[] = [];

export function registerParamCommands(cmds: ParameterizedCommand[]): void {
  paramCommands.push(...cmds);
}

export interface ParamCommandMatch {
  cmd: ParameterizedCommand;
  parsed: ParsedInvocation | null;
}

/**
 * Match the query's first token against registered triggers (case-insensitive).
 * An exact trigger always matches; a unique trigger *prefix* matches only once
 * args follow (a space after the token) — a bare partial word like "time"
 * stays unmatched so the fuzzy list can still rank "Start 5-minute timer".
 */
export function matchParamCommand(query: string): ParamCommandMatch | null {
  const q = query.trimStart();
  const spaceIdx = q.search(/\s/);
  const first = spaceIdx === -1 ? q : q.slice(0, spaceIdx);
  if (!first) return null;
  const args = spaceIdx === -1 ? '' : q.slice(spaceIdx + 1).trim();
  const lower = first.toLowerCase();

  const exact = paramCommands.find((c) => c.triggers.some((t) => t.toLowerCase() === lower));
  if (exact) return { cmd: exact, parsed: exact.parse(args) };

  if (spaceIdx !== -1) {
    const prefixed = paramCommands.filter((c) => c.triggers.some((t) => t.toLowerCase().startsWith(lower)));
    if (prefixed.length === 1) return { cmd: prefixed[0], parsed: prefixed[0].parse(args) };
  }
  return null;
}

// ── Palette rows ──────────────────────────────────────────────────────────────

const RECENTS_KEY = 'dashboard-palette-recents';
const RECENTS_MAX = 8;
const LIST_MAX = 40;

/** Stable section order for the empty-query (browse) view. Unknown groups sink
 *  to the end, keeping their registration order. */
export const GROUP_ORDER = [
  'Recent', 'Command', 'Layouts', 'Widgets', 'Timers', 'Tasks & Notes',
  'Media', 'System', 'Appearance', 'Alerts', 'App',
];

function groupRank(group: string): number {
  const i = GROUP_ORDER.indexOf(group);
  return i === -1 ? GROUP_ORDER.length : i;
}

export function readRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function pushRecent(id: string): void {
  try {
    const next = [id, ...readRecents().filter((r) => r !== id)].slice(0, RECENTS_MAX);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: recents are a convenience only.
  }
}

function syntaxOf(cmd: ParameterizedCommand): string {
  return `${cmd.triggers[0]} ${cmd.argHint}`;
}

function toItem(action: PaletteAction, group: string): CommandItem {
  const base: CommandItem = {
    id: action.id,
    label: action.title,
    group,
    keywords: action.keywords ? action.keywords.split(/\s+/).filter(Boolean) : undefined,
  };
  if (action.fill !== undefined) {
    // Discoverability row: shows the syntax; the ui palette's query is not controllable.
    const cmd = paramCommands.find((c) => c.id === action.id);
    return { ...base, hint: cmd ? syntaxOf(cmd) : action.fill.trim(), onSelect: () => undefined };
  }
  return {
    ...base,
    onSelect: () => {
      pushRecent(action.id);
      action.run();
    },
  };
}

/**
 * Rows for the palette in display order. Parameterized preview (or syntax hint)
 * first; an empty query shows Recent then everything in group order; otherwise
 * fuzzy-ranked actions. `recents` is injectable for tests.
 */
export function buildRows(query: string, actions: PaletteAction[], recents: string[] = readRecents()): CommandItem[] {
  const rows: CommandItem[] = [];

  const param = matchParamCommand(query);
  if (param) {
    const { cmd, parsed } = param;
    if (parsed) {
      rows.push({
        id: `command:${cmd.id}`,
        label: parsed.preview,
        group: 'Command',
        onSelect: () => {
          pushRecent(cmd.id);
          parsed.run();
        },
      });
    } else {
      const title = actions.find((a) => a.id === cmd.id)?.title ?? cmd.triggers[0];
      rows.push({ id: `command:${cmd.id}`, label: title, group: 'Command', hint: syntaxOf(cmd), onSelect: () => undefined });
    }
  }

  const q = query.trim();
  let flat: CommandItem[];
  if (!q) {
    const byId = new Map(actions.map((a) => [a.id, a]));
    const recentActions = recents
      .map((id) => byId.get(id))
      .filter((a): a is PaletteAction => !!a);
    const recentIds = new Set(recentActions.map((a) => a.id));
    const rest = actions
      .filter((a) => !recentIds.has(a.id))
      .map((a, i) => ({ a, i }))
      .sort((x, y) => groupRank(x.a.group) - groupRank(y.a.group) || x.i - y.i)
      .map((x) => x.a);
    flat = [
      ...recentActions.map((a) => toItem(a, 'Recent')),
      ...rest.map((a) => toItem(a, a.group)),
    ].slice(0, LIST_MAX);
  } else {
    flat = actions
      .map((a) => ({ a, score: fuzzyScore(q, `${a.title} ${a.keywords ?? ''}`) }))
      .filter((x) => x.score >= 0)
      .sort((x, y) => y.score - x.score)
      .map((x) => x.a)
      .slice(0, LIST_MAX)
      // Stable: rows keep their score order inside each group, groups follow GROUP_ORDER.
      .sort((x, y) => groupRank(x.group) - groupRank(y.group))
      .map((a) => toItem(a, a.group));
  }
  rows.push(...flat);
  return rows;
}
