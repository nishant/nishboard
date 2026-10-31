import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpstreamError } from './http';
import { RefreshAuthError, rethrowRefreshFailure } from './userTokenStore';

// The classification decides whether a stored OAuth session gets wiped — a
// wrong answer here once destroyed a valid Twitch session on a transient 4xx.
describe('rethrowRefreshFailure', () => {
  function classify(err: unknown): unknown {
    try {
      rethrowRefreshFailure(err);
    } catch (out) {
      return out;
    }
    throw new Error('rethrowRefreshFailure must always throw');
  }

  it('converts definitive token-endpoint rejections (400/401/403) to RefreshAuthError', () => {
    for (const status of [400, 401, 403]) {
      const out = classify(new UpstreamError(status, `token endpoint ${status}`));
      expect(out).toBeInstanceOf(RefreshAuthError);
      expect((out as RefreshAuthError).status).toBe(status);
    }
  });

  it('rethrows transient upstream failures unchanged (session must survive)', () => {
    for (const status of [408, 429, 500, 502, 503]) {
      const original = new UpstreamError(status, `token endpoint ${status}`);
      const out = classify(original);
      expect(out).toBe(original);
      expect(out).not.toBeInstanceOf(RefreshAuthError);
    }
  });

  it('rethrows network errors and timeouts unchanged', () => {
    const network = new TypeError('fetch failed');
    expect(classify(network)).toBe(network);
    const abort = new DOMException('The operation timed out', 'TimeoutError');
    expect(classify(abort)).toBe(abort);
  });

  it('RefreshAuthError is an UpstreamError (central error handler mapping applies)', () => {
    const err = new RefreshAuthError(401, 'revoked');
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.name).toBe('RefreshAuthError');
  });
});

// File-backed store: encryption at rest
describe('UserTokenStore files', () => {
  const tokens = { access_token: 'acc', refresh_token: 'ref', expires_at: Date.now() + 3_600_000 };
  const dirs: string[] = [];

  async function setup(key: Buffer | null) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tokstore-'));
    dirs.push(home);
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    if (key) process.env.DASH_TOKEN_KEY = key.toString('base64');
    else delete process.env.DASH_TOKEN_KEY;
    vi.resetModules();
    const mod = await import('./userTokenStore');
    const cryptoMod = await import('./tokenCrypto');
    return { home, file: path.join(home, '.dash', 't.json'), Store: mod.UserTokenStore, crypto: cryptoMod };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DASH_TOKEN_KEY;
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  const refresh = async () => tokens;

  it('writes an encrypted file when a key is supplied and removes the env var', async () => {
    const { file, Store, crypto: c } = await setup(crypto.randomBytes(32));
    expect(process.env.DASH_TOKEN_KEY).toBeUndefined();
    new Store('t.json', refresh).store(tokens);
    expect(c.isEncryptedFile(JSON.parse(fs.readFileSync(file, 'utf8')))).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).not.toContain('acc');
    expect(new Store('t.json', refresh).authenticated).toBe(true);
  });

  it('migrates plaintext tokens to an encrypted file', async () => {
    const { home, file, Store, crypto: c } = await setup(crypto.randomBytes(32));
    fs.mkdirSync(path.join(home, '.dash'), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(tokens));
    expect(new Store('t.json', refresh).authenticated).toBe(true);
    expect(c.isEncryptedFile(JSON.parse(fs.readFileSync(file, 'utf8')))).toBe(true);
  });

  it('writes plaintext without a key', async () => {
    const { file, Store } = await setup(null);
    new Store('t.json', refresh).store(tokens);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(tokens);
  });

  it('treats an encrypted file without a key as not connected and leaves it untouched', async () => {
    const { home, file, Store, crypto: c } = await setup(null);
    fs.mkdirSync(path.join(home, '.dash'), { recursive: true });
    const text = JSON.stringify(c.encryptJson(tokens, crypto.randomBytes(32)));
    fs.writeFileSync(file, text);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(new Store('t.json', refresh).authenticated).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe(text);
  });

  it.skipIf(process.platform === 'win32')('writes the file with mode 0600', async () => {
    const { file, Store } = await setup(crypto.randomBytes(32));
    new Store('t.json', refresh).store(tokens);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});
