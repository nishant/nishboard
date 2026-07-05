import { afterEach, describe, expect, it } from 'vitest';
import type { ReleaseAsset } from './updates';
import { normalize, pickAsset } from './updates';

describe('normalize', () => {
  it('strips a leading v (any case) and trims', () => {
    expect(normalize('v1.2.3')).toBe('1.2.3');
    expect(normalize('V2.0.0')).toBe('2.0.0');
    expect(normalize(' 1.2.3 ')).toBe('1.2.3');
    expect(normalize('1.2.3')).toBe('1.2.3');
  });
});

describe('pickAsset', () => {
  const asset = (name: string): ReleaseAsset => ({ name, browser_download_url: `https://dl.test/${name}` });
  const realPlatform = process.platform;
  const realArch = process.arch;

  function setPlatform(platform: string, arch: string): void {
    Object.defineProperty(process, 'platform', { value: platform });
    Object.defineProperty(process, 'arch', { value: arch });
  }

  afterEach(() => {
    setPlatform(realPlatform, realArch);
  });

  it('macOS prefers the current-arch DMG over other DMGs', () => {
    setPlatform('darwin', 'arm64');
    const picked = pickAsset([asset('Nishboard-1.0.0-x64.dmg'), asset('Nishboard-1.0.0-arm64.dmg'), asset('Nishboard Setup 1.0.0.exe')]);
    expect(picked?.name).toBe('Nishboard-1.0.0-arm64.dmg');
  });

  it('macOS falls back to any DMG when no arch match exists', () => {
    setPlatform('darwin', 'arm64');
    expect(pickAsset([asset('Nishboard-1.0.0.dmg'), asset('x.exe')])?.name).toBe('Nishboard-1.0.0.dmg');
    expect(pickAsset([asset('only.exe')])).toBeNull();
  });

  it('Windows picks the NSIS exe', () => {
    setPlatform('win32', 'x64');
    expect(pickAsset([asset('Nishboard-1.0.0-arm64.dmg'), asset('Nishboard Setup 1.0.0.exe')])?.name).toBe('Nishboard Setup 1.0.0.exe');
    expect(pickAsset([asset('a.dmg')])).toBeNull();
  });

  it('other platforms get null', () => {
    setPlatform('linux', 'x64');
    expect(pickAsset([asset('a.dmg'), asset('b.exe')])).toBeNull();
  });
});
