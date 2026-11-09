import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAppThemesCss } from './appThemesCss';

// Read with fs: vitest's css pipeline returns an empty string for `?raw` on .css.
const committed = readFileSync(
  resolve(process.cwd(), 'src/styles/app-themes.css'),
  'utf8',
);

describe('app-themes.css', () => {
  it('matches the generator output (run `pnpm --filter @dash/renderer gen:themes`)', () => {
    expect(committed.replace(/\r\n/g, '\n')).toBe(buildAppThemesCss());
  });

  it('includes the derived form-control border in every preset', () => {
    const blocks = (buildAppThemesCss().match(/\[data-theme=/g) ?? []).length;
    expect((committed.match(/--nish-line-control:/g) ?? []).length).toBe(blocks);
  });
});
