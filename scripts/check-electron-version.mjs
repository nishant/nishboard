#!/usr/bin/env node
// Fails when the Electron version is pinned in different places. Dependabot
// bumps apps/main/package.json only; without this check, dev and tests would
// run the new Electron while packaged releases keep shipping the old one
// (electron-builder.yml electronVersion) and the pnpm minimumReleaseAge
// exclusion (pnpm-workspace.yaml) would stop covering it.
import fs from 'fs';

const read = (f) => fs.readFileSync(f, 'utf8');
const pkg = JSON.parse(read('apps/main/package.json')).devDependencies?.electron;
const builder = /^\s*electronVersion:\s*["']?([^"'\s#]+)/m.exec(read('electron-builder.yml'))?.[1];
const exclude = /^\s*-\s*electron@([^\s#]+)/m.exec(read('pnpm-workspace.yaml'))?.[1];

const problems = [];
if (!pkg) problems.push('apps/main/package.json has no devDependencies.electron');
if (!builder) problems.push('electron-builder.yml has no electronVersion');
if (!exclude) problems.push('pnpm-workspace.yaml minimumReleaseAgeExclude has no electron@X entry');
if (pkg && builder && pkg !== builder) {
  problems.push(`electron-builder.yml electronVersion is ${builder} but apps/main/package.json has ${pkg}`);
}
if (pkg && exclude && pkg !== exclude) {
  problems.push(`pnpm-workspace.yaml excludes electron@${exclude} but apps/main/package.json has ${pkg}`);
}

if (problems.length > 0) {
  console.error('Electron version mismatch:\n  - ' + problems.join('\n  - '));
  console.error('Update all three together: apps/main/package.json, electron-builder.yml, pnpm-workspace.yaml.');
  process.exit(1);
}
console.log(`Electron version ${pkg} is consistent.`);
