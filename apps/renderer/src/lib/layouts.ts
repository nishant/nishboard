import type { Layout } from 'react-grid-layout';

export type WidgetId =
  | 'weather' | 'spotify' | 'stocks' | 'hardware' | 'sound' | 'calendar' | 'youtube' | 'twitch'
  | 'tasks' | 'worldclock' | 'notes' | 'timer' | 'countdown' | 'news' | 'crypto' | 'launcher' | 'clipboard'
  | 'claude';

export const ALL_WIDGET_IDS: WidgetId[] = [
  'weather', 'spotify', 'stocks', 'hardware', 'sound', 'calendar', 'youtube', 'twitch',
  'tasks', 'worldclock', 'notes', 'timer', 'countdown', 'news', 'crypto', 'launcher', 'clipboard',
  'claude',
];

export const WIDGET_TITLES: Record<WidgetId, string> = {
  weather: 'Weather',
  spotify: 'Spotify',
  stocks: 'Stocks',
  hardware: 'Hardware',
  sound: 'Sound',
  calendar: 'Calendar',
  youtube: 'YouTube',
  twitch: 'Twitch',
  tasks: 'Tasks',
  worldclock: 'World Clock',
  notes: 'Notes',
  timer: 'Timer',
  countdown: 'Countdown',
  news: 'News',
  crypto: 'Crypto',
  launcher: 'Launcher',
  clipboard: 'Clipboard',
  claude: 'Claude',
};

export interface NamedLayout {
  name: string;
  layout: Layout[];
  /** If set, applying this preset also restores these visible widgets. */
  visibleWidgets?: WidgetId[];
}

// 24 cols, dynamic rowHeight (fills screen minus titlebar), margin=[8,8], containerPadding=[8,8]
// Every preset is gap-free — all 24×22 cells covered by exactly one widget.
// Verification: for each column x, sum of h values of widgets covering that x = 22.

