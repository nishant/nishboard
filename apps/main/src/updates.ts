import { app } from 'electron';
import { readCredentials } from './credentials';
import type { UpdateCheckData } from '@dash/shared';

// Manual update check against GitHub releases (no releases exist yet — the
// common result is the friendly "No releases yet" message). Optional
// GITHUB_TOKEN credential covers the private-repo case.

const REPO = 'nishant/nishboard';
const MEMO_MS = 24 * 60 * 60 * 1000;

let memo: { data: UpdateCheckData; at: number } | null = null;

function normalize(tag: string): string {
  return tag.replace(/^v/i, '').trim();
}

export async function checkUpdates(): Promise<UpdateCheckData> {
  const currentVersion = app.getVersion();
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.data;

  const token = readCredentials().GITHUB_TOKEN;
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
        currentVersion, latestVersion: null, url: null, hasUpdate: false,
        message: token
          ? 'No releases yet — you are on the development build.'
          : 'No releases found. If the repo is private, add a GitHub token in Settings → Developer.',
      };
    } else if (!res.ok) {
      data = {
        currentVersion, latestVersion: null, url: null, hasUpdate: false,
        message: `GitHub returned ${res.status} — try again later.`,
      };
    } else {
      const release = (await res.json()) as { tag_name?: string; html_url?: string };
      const latestVersion = release.tag_name ? normalize(release.tag_name) : null;
      const hasUpdate = latestVersion !== null && latestVersion !== normalize(currentVersion);
      data = {
        currentVersion,
        latestVersion,
        url: release.html_url ?? null,
        hasUpdate,
        message: hasUpdate ? undefined : 'You are up to date.',
      };
    }
  } catch {
    return { // network failure: don't memo — the next click should retry
      currentVersion, latestVersion: null, url: null, hasUpdate: false,
      message: 'Update check failed — network unavailable?',
    };
  }

  memo = { data, at: Date.now() };
  return data;
}
