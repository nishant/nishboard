#!/usr/bin/env node
// Version helper for the tag-only release flow (.github/workflows/release.yml).
// The latest v* git tag — NOT package.json — is the version source of truth:
// master is branch-protected, so CI never commits bumps. Instead the release
// workflow computes the next version from the latest tag, pushes only the tag,
// and `set`s the version into the CI workspace's package.json files right
// before `pnpm package` so electron-builder names artifacts correctly and
// app.getVersion() reports the release version.
//
// Usage:
//   bump-version.mjs next <major|minor|patch> <current>   # print next version
//   bump-version.mjs set <version>                        # write both package.json files
import fs from 'fs';

// Root names the artifacts; apps/main feeds app.getVersion() in the packaged app.
const FILES = ['package.json', 'apps/main/package.json'];

function parse(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) {
    console.error(`"${version}" is not plain semver`);
    process.exit(1);
  }
  return m.slice(1).map(Number);
}

const [, , mode, ...args] = process.argv;

if (mode === 'next') {
  const [kind, current] = args;
  if (!['major', 'minor', 'patch'].includes(kind) || !current) {
    console.error('usage: bump-version.mjs next <major|minor|patch> <current>');
    process.exit(1);
  }
  const [major, minor, patch] = parse(current);
  console.log(
    kind === 'major' ? `${major + 1}.0.0` :
    kind === 'minor' ? `${major}.${minor + 1}.0` :
    `${major}.${minor}.${patch + 1}`,
  );
} else if (mode === 'set') {
  const [version] = args;
  if (!version) {
    console.error('usage: bump-version.mjs set <version>');
    process.exit(1);
  }
  parse(version); // validate
  for (const file of FILES) {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    pkg.version = version;
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  }
  console.log(version);
} else {
  console.error('usage: bump-version.mjs next <kind> <current> | set <version>');
  process.exit(1);
}