export const PRESETS: NamedLayout[] = [
  {
    // 4 top (h=8) + youtube+sound mid (h=9) + hardware full-width bottom (h=5)
    // Cols  0-5:  weather(8)  + youtube(9)   + hardware(5) = 22
    // Cols  6-11: spotify(8)  + youtube(9)   + hardware(5) = 22
    // Cols 12-13: stocks(8)   + youtube(9)   + hardware(5) = 22
    // Cols 14-23: calendar(8) + sound(9)     + hardware(5) = 22
    name: 'Default',
    visibleWidgets: ['weather', 'spotify', 'stocks', 'hardware', 'sound', 'calendar', 'youtube', 'twitch'],
    layout: [
      { i: 'weather',  x: 0,  y: 0,  w: 6,  h: 8,  minW: 4, minH: 2 },
      { i: 'spotify',  x: 6,  y: 0,  w: 6,  h: 8,  minW: 4, minH: 2 },
      { i: 'stocks',   x: 12, y: 0,  w: 6,  h: 8,  minW: 5, minH: 2 },
      { i: 'calendar', x: 18, y: 0,  w: 6,  h: 8,  minW: 4, minH: 2 },
      { i: 'youtube',  x: 0,  y: 8,  w: 14, h: 9,  minW: 6, minH: 2 },
      { i: 'sound',    x: 14, y: 8,  w: 10, h: 9,  minW: 3, minH: 2 },
      { i: 'hardware', x: 0,  y: 17, w: 24, h: 5,  minW: 6, minH: 2 },
    ],
  },
  {
    // Stocks + youtube equal top (h=12), info grid below (h=10)
    // Cols  0-11: stocks(12)  + hardware(10) = 22
    // Cols 12-17: youtube(12) + spotify(6)   + weather(4) = 22
    // Cols 18-23: youtube(12) + calendar(6)  + sound(4)   = 22
    name: 'Markets',
    layout: [
      { i: 'stocks',   x: 0,  y: 0,  w: 12, h: 12, minW: 5, minH: 2 },
      { i: 'youtube',  x: 12, y: 0,  w: 12, h: 12, minW: 6, minH: 2 },
      { i: 'hardware', x: 0,  y: 12, w: 12, h: 10, minW: 6, minH: 2 },
      { i: 'spotify',  x: 12, y: 12, w: 6,  h: 6,  minW: 4, minH: 2 },
      { i: 'calendar', x: 18, y: 12, w: 6,  h: 6,  minW: 4, minH: 2 },
      { i: 'weather',  x: 12, y: 18, w: 6,  h: 4,  minW: 4, minH: 2 },
      { i: 'sound',    x: 18, y: 18, w: 6,  h: 4,  minW: 3, minH: 2 },
    ],
  },
  {
    // Left half = pure video: YouTube stacked on Twitch. Right = Spotify + slim info column, stocks+hardware below.
    // Cols  0-11: youtube(11) + twitch(11) = 22
    // Cols 12-19: spotify(11) + stocks(5) + hardware(6) = 22
    // Cols 20-23: weather(6)  + calendar(3) + sound(2) + stocks(5) + hardware(6) = 22
    name: 'Media',
    layout: [
      { i: 'youtube',  x: 0,  y: 0,  w: 12, h: 11, minW: 6, minH: 2 },
      { i: 'twitch',   x: 0,  y: 11, w: 12, h: 11, minW: 6, minH: 2 },
      { i: 'spotify',  x: 12, y: 0,  w: 8,  h: 11, minW: 4, minH: 2 },
      { i: 'weather',  x: 20, y: 0,  w: 4,  h: 6,  minW: 4, minH: 2 },
      { i: 'calendar', x: 20, y: 6,  w: 4,  h: 3,  minW: 4, minH: 2 },
      { i: 'sound',    x: 20, y: 9,  w: 4,  h: 2,  minW: 3, minH: 2 },
      { i: 'stocks',   x: 12, y: 11, w: 6,  h: 11, minW: 5, minH: 2 },
      { i: 'hardware', x: 18, y: 11, w: 6,  h: 11, minW: 6, minH: 2 },
    ],
  },
  {
    // hardware + 2 left | youtube top-right, stocks/weather + sound bottom-right
    // Cols  0-5:  hardware(11) + spotify(11) = 22
    // Cols  6-13: hardware(11) + calendar(11) = 22
    // Cols 14-18: youtube(11)  + stocks(6) + sound(5) = 22
    // Cols 19-23: youtube(11)  + weather(6) + sound(5) = 22
    name: 'System',
    layout: [
      { i: 'hardware', x: 0,  y: 0,  w: 14, h: 11, minW: 6, minH: 2 },
      { i: 'youtube',  x: 14, y: 0,  w: 10, h: 11, minW: 6, minH: 2 },
      { i: 'spotify',  x: 0,  y: 11, w: 6,  h: 11, minW: 4, minH: 2 },
      { i: 'calendar', x: 6,  y: 11, w: 8,  h: 11, minW: 4, minH: 2 },
      { i: 'stocks',   x: 14, y: 11, w: 5,  h: 6,  minW: 5, minH: 2 },
      { i: 'weather',  x: 19, y: 11, w: 5,  h: 6,  minW: 4, minH: 2 },
      { i: 'sound',    x: 14, y: 17, w: 10, h: 5,  minW: 3, minH: 2 },
    ],
  },
  {
    // Spotify full-height left | youtube+stocks top, hardware+weather/sound+calendar bottom
    // Cols 0-7: spotify(22) = 22
    // Cols 8-13: youtube(11) + hardware(11) = 22
    // Cols 14-18: youtube(11) + weather(6) + sound(5) = 22
    // Cols 19-23: stocks(11) + calendar(11) = 22
    name: 'Focus',
    layout: [
      { i: 'spotify',  x: 0,  y: 0,  w: 8,  h: 22, minW: 4, minH: 2 },
      { i: 'youtube',  x: 8,  y: 0,  w: 10, h: 11, minW: 6, minH: 2 },
      { i: 'stocks',   x: 18, y: 0,  w: 6,  h: 11, minW: 5, minH: 2 },
      { i: 'hardware', x: 8,  y: 11, w: 6,  h: 11, minW: 6, minH: 2 },
      { i: 'weather',  x: 14, y: 11, w: 5,  h: 6,  minW: 4, minH: 2 },
      { i: 'sound',    x: 14, y: 17, w: 5,  h: 5,  minW: 3, minH: 2 },
      { i: 'calendar', x: 19, y: 11, w: 5,  h: 11, minW: 4, minH: 2 },
    ],
  },
  {
    // Info stack left, stocks+sound mid, youtube+spotify full-height right
    // Cols 0-4: weather(7) + hardware(8) + calendar(7) = 22
    // Cols 5-10: stocks(14) + sound(8) = 22
    // Cols 11-17: youtube(22) = 22
    // Cols 18-23: spotify(22) = 22
    name: 'Chill',
    layout: [
      { i: 'weather',  x: 0,  y: 0,  w: 5,  h: 7,  minW: 4, minH: 2 },
      { i: 'hardware', x: 0,  y: 7,  w: 5,  h: 8,  minW: 6, minH: 2 },
      { i: 'calendar', x: 0,  y: 15, w: 5,  h: 7,  minW: 4, minH: 2 },
      { i: 'stocks',   x: 5,  y: 0,  w: 6,  h: 14, minW: 5, minH: 2 },
      { i: 'sound',    x: 5,  y: 14, w: 6,  h: 8,  minW: 3, minH: 2 },
      { i: 'youtube',  x: 11, y: 0,  w: 7,  h: 22, minW: 6, minH: 2 },
      { i: 'spotify',  x: 18, y: 0,  w: 6,  h: 22, minW: 4, minH: 2 },
    ],
  },
  {
    // Hardware+sound left | stocks+calendar mid | youtube top-right, spotify+weather bottom-right
    // Cols  0-5:  hardware(19) + sound(3)    = 22
    // Cols  6-11: stocks(14)   + calendar(8) = 22
    // Cols 12-17: youtube(12)  + spotify(10) = 22
    // Cols 18-23: youtube(12)  + weather(10) = 22
    // Twitch hidden by default — BSP prune handles it if toggled on.
    name: 'Home',
    visibleWidgets: ['weather', 'spotify', 'stocks', 'hardware', 'sound', 'calendar', 'youtube'],
    layout: [
      { i: 'hardware', x: 0,  y: 0,  w: 6,  h: 19, minW: 6, minH: 2 },
      { i: 'sound',    x: 0,  y: 19, w: 6,  h: 3,  minW: 3, minH: 2 },
      { i: 'stocks',   x: 6,  y: 0,  w: 6,  h: 14, minW: 5, minH: 2 },
      { i: 'calendar', x: 6,  y: 14, w: 6,  h: 8,  minW: 4, minH: 2 },
      { i: 'youtube',  x: 12, y: 0,  w: 12, h: 12, minW: 6, minH: 2 },
      { i: 'spotify',  x: 12, y: 12, w: 6,  h: 10, minW: 4, minH: 2 },
      { i: 'weather',  x: 18, y: 12, w: 6,  h: 10, minW: 4, minH: 2 },
    ],
  },
  {
    // Stocks + youtube equal top row, everything below
    // Cols 0-8: stocks(11) + hardware(11) = 22
    // Cols 9-11: stocks(11) + spotify(11) = 22
    // Cols 12-15: youtube(11) + spotify(11) = 22
    // Cols 16-19: youtube(11) + weather(6) + sound(5) = 22
    // Cols 20-23: youtube(11) + calendar(11) = 22
    name: 'Wide',
    layout: [
      { i: 'stocks',   x: 0,  y: 0,  w: 12, h: 11, minW: 5, minH: 2 },
      { i: 'youtube',  x: 12, y: 0,  w: 12, h: 11, minW: 6, minH: 2 },
      { i: 'hardware', x: 0,  y: 11, w: 9,  h: 11, minW: 6, minH: 2 },
      { i: 'spotify',  x: 9,  y: 11, w: 7,  h: 11, minW: 4, minH: 2 },
      { i: 'weather',  x: 16, y: 11, w: 4,  h: 6,  minW: 4, minH: 2 },
      { i: 'sound',    x: 16, y: 17, w: 4,  h: 5,  minW: 3, minH: 2 },
      { i: 'calendar', x: 20, y: 11, w: 4,  h: 11, minW: 4, minH: 2 },
    ],
  },
];

