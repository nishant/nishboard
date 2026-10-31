import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('loadTokenKey', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'tokkey-'));
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    vi.resetModules();
  });

  async function storage() {
    return (await import('electron')).safeStorage;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('returns null and writes nothing when encryption is unavailable', async () => {
    const { loadTokenKey } = await import('./tokenKey');
    expect(await loadTokenKey()).toBeNull();
    expect(fs.existsSync(path.join(home, '.dash', '.token-key'))).toBe(false);
  });

  it('creates a 32-byte key, stores it encrypted, and reuses it', async () => {
    vi.spyOn(await storage(), 'isAsyncEncryptionAvailable').mockResolvedValue(true);
    const { loadTokenKey } = await import('./tokenKey');
    const key = await loadTokenKey();
    expect(key).not.toBeNull();
    expect(Buffer.from(key ?? '', 'base64')).toHaveLength(32);
    expect(fs.existsSync(path.join(home, '.dash', '.token-key'))).toBe(true);

    vi.resetModules();
    vi.spyOn(await storage(), 'isAsyncEncryptionAvailable').mockResolvedValue(true);
    const again = await import('./tokenKey');
    expect(await again.loadTokenKey()).toBe(key);
  });

  it('does not overwrite an undecryptable key file', async () => {
    vi.spyOn(await storage(), 'isAsyncEncryptionAvailable').mockResolvedValue(true);
    vi.spyOn(await storage(), 'decryptStringAsync').mockRejectedValue(new Error('bad'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const file = path.join(home, '.dash', '.token-key');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'garbage');
    const { loadTokenKey } = await import('./tokenKey');
    expect(await loadTokenKey()).toBeNull();
    expect(fs.readFileSync(file, 'utf8')).toBe('garbage');
  });

  it('accepts the { result } return shape of Electron 45', async () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    vi.spyOn(await storage(), 'isAsyncEncryptionAvailable').mockResolvedValue(true);
    vi.spyOn(await storage(), 'decryptStringAsync').mockResolvedValue({ result: key, shouldReEncrypt: false });
    const file = path.join(home, '.dash', '.token-key');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'x');
    const { loadTokenKey } = await import('./tokenKey');
    expect(await loadTokenKey()).toBe(key);
  });
});
