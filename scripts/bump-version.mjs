#!/usr/bin/env node
// Bump the version in root package.json AND apps/main/package.json in lockstep,
// print the new version. The two must never drift: electron-builder names
// artifacts from the root version, while app.getVersion() (Settings → About,
// update check) reads the packaged apps/main/package.json.
//
// Usage: node scripts/bump-version.mjs <major|minor|patch>
import fs from 'fs';

const kind = process.argv[2];
if (!['major', 'minor', 'patch'].includes(kind)) {
  console.error('usage: bump-version.mjs <major|minor|patch>');
  process.exit(1);
}

const FILES = ['package.json', 'apps/main/package.json'];

const current = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
if (!m) {
  console.error(`root package.json version "${current}" is not plain semver`);
  process.exit(1);
}
const [major, minor, patch] = m.slice(1).map(Number);
const next =
  kind === 'major' ? `${major + 1}.0.0` :
  kind === 'minor' ? `${major}.${minor + 1}.0` :
  `${major}.${minor}.${patch + 1}`;

for (const file of FILES) {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.version = next;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}

console.log(next);