export const DEFAULT_LAYOUT = PRESETS[0];

// ── BSP dynamic layout ────────────────────────────────────────────────────────
// Each preset is encoded as a Binary Space Partition tree.  When widgets are
// hidden, pruneTree collapses the tree (the surviving sibling expands to fill
// the full parent region), then renderTree computes gap-free Layout[] coords.

type LeafNode  = { type: 'leaf'; id: WidgetId };
type VSplitNode = { type: 'v'; r: number; a: SplitNode; b: SplitNode }; // vertical (x) split, r = left fraction
type HSplitNode = { type: 'h'; r: number; a: SplitNode; b: SplitNode }; // horizontal (y) split, r = top fraction
type SplitNode = LeafNode | VSplitNode | HSplitNode;

const l = (id: WidgetId): LeafNode => ({ type: 'leaf', id });
const v = (r: number, a: SplitNode, b: SplitNode): VSplitNode => ({ type: 'v', r, a, b });
const h = (r: number, a: SplitNode, b: SplitNode): HSplitNode => ({ type: 'h', r, a, b });

// Authoritative per-widget resize floors. minH is intentionally tiny (2 rows ≈ a
// header + sliver) so every widget can shrink vertically as far as possible; minW
// keeps each widget wide enough to stay usable. These OVERRIDE any minW/minH baked
// into the static PRESETS below (applied via generateLayout / applyConstraints).
const WIDGET_CONSTRAINTS: Record<WidgetId, { minW: number; minH: number }> = {
  weather:  { minW: 4, minH: 2 },
  spotify:  { minW: 4, minH: 2 },
  stocks:   { minW: 5, minH: 2 },
  hardware: { minW: 6, minH: 2 },
  sound:    { minW: 3, minH: 2 },
  calendar: { minW: 4, minH: 2 },
  youtube:  { minW: 6, minH: 2 },
  twitch:   { minW: 6, minH: 2 },
  tasks:      { minW: 3, minH: 2 },
  worldclock: { minW: 3, minH: 2 },
  notes:      { minW: 3, minH: 2 },
  timer:      { minW: 3, minH: 2 },
  countdown:  { minW: 3, minH: 2 },
  news:       { minW: 4, minH: 3 },
  crypto:     { minW: 4, minH: 2 },
  launcher:   { minW: 3, minH: 2 },
  clipboard:  { minW: 3, minH: 2 },
  // Chat needs room for the input row + a few message lines.
  claude:     { minW: 4, minH: 3 },
};

