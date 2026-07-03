import type { FastifyPluginAsync } from 'fastify';
import type { NewsData, NewsItem } from '@dash/shared';
import { fetchText } from '../lib/http';
import { TtlCache } from '../lib/TtlCache';

const TTL_MS = 10 * 60 * 1000;
const cache = new TtlCache<string, NewsData>(TTL_MS);

// Safe codepoint → string: fromCodePoint handles astral chars (emoji) that
// fromCharCode mangles, but throws on out-of-range values — drop those.
function codePoint(n: number): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    // &amp; first so double-encoded entities (e.g. &amp;#39;) still resolve.
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => codePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => codePoint(Number(n)))
    .trim();
}

function pick(block: string, re: RegExp): string {
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : '';
}

function toIso(pubDate: string): string {
  const t = Date.parse(pubDate);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

// Google News titles are "Headline - Source"; drop the trailing source suffix.
function stripSource(title: string, source: string): string {
  if (source && title.endsWith(` - ${source}`)) return title.slice(0, -(source.length + 3)).trim();
  return title;
}

function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null && items.length < 24) {
    const block = m[1];
    const title = pick(block, /<title>([\s\S]*?)<\/title>/);
    const link = pick(block, /<link>([\s\S]*?)<\/link>/);
    if (!title || !link) continue;
    const source = pick(block, /<source[^>]*>([\s\S]*?)<\/source>/);
    items.push({
      title: stripSource(title, source),
      link,
      source,
      pubDate: toIso(pick(block, /<pubDate>([\s\S]*?)<\/pubDate>/)),
    });
  }
  return items;
}

export const newsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { topic?: string }; Reply: NewsData | { error: string } }>(
    '/',
    async (req, reply) => {
      const topic = (req.query.topic ?? '').trim().slice(0, 80);
      const key = topic || 'top';

      const cached = cache.get(key);
      if (cached) return reply.send(cached);

      // Google News RSS — keyless. Top headlines, or a topic search.
      const base = 'https://news.google.com/rss';
      const url = topic
        ? `${base}/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`
        : `${base}?hl=en-US&gl=US&ceid=US:en`;

      const xml = await fetchText(
        url,
        { headers: { 'User-Agent': 'Mozilla/5.0 Nishboard' } },
        { label: 'Google News' },
      );
      const data: NewsData = { items: parseRss(xml), fetchedAt: new Date().toISOString() };
      cache.set(key, data);
      return reply.send(data);
    },
  );
};
