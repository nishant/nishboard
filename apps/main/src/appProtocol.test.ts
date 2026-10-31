import path from 'path';
import { describe, expect, it } from 'vitest';
import { APP_ORIGIN, appUrl, resolveAppPath } from './appProtocol';

const root = path.resolve('/srv/renderer/dist');

describe('resolveAppPath', () => {
  it('serves index.html for the root and files under the renderer build', () => {
    expect(resolveAppPath(root, 'app://nishboard/')).toBe(path.join(root, 'index.html'));
    expect(resolveAppPath(root, 'app://nishboard/index.html?widget=notes')).toBe(path.join(root, 'index.html'));
    expect(resolveAppPath(root, 'app://nishboard/assets/index-abc.js')).toBe(path.join(root, 'assets', 'index-abc.js'));
    expect(resolveAppPath(root, 'app://nishboard/assets/a%20b.png')).toBe(path.join(root, 'assets', 'a b.png'));
  });

  it('never leaves the renderer build, however the path is spelled', () => {
    for (const url of [
      'app://nishboard/../secret.txt',
      'app://nishboard/%2e%2e/secret.txt',
      'app://nishboard/assets/%2e%2e/%2e%2e/secret.txt',
      'app://nishboard/..%2fsecret.txt',
      'app://nishboard/..%5csecret.txt',
      'app://nishboard/%E0',
    ]) {
      const file = resolveAppPath(root, url);
      expect(file === null || file.startsWith(root + path.sep), url).toBe(true);
    }
  });

  it('refuses another host or scheme', () => {
    expect(resolveAppPath(root, 'app://evil/index.html')).toBeNull();
    expect(resolveAppPath(root, 'file:///srv/renderer/dist/index.html')).toBeNull();
    expect(resolveAppPath(root, 'not a url')).toBeNull();
  });
});

describe('appUrl', () => {
  it('points at index.html on the app origin, with the popout query', () => {
    expect(APP_ORIGIN).toBe('app://nishboard');
    expect(appUrl()).toBe('app://nishboard/index.html');
    expect(appUrl({ widget: 'claude' })).toBe('app://nishboard/index.html?widget=claude');
  });
});
