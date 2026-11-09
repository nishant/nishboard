// Writes src/styles/app-themes.css: one [data-theme='<id>'] block of --nish-*
// colors per Nishboard preset, derived by src/lib/themeVars.ts from the colors in
// src/lib/appPresets.ts (the builder lives in src/lib/appThemesCss.ts so a test
// can compare it to the committed file). Run with
// `pnpm --filter @dash/renderer gen:themes` (plain Node — type stripping — no
// build step). Commit the output.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAppThemesCss } from '../src/lib/appThemesCss.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), '../src/styles/app-themes.css');
const css = buildAppThemesCss();
writeFileSync(out, css);
console.log(`wrote ${(css.match(/\[data-theme=/g) ?? []).length} presets → ${out}`);
