import vm from 'vm';
import { describe, expect, it } from 'vitest';
import { parseEntries, writeScript } from './storageMigration';

function fakeStorage(initial: Record<string, string>): {
  localStorage: Pick<Storage, 'getItem' | 'setItem'>;
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    localStorage: {
      getItem: (k: string) => (k in data ? data[k] : null),
      setItem: (k: string, v: string) => {
        data[k] = v;
      },
    },
  };
}

describe('parseEntries', () => {
  it('keeps string pairs and drops anything else', () => {
    const dump = JSON.stringify([['a', '1'], ['b', 2], ['c'], 'd', ['e', '5']]);
    expect(parseEntries(dump)).toEqual([['a', '1'], ['e', '5']]);
  });

  it('treats a non-string or non-array result as empty', () => {
    expect(parseEntries(undefined)).toEqual([]);
    expect(parseEntries('{"a":1}')).toEqual([]);
  });
});

describe('writeScript', () => {
  it('copies every key, file:// values winning over saved defaults, and survives awkward text', () => {
    const { localStorage, data } = fakeStorage({ kept: 'new' });
    const notes = JSON.stringify({ state: { notes: ['</script> "quotes" `ticks` ${x}   line'] }, version: 2 });
    const entries: Array<[string, string]> = [
      ['kept', 'old'],
      ['dashboard-notes', notes],
      ['nish-theme', 'mocha'],
    ];
    const copied: unknown = vm.runInNewContext(writeScript(entries), { localStorage });
    expect(copied).toBe(3);
    expect(data).toEqual({ kept: 'old', 'dashboard-notes': notes, 'nish-theme': 'mocha' });
  });
});
