// Command-palette action registry. Inversion keeps imports acyclic: the
// palette imports only this module; action-source modules import only their
// own store (calling useXStore.getState() imperatively) plus this registry,
// and are wired up via a side-effect import in main.tsx.

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
