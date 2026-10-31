import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson, isEncryptedFile } from './tokenCrypto';

const key = crypto.randomBytes(32);

describe('tokenCrypto', () => {
  it('round-trips a value', () => {
    const value = { access_token: 'a', refresh_token: 'r', expires_at: 1 };
    const file = encryptJson(value, key);
    expect(isEncryptedFile(file)).toBe(true);
    expect(JSON.stringify(file)).not.toContain('refresh_token');
    expect(decryptJson(file, key)).toEqual(value);
  });

  it('uses a fresh iv each time', () => {
    expect(encryptJson({ a: 1 }, key).iv).not.toBe(encryptJson({ a: 1 }, key).iv);
  });

  it('throws when the ciphertext is tampered with', () => {
    const file = encryptJson({ a: 1 }, key);
    const data = Buffer.from(file.data, 'base64');
    data[0] ^= 0xff;
    expect(() => decryptJson({ ...file, data: data.toString('base64') }, key)).toThrow();
  });

  it('throws with the wrong key', () => {
    const file = encryptJson({ a: 1 }, key);
    expect(() => decryptJson(file, crypto.randomBytes(32))).toThrow();
  });

  it('isEncryptedFile rejects other shapes', () => {
    expect(isEncryptedFile(null)).toBe(false);
    expect(isEncryptedFile('x')).toBe(false);
    expect(isEncryptedFile({ access_token: 'a' })).toBe(false);
    expect(isEncryptedFile({ ...encryptJson(1, key), v: 2 })).toBe(false);
    expect(isEncryptedFile({ ...encryptJson(1, key), tag: 5 })).toBe(false);
  });
});
