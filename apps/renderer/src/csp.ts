/// <reference types="node" />
import { createHash } from 'node:crypto';

const SERVER_ORIGINS = 'http://127.0.0.1:7432 http://localhost:7432';

/** SHA-256 CSP source (`'sha256-…'`) for the exact text of an inline script. */
export function scriptHash(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/** Content-Security-Policy for the packaged renderer. Every inline script is allowed by
 *  hash only; everything else must come from the bundle ('self') or the local server. */
export function buildCsp(inlineScripts: string[]): string {
  const scriptSrc = ["'self'", ...inlineScripts.map(scriptHash)].join(' ');
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https: ${SERVER_ORIGINS}`,
    "font-src 'self' data:",
    `connect-src 'self' ${SERVER_ORIGINS}`,
    `frame-src ${SERVER_ORIGINS} https://www.rainviewer.com https://discord.com https://*.discord.com`,
    "media-src 'self' data: blob: https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
