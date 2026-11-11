/// <reference types="node" />
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildCsp, inlineScripts, scriptHash } from './csp';

describe('csp', () => {
  it('hashes the exact script text with sha256', () => {
    const text = 'window.x = 1;';
    const expected = createHash('sha256').update(text).digest('base64');
    expect(scriptHash(text)).toBe(`'sha256-${expected}'`);
    expect(scriptHash(text + ' ')).not.toBe(scriptHash(text));
  });

  it('lists the expected directives', () => {
    const csp = buildCsp(['a', 'b']);
    const directives = csp.split('; ').map((d) => d.split(' ')[0]);
    expect(directives).toEqual([
      'default-src', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src',
      'frame-src', 'media-src', 'worker-src', 'object-src', 'base-uri', 'form-action',
    ]);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain(`script-src 'self' ${scriptHash('a')} ${scriptHash('b')};`);
  });

  it('allows no unsafe script sources', () => {
    const script = buildCsp([]).split('; ').find((d) => d.startsWith('script-src'));
    expect(script).toBe("script-src 'self'");
  });

  it('hashes LF-normalised text for CRLF input, as the browser does', () => {
    const crlf = 'a();\r\nb();\r\n';
    const lf = 'a();\nb();\n';
    const html = `<head><script>${crlf}</script></head>`;
    const [text] = inlineScripts(html);
    expect(text).toBe(lf);
    expect(scriptHash(text ?? '')).toBe(scriptHash(lf));
    expect(scriptHash(crlf)).not.toBe(scriptHash(lf));
  });

  it('inlineScripts skips scripts with a src and keeps the inline ones in order', () => {
    const html = '<script type="module" src="./a.js"></script><script>one();</script><SCRIPT defer>two();</SCRIPT>';
    expect(inlineScripts(html)).toEqual(['one();', 'two();']);
    expect(inlineScripts('<p>none</p>')).toEqual([]);
  });
});
