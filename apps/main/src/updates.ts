import { app } from 'electron';
import { readCredentials } from './credentials';
import type { UpdateCheckData } from '@dash/shared';

// Manual update check against GitHub releases. Optional GITHUB_TOKEN credential
// covers the private-repo case. Releases are produced by the tag-triggered
// .github/workflows/release.yml (push a v* tag → DMG + EXE attached).

const REPO = 'nishant/nishboard';
const MEMO_MS = 24 * 60 * 60 * 1000;

let memo: { data: UpdateCheckData; at: number } | null = null;

/** Exported for tests. */
export function normalize(tag: string): string {
  return tag.replace(/^v/i, '').trim();
}

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

/** The installer asset for THIS platform, or null. macOS: prefer the current
 *  arch's DMG (…-arm64.dmg) over any other .dmg; Windows: the NSIS .exe.
 *  Exported for tests. */
export function pickAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
  if (process.platform === 'darwin') {
    const dmgs = assets.filter((a) => a.name.endsWith('.dmg'));
    return dmgs.find((a) => a.name.includes(`-${process.arch}`)) ?? dmgs[0] ?? null;
  }
  if (process.platform === 'win32') {
    return assets.find((a) => a.name.endsWith('.exe')) ?? null;
  }
  return null;
}

export async function checkUpdates(): Promise<UpdateCheckData> {
  const currentVersion = app.getVersion();
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.data;

  const token = readCredentials().GITHUB_TOKEN;
  const none = { latestVersion: null, url: null, assetUrl: null, assetName: null, hasUpdate: false };
  let data: UpdateCheckData;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 404) {
      // No releases yet — or a private repo without a token (GitHub 404s both).
      data = {
        currentVersion, ...none,
        message: token
          ? 'No releases yet — you are on the development build.'
          : 'No releases found. If the repo is private, add a GitHub token in Settings → Developer.',
      };
    } else if (!res.ok) {
      data = {
        currentVersion, ...none,
        message: `GitHub returned ${res.status} — try again later.`,
      };
    } else {
      const release = (await res.json()) as {
        tag_name?: string;
        html_url?: string;
        assets?: ReleaseAsset[];
      };
      const latestVersion = release.tag_name ? normalize(release.tag_name) : null;
      const hasUpdate = latestVersion !== null && latestVersion !== normalize(currentVersion);
      const asset = hasUpdate ? pickAsset(release.assets ?? []) : null;
      data = {
        currentVersion,
        latestVersion,
        url: release.html_url ?? null,
        assetUrl: asset?.browser_download_url ?? null,
        assetName: asset?.name ?? null,
        hasUpdate,
        message: hasUpdate ? undefined : 'You are up to date.',
      };
    }
  } catch {
    return { // network failure: don't memo — the next click should retry
      currentVersion, ...none,
      message: 'Update check failed — network unavailable?',
    };
  }

  memo = { data, at: Date.now() };
  return data;
}