/** Clamp each item's minW/minH to the authoritative WIDGET_CONSTRAINTS. Used to
 *  migrate older persisted/saved layouts whose items carry stale (larger) mins. */
export function applyConstraints(layout: Layout[]): Layout[] {
  return layout.map((item) => {
    const c = WIDGET_CONSTRAINTS[item.i as WidgetId];
    return c ? { ...item, minW: c.minW, minH: c.minH } : item;
  });
}

// Each tree mirrors its static PRESETS counterpart exactly (verified col-by-col).
const PRESET_TREES: Record<string, SplitNode> = {
  // Default: 4-up top row | youtube+sound mid | hardware full-width bottom
  Default: h(17/22,
    h(8/17,
      v(6/24, l('weather'), v(6/18, l('spotify'), v(.5, l('stocks'), l('calendar')))),
      v(14/24, l('youtube'), l('sound')),
    ),
    l('hardware'),
  ),

  // Markets: stocks+hardware left | youtube top-right, 2×2 info grid bottom-right
  Markets: v(.5,
    h(12/22, l('stocks'), l('hardware')),
    h(12/22, l('youtube'), v(.5,
      h(6/10, l('spotify'), l('weather')),
      h(6/10, l('calendar'), l('sound')),
    )),
  ),

  // Media: left = youtube stacked on twitch | right = spotify(w=8)+slim info col, stocks+hardware below
  Media: v(.5,
    h(.5, l('youtube'), l('twitch')),
    h(11/22,
      v(8/12, l('spotify'), h(6/11, l('weather'), h(3/5, l('calendar'), l('sound')))),
      v(.5, l('stocks'), l('hardware')),
    ),
  ),

  // System: hardware+2 left | youtube top-right, stocks/weather + sound bottom-right
  System: v(14/24,
    h(11/22, l('hardware'), v(6/14, l('spotify'), l('calendar'))),
    h(11/22, l('youtube'), h(6/11,
      v(.5, l('stocks'), l('weather')),
      l('sound'),
    )),
  ),

  // Focus: spotify full-height left | youtube+stocks top, hardware+weather/sound+calendar bottom
  Focus: v(8/24,
    l('spotify'),
    h(11/22,
      v(10/16, l('youtube'), l('stocks')),
      v(6/16, l('hardware'), v(.5,
        h(6/11, l('weather'), l('sound')),
        l('calendar'),
      )),
    ),
  ),

  // Chill: info strip left | stocks+sound mid | youtube+spotify full-height right
  Chill: v(5/24,
    h(7/22, l('weather'), h(8/15, l('hardware'), l('calendar'))),
    v(6/19,
      h(14/22, l('stocks'), l('sound')),
      v(7/13, l('youtube'), l('spotify')),
    ),
  ),

  // Home: hardware+sound left | stocks+calendar mid | youtube top-right, spotify+weather bottom-right
  // Twitch absent from tree → falls through to bottom-row fallback in generateLayout.
  Home: v(6/24,
    h(19/22, l('hardware'), l('sound')),
    v(6/18,
      h(14/22, l('stocks'), l('calendar')),
      h(12/22, l('youtube'), v(.5, l('spotify'), l('weather'))),
    ),
  ),

  // Wide: stocks+youtube equal top | hardware, spotify, weather/sound, calendar bottom
  Wide: h(11/22,
    v(.5, l('stocks'), l('youtube')),
    v(9/24, l('hardware'), v(7/15,
      l('spotify'),
      v(.5, h(6/11, l('weather'), l('sound')), l('calendar')),
    )),
  ),
};

