import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRows, matchParamCommand, registerParamCommands } from './commandRegistry';
import type { PaletteAction } from './commandRegistry';

const ran: string[] = [];
const run = (id: string) => () => void ran.push(id);

const actions: PaletteAction[] = [
  { id: 'app:about', title: 'About', group: 'App', run: run('app:about') },
  { id: 'widget:x', title: 'Show widget: Markets', group: 'Widgets', keywords: 'toggle tile', run: run('widget:x') },
  { id: 'layout:reset', title: 'Widgets: Reset layout', group: 'Layouts', run: run('layout:reset') },
  { id: 'timer:fill', title: 'Start a timer…', group: 'Timers', fill: 'timer ', run: run('ignored') },
];

beforeAll(() => {
  registerParamCommands([
    {
      id: 'timer:fill',
      triggers: ['timer'],
      group: 'Timers',
      argHint: '<duration> [label]',
      parse: (args) => (/^\d+m/.test(args) ? { preview: `Start ${args} timer`, run: run('timer:run') } : null),
    },
  ]);
});

beforeEach(() => {
  ran.length = 0;
  localStorage.clear();
});

describe('matchParamCommand', () => {
  it('matches the trigger and reports unparsed args as null', () => {
    expect(matchParamCommand('timer 25m')?.parsed?.preview).toBe('Start 25m timer');
    expect(matchParamCommand('timer')?.parsed).toBeNull();
    expect(matchParamCommand('markets')).toBeNull();
  });
});

describe('buildRows', () => {
  it('empty query: recents first, then the rest in fixed group order', () => {
    const rows = buildRows('', actions, ['app:about', 'gone']);
    expect(rows.map((r) => r.id)).toEqual(['app:about', 'layout:reset', 'widget:x', 'timer:fill']);
    expect(rows[0].group).toBe('Recent');
    expect(rows.slice(1).map((r) => r.group)).toEqual(['Layouts', 'Widgets', 'Timers']);
  });

  it('parameterised query that parses puts the preview row first and records a recent when run', () => {
    const rows = buildRows('timer 25m tea', actions, []);
    expect(rows[0].label).toBe('Start 25m tea timer');
    expect(rows[0].group).toBe('Command');
    rows[0].onSelect?.();
    expect(ran).toEqual(['timer:run']);
    expect(JSON.parse(localStorage.getItem('dashboard-palette-recents') ?? '[]')).toEqual(['timer:fill']);
  });

  it('unparsable args give a hint row that does nothing', () => {
    const rows = buildRows('timer ', actions, []);
    expect(rows[0].label).toBe('Start a timer…');
    expect(rows[0].hint).toBe('timer <duration> [label]');
    rows[0].onSelect?.();
    expect(ran).toEqual([]);
  });

  it('fill rows show the syntax as a hint and do nothing on select', () => {
    const fill = buildRows('', actions, []).find((r) => r.id === 'timer:fill');
    expect(fill?.hint).toBe('timer <duration> [label]');
    fill?.onSelect?.();
    expect(ran).toEqual([]);
  });

  it('non-empty query fuzzy-ranks, matches keywords, and runs actions with a recent', () => {
    const rows = buildRows('tile', actions, []);
    expect(rows.map((r) => r.id)).toEqual(['widget:x']);
    rows[0].onSelect?.();
    expect(ran).toEqual(['widget:x']);
    expect(JSON.parse(localStorage.getItem('dashboard-palette-recents') ?? '[]')).toEqual(['widget:x']);
  });

  it('caps the list at 40 rows', () => {
    const many = Array.from({ length: 60 }, (_, i): PaletteAction => ({ id: `a${i}`, title: `Item ${i}`, group: 'App', run: vi.fn() }));
    expect(buildRows('', many, [])).toHaveLength(40);
  });
});
