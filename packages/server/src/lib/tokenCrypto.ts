import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/** Read DASH_TOKEN_KEY (base64, 32 bytes) once at module load, then delete it
 *  from process.env so child processes (claude CLI, PowerShell) never inherit it. */
const KEY: Buffer | null = (() => {
  const raw = process.env.DASH_TOKEN_KEY;
  delete process.env.DASH_TOKEN_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
})();

/** The token encryption key supplied by the Electron main process, or null
 *  (missing or invalid) — callers then fall back to plaintext with mode 0600. */
export function tokenKey(): Buffer | null {
  return KEY;
}

export interface EncryptedFile {
  v: 1;
  alg: 'aes-256-gcm';
  /** base64 fields */
  iv: string;
  tag: string;
  data: string;
}

export function encryptJson(value: unknown, key: Buffer): EncryptedFile {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

/** Throws on a tampered file or the wrong key (GCM auth failure). */
export function decryptJson<T>(file: EncryptedFile, key: Buffer): T {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(file.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(file.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString('utf8')) as T;
}

export function isEncryptedFile(x: unknown): x is EncryptedFile {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    o.v === 1 &&
    o.alg === 'aes-256-gcm' &&
    typeof o.iv === 'string' &&
    typeof o.tag === 'string' &&
    typeof o.data === 'string'
  );
}

/** Write `text` to `file` atomically (tmp file in the same dir + rename), mode 0o600,
 *  creating the dir with mode 0o700. On Windows rename-over-existing works with fs.renameSync. */
export function writePrivateFile(file: string, text: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw err;
  }
}