function pruneTree(node: SplitNode, visible: Set<string>): SplitNode | null {
  if (node.type === 'leaf') return visible.has(node.id) ? node : null;
  const a = pruneTree(node.a, visible);
  const b = pruneTree(node.b, visible);
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return { ...node, a, b } as SplitNode;
}

function renderTree(node: SplitNode, x: number, y: number, w: number, ht: number): Layout[] {
  if (node.type === 'leaf') {
    const c = WIDGET_CONSTRAINTS[node.id];
    return [{ i: node.id, x, y, w, h: ht, minW: c.minW, minH: c.minH }];
  }
  if (node.type === 'v') {
    if (w <= 1) return renderTree(node.a, x, y, w, ht);
    const lw = Math.min(w - 1, Math.max(1, Math.round(w * node.r)));
    return [
      ...renderTree(node.a, x, y, lw, ht),
      ...renderTree(node.b, x + lw, y, w - lw, ht),
    ];
  }
  // node.type === 'h'
  if (ht <= 1) return renderTree(node.a, x, y, w, ht);
  const th = Math.min(ht - 1, Math.max(1, Math.round(ht * node.r)));
  return [
    ...renderTree(node.a, x, y, w, th),
    ...renderTree(node.b, x, y + th, w, ht - th),
  ];
}

/** Generate a gap-free Layout[] for `presetName` containing only `visibleIds`.
 *  Returns null if the preset is unknown or all widgets are hidden. */
export function generateLayout(
  presetName: string,
  visibleIds: WidgetId[],
  cols = 24,
  rows = 22,
): Layout[] | null {
  const tree = PRESET_TREES[presetName];
  if (!tree) return null;
  const pruned = pruneTree(tree, new Set(visibleIds));
  if (!pruned) return null;
  const base = renderTree(pruned, 0, 0, cols, rows);

  // Widgets not woven into this preset's BSP tree (e.g. added after the presets
  // were authored, like `twitch`) won't be emitted by renderTree. Append any
  // such visible widgets as a full-width row at the bottom so every visible
  // widget still gets a non-overlapping slot.
  const placed = new Set(base.map((item) => item.i));
  const missing = visibleIds.filter((id) => !placed.has(id));
  if (missing.length === 0) return base;
  const maxY = Math.max(...base.map((item) => item.y + item.h), 0);
  return [...base, ...appendWidgets(missing, maxY, cols)];
}

/** Lay out `ids` left-to-right starting at row `startY`, each at least its `minW`
 *  wide (so react-grid-layout never warns about minW > w), wrapping to a new row
 *  when the current row would exceed `cols`. */
function appendWidgets(ids: WidgetId[], startY: number, cols = 24): Layout[] {
  if (ids.length === 0) return [];
  const base = Math.max(3, Math.floor(cols / Math.min(ids.length, 6)));
  const out: Layout[] = [];
  let x = 0;
  let y = startY;
  for (const id of ids) {
    const c = WIDGET_CONSTRAINTS[id];
    const w = Math.min(cols, Math.max(c.minW, base));
    if (x + w > cols) { x = 0; y += 6; }
    out.push({ i: id, x, y, w, h: 6, minW: c.minW, minH: c.minH });
    x += w;
  }
  return out;
}

// Appends any widget IDs missing from a stored/custom layout to the bottom row(s).
// Ensures new widgets added to ALL_WIDGET_IDS automatically appear on load.
export function autoFillLayout(layout: Layout[]): Layout[] {
  const existing = new Set(layout.map((item) => item.i));
  const missing = ALL_WIDGET_IDS.filter((id) => !existing.has(id));
  if (missing.length === 0) return layout;
  const maxY = Math.max(...layout.map((item) => item.y + item.h), 0);
  return [...layout, ...appendWidgets(missing, maxY)];
}
