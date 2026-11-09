import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `electron` is the stub (vitest alias): safeStorage reports encryption as
// unavailable, so values are stored as plaintext and the file is easy to read.
// vi.resetModules() gives the stub a fresh userData dir; beforeEach records it.
let dir = '';
const file = (): string => path.join(dir, 'credentials.json');
const stored = (): Record<string, unknown> => JSON.parse(fs.readFileSync(file(), 'utf8')) as Record<string, unknown>;

describe('credentials whitelist', () => {
  beforeEach(async () => {
    vi.resetModules();
    dir = (await import('electron')).app.getPath('userData');
    fs.rmSync(file(), { force: true });
  });
  afterEach(() => {
    fs.rmSync(file(), { force: true });
  });

  it('persists only whitelisted keys, so a renderer cannot inject NODE_OPTIONS', async () => {
    const { writeCredentials, readCredentials } = await import('./credentials');
    await writeCredentials({ NODE_OPTIONS: '--require x', SPOTIFY_CLIENT_ID: 'a' } as never);
    expect(stored()).toEqual({ SPOTIFY_CLIENT_ID: 'a' });
    expect(readCredentials()).toEqual({ SPOTIFY_CLIENT_ID: 'a' });
  });

  it('clears a key with an empty string and keeps untouched keys', async () => {
    const { writeCredentials } = await import('./credentials');
    await writeCredentials({ SPOTIFY_CLIENT_ID: 'a', YOUTUBE_API_KEY: 'b' });
    await writeCredentials({ SPOTIFY_CLIENT_ID: '' });
    expect(stored()).toEqual({ YOUTUBE_API_KEY: 'b' });
  });

  it('filters unknown keys and non-strings from a hand-edited file on read', async () => {
    fs.writeFileSync(file(), JSON.stringify({ PATH: '/evil', NODE_OPTIONS: 'x', SPOTIFY_CLIENT_ID: 'ok', YOUTUBE_API_KEY: 5 }));
    const { loadCredentials, readCredentials, readCredentialStatus } = await import('./credentials');
    await loadCredentials();
    expect(readCredentials()).toEqual({ SPOTIFY_CLIENT_ID: 'ok' });
    expect(readCredentialStatus()).toEqual({ SPOTIFY_CLIENT_ID: true });
  });

  it('treats a corrupt file as empty', async () => {
    fs.writeFileSync(file(), '{not json');
    const { loadCredentials, readCredentials } = await import('./credentials');
    await loadCredentials();
    expect(readCredentials()).toEqual({});
  });
});
