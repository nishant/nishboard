import { describe, expect, it } from 'vitest';
import { migrateLauncherFile } from './launcher';

const item = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'i1',
  label: 'Steam',
  target: 'C:/steam.exe',
  kind: 'app',
  ...over,
});

describe('migrateLauncherFile', () => {
  it('wraps a v1 flat array into a v2 file with no groups', () => {
    const out = migrateLauncherFile([item(), item({ id: 'i2', kind: 'url', target: 'https://x.test' })]);
    expect(out.version).toBe(2);
    expect(out.groups).toEqual([]);
    expect(out.items).toHaveLength(2);
  });

  it('filters invalid entries out of a v1 array', () => {
    const out = migrateLauncherFile([
      item(),
      null,
      'junk',
      item({ id: 42 }), // wrong id type
      item({ kind: 'nope' }), // invalid kind
      item({ target: undefined }), // missing target
    ]);
    expect(out.items.map((i) => i.id)).toEqual(['i1']);
  });

  it('validates a v2 file and drops dangling group references', () => {
    const out = migrateLauncherFile({
      version: 2,
      groups: [{ id: 'g1', label: 'Games' }, { id: 7, label: 'bad' }],
      items: [item({ group: 'g1' }), item({ id: 'i2', group: 'g-deleted' })],
    });
    expect(out.groups).toEqual([{ id: 'g1', label: 'Games' }]);
    expect(out.items[0].group).toBe('g1');
    expect(out.items[1].group).toBeUndefined(); // dangling ref pruned
  });

  it('rejects icons that are not data: URIs (a URL would leak the target hostname)', () => {
    const out = migrateLauncherFile({
      version: 2,
      groups: [],
      items: [
        item({ icon: 'data:image/png;base64,AAAA' }),
        item({ id: 'i2', icon: 'https://example.com/favicon.ico' }),
      ],
    });
    expect(out.items.map((i) => i.id)).toEqual(['i1']);
    expect(out.items[0].icon).toBe('data:image/png;base64,AAAA');
  });

  it('returns an empty v2 file for garbage input', () => {
    for (const garbage of [null, undefined, 'text', 42, { version: 1 }, { version: 3, items: [item()] }]) {
      expect(migrateLauncherFile(garbage)).toEqual({ version: 2, groups: [], items: [] });
    }
  });

  it('tolerates v2 files with missing arrays', () => {
    expect(migrateLauncherFile({ version: 2 })).toEqual({ version: 2, groups: [], items: [] });
    expect(migrateLauncherFile({ version: 2, groups: 'x', items: 5 })).toEqual({ version: 2, groups: [], items: [] });
  });
});
