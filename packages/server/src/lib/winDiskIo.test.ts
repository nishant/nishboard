import { describe, expect, it } from 'vitest';
import { parseDiskIo, readWinDiskIo } from './winDiskIo';

describe('parseDiskIo', () => {
  it('converts bytes/s to MB/s with 2 decimals', () => {
    expect(parseDiskIo('10485760 2621440\r\n')).toEqual({ readMBs: 10, writeMBs: 2.5 });
    expect(parseDiskIo('0 0')).toEqual({ readMBs: 0, writeMBs: 0 });
    expect(parseDiskIo('1.5E+7 123456.78')).toEqual({ readMBs: 14.31, writeMBs: 0.12 });
  });
  it('returns null for unusable output', () => {
    expect(parseDiskIo('')).toBeNull();
    expect(parseDiskIo('1')).toBeNull();
    expect(parseDiskIo('1 2 3')).toBeNull();
    expect(parseDiskIo('NaN 5')).toBeNull();
    expect(parseDiskIo('Infinity 5')).toBeNull();
    expect(parseDiskIo('1,5 2')).toBeNull();
  });
});

describe('readWinDiskIo', () => {
  it('runs the snippet through the injected runner', async () => {
    let script = '';
    const out = await readWinDiskIo(async (s) => {
      script = s;
      return '1048576 0';
    });
    expect(out).toEqual({ readMBs: 1, writeMBs: 0 });
    expect(script).toContain('PhysicalDisk');
  });
  it('returns null when the runner rejects', async () => {
    expect(await readWinDiskIo(async () => Promise.reject(new Error('boom')))).toBeNull();
  });
});
