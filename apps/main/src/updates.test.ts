import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseAsset } from './updates';
import { compareSemver, normalize, pickAsset } from './updates';

vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: vi.fn(),
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    quitAndInstall: vi.fn(),
  },
}));

describe('compareSemver', () => {
  it('compares numerically, not lexically', () => {
    expect(compareSemver('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('v2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '1.0.1')).toBeLessThan(0);
  });
  it('ranks a prerelease below its release', () => {
    expect(compareSemver('1.0.0', '1.0.0-beta.2')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0-beta.2', '1.0.0')).toBeLessThan(0);
  });
  it('compares prerelease identifiers', () => {
    expect(compareSemver('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0-beta', '1.0.0-1')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    expect(compareSemver('1.0.0-beta', '1.0.0-beta.1')).toBeLessThan(0);
  });
  it('treats equal versions as 0 (v prefix ignored)', () => {
    expect(compareSemver('1.2.3', 'v1.2.3')).toBe(0);
  });
  it('returns 0 for unparseable input', () => {
    expect(compareSemver('garbage', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.0', '')).toBe(0);
    expect(compareSemver('1.0', '1.0.1')).toBe(0);
  });
});

describe('checkUpdates', () => {
  // The stub app reports version 0.0.0-test. checkUpdates memoises for 24h, so
  // each case imports a fresh module.
  async function runWith(tag: string): Promise<{ hasUpdate: boolean; latestVersion: string | null; autoUpdate: boolean }> {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ tag_name: tag, html_url: 'https://gh.test/r', assets: [] }),
    })));
    const mod = await import('./updates');
    return mod.checkUpdates();
  }
  afterEach(() => vi.unstubAllGlobals());

  it('reports no update when the local build is newer than the latest release', async () => {
    const r = await runWith('v0.0.0-alpha'); // 0.0.0-alpha < local 0.0.0-test
    expect(r.latestVersion).toBe('0.0.0-alpha');
    expect(r.hasUpdate).toBe(false);
  });

  it('reports an update when the latest release is newer', async () => {
    const r = await runWith('v0.0.1');
    expect(r.hasUpdate).toBe(true);
    expect(r.autoUpdate).toBe(false); // not packaged under the stub
  });
});

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
