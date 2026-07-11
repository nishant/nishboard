#!/usr/bin/env node
// Local packaging wrapper: stamp the REAL version (latest v* tag — the version
// source of truth, see release.yml) into both package.json files, run
// electron-builder, then restore the placeholder versions so the working tree
// stays clean. Without this, local `pnpm package` artifacts are named with the
// committed placeholder (Nishboard-0.1.0-arm64.dmg) and app.getVersion()
// reports 0.1.0 in Settings → About, which breaks the update check's
// "newer version available" comparison.
//
// CI does NOT use this — release.yml checks out the fresh tag and calls
// `bump-version.mjs set` directly.
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';

// Same files bump-version.mjs writes: root names artifacts, apps/main feeds
// app.getVersion().
const FILES = ['package.json', 'apps/main/package.json'];

function latestTagVersion() {
  // Best-effort: pull down tags CI pushed since the last fetch. Offline or
  // credential-less environments just build with whatever tags are local.
  try {
    execFileSync('git', ['fetch', '--tags', '--quiet'], { timeout: 15_000, stdio: 'ignore' });
  } catch {
    console.warn('[package] git fetch --tags failed — using local tags');
  }
  try {
    const out = execFileSync('git', ['tag', '-l', 'v*'], { encoding: 'utf8' });
    const versions = out
      .split('\n')
      .map((t) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(t.trim()))
      .filter((m) => m !== null)
      .map((m) => m.slice(1).map(Number));
    versions.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
    return versions.length > 0 ? versions[0].join('.') : null;
  } catch {
    return null;
  }
}

const version = latestTagVersion();
if (!version) {
  console.warn('[package] no v* tag found — building with placeholder versions');
}

// Snapshot exact file contents (not JSON round-trips) so restore is bytewise.
const snapshots = new Map(FILES.map((f) => [f, fs.readFileSync(f, 'utf8')]));

if (version) {
  console.log(`[package] stamping version ${version} (latest tag)`);
  execFileSync('node', ['scripts/bump-version.mjs', 'set', version], { stdio: 'inherit' });
}

let code = 0;
try {
  // shell:true keeps this working on Windows, where pnpm is pnpm.cmd. No user
  // input reaches this command line.
  const res = spawnSync(
    'pnpm exec electron-builder --config electron-builder.yml --publish never',
    {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    },
  );
  code = res.status ?? 1;
} finally {
  for (const [file, content] of snapshots) fs.writeFileSync(file, content);
  if (version) console.log('[package] restored placeholder versions');
}

process.exit(code);
