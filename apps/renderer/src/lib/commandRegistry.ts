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
