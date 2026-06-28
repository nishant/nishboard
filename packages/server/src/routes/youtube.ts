import type { FastifyPluginAsync } from 'fastify';
import type { YoutubeVideo, YoutubeSearchPage } from '@dash/shared';

const BASE = 'https://www.googleapis.com/youtube/v3';

export const youtubeRoutes: FastifyPluginAsync = async (fastify) => {
  const apiKey = process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY_BUILTIN;

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
    if (!apiKey) {
      return reply.status(503).send({ error: 'YOUTUBE_API_KEY not configured' });
    }

    const { q, pageToken } = req.query;
    if (!q?.trim()) return reply.status(400).send({ error: 'q is required' });

    const url = new URL(`${BASE}/search`);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('q', q.trim());
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', '12');
    url.searchParams.set('safeSearch', 'none');
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text();
      req.log.error({ status: res.status, body }, 'YouTube API error');
      return reply.status(502).send({ error: 'YouTube API error' });
    }

    const data = await res.json() as {
      nextPageToken?: string;
      items: Array<{
        id: { videoId: string };
        snippet: {
          title: string;
          channelTitle: string;
          thumbnails: { medium?: { url: string }; default?: { url: string } };
          publishedAt: string;
        };
      }>;
    };

    const page: YoutubeSearchPage = {
      nextPageToken: data.nextPageToken ?? null,
      items: data.items.map((item): YoutubeVideo => ({
        videoId: item.id.videoId,
        title: decodeHTMLEntities(item.snippet.title),
        channelTitle: item.snippet.channelTitle,
        thumbnailUrl: item.snippet.thumbnails.medium?.url ?? item.snippet.thumbnails.default?.url ?? '',
        publishedAt: item.snippet.publishedAt,
      })),
    };

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
