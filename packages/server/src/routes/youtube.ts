import type { FastifyPluginAsync } from 'fastify';
import type { YoutubeVideo, YoutubeSearchPage } from '@dash/shared';
import { fetchJson, HttpError } from '../lib/http';
import { TtlCache } from '../lib/TtlCache';
import { cred } from '../lib/env';

const BASE = 'https://www.googleapis.com/youtube/v3';

// Each search costs 100 of the 10,000/day quota units (~100 searches/day).
// The renderer's search-on-Enter + client cache is the first line of defense,
// but nothing server-side stopped a stuck client or a second window from
// burning the whole day's quota. Budget slightly under the real limit and
// cache responses so repeat queries are free.
const SEARCH_CACHE = new TtlCache<string, YoutubeSearchPage>(10 * 60 * 1000);
const DAILY_SEARCH_BUDGET = 90;
let budgetDay = '';
let searchesToday = 0;

function takeSearchBudget(): boolean {
  // YouTube quota resets at midnight Pacific; local-date granularity is close
  // enough for a personal budget.
  const today = new Date().toDateString();
  if (today !== budgetDay) {
    budgetDay = today;
    searchesToday = 0;
  }
  if (searchesToday >= DAILY_SEARCH_BUDGET) return false;
  searchesToday += 1;
  return true;
}

export const youtubeRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /api/youtube/embed?videoId=...
  // Serves a minimal HTML page embedding the YouTube player. The parent origin
  // becomes http://localhost:7432 instead of file://, which YouTube accepts.
  fastify.get<{ Querystring: { videoId: string } }>('/embed', async (req, reply) => {
    const { videoId } = req.query;
    if (!videoId || !/^[A-Za-z0-9_-]{6,16}$/.test(videoId)) {
      return reply.status(400).send('Invalid videoId');
    }
    const embedSrc = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="referrer" content="origin">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body,iframe{width:100%;height:100%;border:none;background:#000}</style>
</head>
<body>
<iframe src="${embedSrc}" allow="autoplay;encrypted-media;fullscreen;picture-in-picture" allowfullscreen></iframe>
</body>
</html>`;
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // GET /api/youtube/search?q=...&pageToken=...
  fastify.get<{
    Querystring: { q: string; pageToken?: string };
  }>('/search', async (req, reply) => {
    const apiKey = cred('YOUTUBE_API_KEY');
    if (!apiKey) throw new HttpError(503, 'YOUTUBE_API_KEY not configured');

    const { q, pageToken } = req.query;
    if (!q?.trim()) throw new HttpError(400, 'q is required');

    const cacheKey = `${q.trim().toLowerCase()}|${pageToken ?? ''}`;
    const cached = SEARCH_CACHE.get(cacheKey);
    if (cached) return reply.send(cached);

    if (!takeSearchBudget()) {
      throw new HttpError(429, 'Daily YouTube search budget reached — resets tomorrow');
    }

    const url = new URL(`${BASE}/search`);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('q', q.trim());
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', '12');
    url.searchParams.set('safeSearch', 'none');
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const data = await fetchJson<{
      nextPageToken?: string;
      items?: Array<{
        id: { videoId: string };
        snippet: {
          title: string;
          channelTitle: string;
          thumbnails: { medium?: { url: string }; default?: { url: string } };
          publishedAt: string;
        };
      }>;
    }>(url.toString(), undefined, { label: 'YouTube API' });

    const page: YoutubeSearchPage = {
      nextPageToken: data.nextPageToken ?? null,
      items: (data.items ?? []).map((item): YoutubeVideo => ({
        videoId: item.id.videoId,
        title: decodeHTMLEntities(item.snippet.title),
        channelTitle: item.snippet.channelTitle,
        thumbnailUrl: item.snippet.thumbnails.medium?.url ?? item.snippet.thumbnails.default?.url ?? '',
        publishedAt: item.snippet.publishedAt,
      })),
    };

    SEARCH_CACHE.set(cacheKey, page);
    return reply.send(page);
  });
};

// YouTube API returns HTML-encoded titles (&amp; etc)
function decodeHTMLEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
