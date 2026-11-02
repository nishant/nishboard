import type { TwitchCategory, TwitchChannel, TwitchVideo } from '@dash/shared';

/** Helix rows are unvalidated upstream JSON — every field is optional here. */
export interface HelixVideo {
  id?: string;
  title?: string;
  user_name?: string;
  thumbnail_url?: string;
  duration?: string;
  created_at?: string;
  view_count?: number;
}
export interface HelixClip {
  id?: string;
  title?: string;
  broadcaster_name?: string;
  thumbnail_url?: string;
  duration?: number;
  created_at?: string;
  view_count?: number;
}
export interface HelixCategory {
  id?: string;
  name?: string;
  box_art_url?: string;
}
export interface HelixStream {
  user_id?: string;
  user_login?: string;
  user_name?: string;
  title?: string;
  game_name?: string;
  thumbnail_url?: string;
  started_at?: string;
  type?: string;
}

/** Upgrades http to https; anything else (or empty) becomes ''. */
function httpsUrl(url: string | undefined): string {
  if (!url) return '';
  if (url.startsWith('https://')) return url;
  if (url.startsWith('http://')) return `https://${url.slice('http://'.length)}`;
  return '';
}

/** Fills a Helix image template ("{width}x{height}" or "%{width}x%{height}") and forces https. */
export function fillThumb(template: string | undefined, width: number, height: number): string {
  return httpsUrl(template?.replace(/%?\{width\}x%?\{height\}/g, `${width}x${height}`));
}

/** "1h2m3s" to seconds. Anything unreadable is 0. */
export function parseDuration(d: string | undefined): number {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(d ?? '');
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export function mapVideo(v: HelixVideo, login: string): TwitchVideo {
  return {
    kind: 'vod',
    id: v.id ?? '',
    title: v.title ?? '',
    login,
    displayName: v.user_name ?? login,
    thumbnailUrl: fillThumb(v.thumbnail_url, 320, 180),
    durationSeconds: parseDuration(v.duration),
    createdAt: v.created_at ?? '',
    views: v.view_count ?? 0,
  };
}

export function mapClip(c: HelixClip, login: string): TwitchVideo {
  return {
    kind: 'clip',
    id: c.id ?? '',
    title: c.title ?? '',
    login,
    displayName: c.broadcaster_name ?? login,
    thumbnailUrl: fillThumb(c.thumbnail_url, 320, 180),
    durationSeconds: Math.round(c.duration ?? 0),
    createdAt: c.created_at ?? '',
    views: c.view_count ?? 0,
  };
}

export function mapCategory(c: HelixCategory): TwitchCategory {
  return {
    id: c.id ?? '',
    name: c.name ?? '',
    // search/categories returns pre-sized URLs (-52x72.jpg); ask for the larger size.
    boxArtUrl: fillThumb(c.box_art_url, 144, 192).replace(/-\d+x\d+(\.(?:jpg|png))$/, '-144x192$1'),
  };
}

export function mapStream(s: HelixStream): TwitchChannel {
  const login = (s.user_login ?? '').toLowerCase();
  return {
    id: s.user_id ?? '',
    login,
    displayName: s.user_name ?? login,
    thumbnailUrl: fillThumb(s.thumbnail_url, 320, 180),
    isLive: true,
    title: s.title ?? '',
    gameName: s.game_name ?? '',
    startedAt: s.started_at || null,
  };
}
