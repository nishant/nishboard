import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { NewsData } from '@dash/shared';
import { buildServer } from '../app';
import { stubFetch, textRes } from '../test/fetchStub';

// NOTE: module-level TTL cache keyed by topic — distinct topics per test.

const RSS = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title><![CDATA[Fed holds rates steady - Reuters]]></title>
    <link>https://news.test/fed</link>
    <pubDate>Sun, 05 Jul 2026 12:00:00 GMT</pubDate>
    <source url="https://reuters.com">Reuters</source>
  </item>
  <item>
    <title>Apple&amp;#39;s new chip &amp;quot;ships&amp;quot; &lt;soon&gt;</title>
    <link>https://news.test/apple</link>
    <pubDate>not-a-date</pubDate>
    <source url="https://verge.com">The Verge</source>
  </item>
  <item>
    <title>No link — must be skipped</title>
    <pubDate>Sun, 05 Jul 2026 13:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({ logger: false });
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/news', () => {
  it('parses Google News RSS: CDATA, entities, source suffix, dates', async () => {
    stubFetch([['news.google.com/rss', () => textRes(RSS)]]);
    const res = await app.inject({ method: 'GET', url: '/api/news?topic=markets-test' });
    expect(res.statusCode).toBe(200);
    const data = res.json<NewsData>();

    expect(data.items).toHaveLength(2); // link-less item dropped

    // CDATA unwrapped + " - Source" suffix stripped + pubDate → ISO.
    expect(data.items[0]).toEqual({
      title: 'Fed holds rates steady',
      link: 'https://news.test/fed',
      source: 'Reuters',
      pubDate: '2026-07-05T12:00:00.000Z',
    });

    // Double-encoded entities resolve; bad dates become ''.
    expect(data.items[1].title).toBe('Apple\'s new chip "ships" <soon>');
    expect(data.items[1].pubDate).toBe('');
  });

  it('propagates an upstream failure as 502', async () => {
    stubFetch([['news.google.com/rss', () => textRes('nope', 500)]]);
    const res = await app.inject({ method: 'GET', url: '/api/news?topic=dead-upstream-test' });
    expect(res.statusCode).toBe(502);
  });
});
