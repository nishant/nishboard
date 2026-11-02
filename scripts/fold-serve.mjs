// Serves the Nishboard renderer for the Fold check. The real app is Electron: the main process
// starts the Fastify server on 7432 and the renderer calls it by absolute URL. The Fold check has
// no Electron and runs the base and the PR side by side, so neither can use 7432. This builds the
// renderer with VITE_API_BASE=/ (the API origin becomes the page's own origin; unset, the build is
// the normal one) and serves apps/renderer/dist plus fixed fixture answers for the /api routes the
// default dashboard calls, in the foreground on FOLD_PORT (default 18816). No network, no keys,
// no Electron. Any other /api route answers 404, so a new call shows up as a console error.
//   FOLD_PORT=5301 node scripts/fold-serve.mjs
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'apps', 'renderer', 'dist');
const PORT = Number(process.env.FOLD_PORT) || 18816;

// The renderer only needs vite: @dash/shared is aliased to its source, so no other package builds.
const build = spawnSync('pnpm --filter @dash/renderer exec vite build', {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, VITE_API_BASE: '/' },
});
if (build.status !== 0) process.exit(build.status ?? 1);

/** A flat tinted square as an SVG data URI (the renderer's CSP allows data: images, not the web). */
const art = (hue) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="hsl(${hue} 45% 45%)"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const spark = (base, drift) => Array.from({ length: 24 }, (_, i) => +(base + Math.sin(i / 3) * 1.5 + (i * drift) / 24).toFixed(2));

const FIXTURES = {
  '/api/weather': {
    current: { temp: 72, feelsLike: 74, humidity: 48, windSpeed: 9, uvIndex: 5, precipChance: 10, weatherCode: 2 },
    hourly: HOURS.map((h) => ({
      time: `2026-06-15T${String(h).padStart(2, '0')}:00`,
      temp: Math.round(66 + 10 * Math.sin(((h - 9) / 24) * 2 * Math.PI)),
      precipChance: h % 7 === 0 ? 20 : 0,
      weatherCode: h < 8 || h > 19 ? 1 : 2,
    })),
    daily: ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21'].map((date, i) => ({
      date,
      tempMax: 80 + (i % 3),
      tempMin: 62 - (i % 2),
      precipChance: [10, 20, 40, 0, 0, 30, 10][i],
      weatherCode: [2, 3, 61, 1, 0, 80, 2][i],
      sunrise: `${date}T06:12`,
      sunset: `${date}T20:24`,
    })),
    location: { name: 'Austin', region: 'Texas', lat: 30.27, lon: -97.74 },
    alerts: [],
    airQuality: { usAqi: 42, pollen: null },
    fetchedAt: '2026-06-15T12:00:00.000Z',
  },
  '/api/spotify/auth-status': { authenticated: true },
  '/api/spotify/now-playing': {
    isPlaying: false,
    trackId: 'fold-track',
    trackName: 'Fixture Song',
    artistName: 'Fixture Artist',
    albumName: 'Fixture Album',
    albumArtUrl: art(260),
    durationMs: 215000,
    progressMs: 64000,
    shuffleState: false,
    repeatState: 'off',
    volumePercent: 55,
    type: 'track',
  },
  '/api/stocks/watchlist': {
    connected: true,
    items: [
      { ticker: 'AAPL', topPickScore: 82, topPickStrategy: 'long_call', openPosition: true, openPositionCount: 1 },
      { ticker: 'MSFT', topPickScore: null, topPickStrategy: null, openPosition: false, openPositionCount: 0 },
      { ticker: 'NVDA', topPickScore: 64, topPickStrategy: 'long_call', openPosition: false, openPositionCount: 0 },
      { ticker: 'TSLA', topPickScore: null, topPickStrategy: null, openPosition: false, openPositionCount: 0 },
    ],
    scannedAt: '2026-06-15T11:00:00.000Z',
    updatedAt: '2026-06-15T12:00:00.000Z',
  },
  '/api/stocks': {
    equities: [
      ['AAPL', 214.32, 2.1, 0.99],
      ['MSFT', 468.9, -3.4, -0.72],
      ['NVDA', 131.05, 1.8, 1.39],
      ['TSLA', 251.7, -4.2, -1.64],
    ].map(([ticker, lastPrice, change, changePercent]) => ({
      ticker,
      lastPrice,
      change,
      changePercent,
      bid: lastPrice - 0.02,
      ask: lastPrice + 0.02,
      volume: 18_400_000,
      dayHigh: lastPrice + 3,
      dayLow: lastPrice - 3,
      marketOpen: false,
      sparkline: spark(lastPrice, change),
    })),
    updatedAt: '2026-06-15T12:00:00.000Z',
  },
  // Closed far from "now", so the badge never flips to open mid-run; the countdown text is masked.
  '/api/stocks/calendar': { isOpen: false, nextOpen: '2099-01-05T14:30:00.000Z', nextClose: null, source: 'alpaca' },
  '/api/spotify/track-saved': { saved: false },
  '/api/twitch/auth-status': { authenticated: false },
  '/api/crypto': {
    coins: [
      ['bitcoin', 'btc', 'Bitcoin', 67250, 1.4, 1_330_000_000_000],
      ['ethereum', 'eth', 'Ethereum', 3480, -0.8, 418_000_000_000],
      ['solana', 'sol', 'Solana', 162.4, 3.2, 75_000_000_000],
      ['dogecoin', 'doge', 'Dogecoin', 0.151, -2.1, 22_000_000_000],
    ].map(([id, symbol, name, priceUsd, change24hPercent, marketCapUsd], i) => ({
      id,
      symbol,
      name,
      image: art(40 + i * 80),
      priceUsd,
      change24hPercent,
      marketCapUsd,
      sparkline7d: spark(priceUsd, change24hPercent),
    })),
    updatedAt: '2026-06-15T12:00:00.000Z',
  },
  '/api/news': {
    items: [
      ['Fixture headline one about something that happened today', 'Fixture Wire'],
      ['Fixture headline two, a longer one that has to wrap onto a second line', 'Example Times'],
      ['Fixture headline three', 'Sample Daily'],
      ['Fixture headline four', 'Fixture Wire'],
    ].map(([title, source], i) => ({ title, link: `https://example.com/news/${i}`, source, pubDate: `2026-06-15T0${9 - i}:00:00.000Z` })),
    fetchedAt: '2026-06-15T12:00:00.000Z',
  },
  '/api/network': {
    hosts: [
      { host: '1.1.1.1', latestMs: 14, avgMs: 15, jitterMs: 1.2, lossPct: 0, samples: 30 },
      { host: '8.8.8.8', latestMs: 19, avgMs: 20, jitterMs: 2.1, lossPct: 0, samples: 30 },
    ],
    totals: { upMbps: 0.4, downMbps: 2.2 },
    ifaces: [{ iface: 'Ethernet', uploadMbps: 0.4, downloadMbps: 2.2 }],
    fetchedAt: '2026-06-15T12:00:00.000Z',
  },
  // The CLI is "not installed" here, the widget's own quiet state; no OAuth usage call follows.
  '/api/claude/status': { available: false, version: null, reason: 'not-found' },
  '/api/claude/meta': { slashCommands: [], model: null },
  '/api/inbox/items': {
    state: 'ok',
    list: {
      items: [
        ['Deploy finished for fixture-app', 'ci', 'info'],
        ['Fixture job needs a look', 'jobs', 'urgent'],
      ].map(([title, source, severity], i) => ({
        id: i + 1,
        source,
        kind: 'fixture',
        title,
        body: null,
        url: null,
        severity,
        count: 1,
        createdAt: '2026-10-30T10:00:00.000Z',
        updatedAt: '2026-10-30T10:00:00.000Z',
        occurredAt: '2026-10-30T10:00:00.000Z',
        handledAt: null,
        handledBy: null,
        snoozedUntil: null,
        data: null,
      })),
      nextCursor: null,
      counts: { open: 2, snoozed: 0, handled: 0, urgent: 1 },
      sources: [{ id: 'ci', open: 1 }, { id: 'jobs', open: 1 }],
    },
  },
  '/api/calendar/auth-status': { authenticated: false },
  '/api/youtube/auth-status': { authenticated: false },
  '/api/youtube/browse': {
    items: ['Fixture video one', 'Fixture video two with a much longer title that has to wrap', 'Fixture video three', 'Fixture video four'].map((title, i) => ({
      videoId: `fold${i}`,
      title,
      channelTitle: `Fixture Channel ${i + 1}`,
      channelId: `UCfold${i}`,
      thumbnailUrl: art(30 + i * 70),
      publishedAt: '2026-06-10T12:00:00.000Z',
      durationSeconds: 300 + i * 120,
      isShort: false,
    })),
    nextPageToken: null,
  },
  '/api/sound': {
    volumePercent: 40,
    muted: false,
    activeDeviceName: 'Fixture Speakers',
    devices: [
      { id: 'dev1', name: 'Fixture Speakers', isDefault: true },
      { id: 'dev2', name: 'Fixture Headphones', isDefault: false },
    ],
    sessions: [
      { pid: 101, name: 'Browser', volumePercent: 70, muted: false },
      { pid: 102, name: 'Music', volumePercent: 35, muted: false },
    ],
  },
  '/api/hardware': {
    cpu: { brand: 'Fixture CPU', cores: 8, physicalCores: 4, usagePercent: 23, coreUsage: [30, 22, 18, 25, 20, 24, 19, 26], speedGhz: 3.6, tempCelsius: 52 },
    gpu: { name: 'Fixture GPU', usagePercent: 12, vramUsedMb: 2048, vramTotalMb: 8192, tempCelsius: 48, clockMhz: 1200 },
    ram: { usedMb: 9800, totalMb: 32768, usagePercent: 30, swapUsedMb: 0, swapTotalMb: 4096 },
    disks: [{ name: 'C:', readMBs: 1.2, writeMBs: 0.6 }],
    diskUsage: [{ mount: 'C:', usedGb: 410, totalGb: 953, usePercent: 43 }],
    network: [{ iface: 'Ethernet', uploadMbps: 0.4, downloadMbps: 2.2 }],
    uptime: 93_600,
    battery: null,
    fetchedAt: '2026-06-15T12:00:00.000Z',
  },
  '/api/hardware/processes': {
    processes: [
      { name: 'browser', count: 14, cpuPercent: 8.2, memMb: 2400, memPercent: 7.3 },
      { name: 'editor', count: 3, cpuPercent: 3.1, memMb: 900, memPercent: 2.7 },
    ],
    fetchedAt: '2026-06-15T12:00:00.000Z',
  },
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  if (pathname === '/health') return json(res, 200, { ok: true });
  if (pathname.startsWith('/api/')) {
    const fixture = req.method === 'GET' ? FIXTURES[pathname] : undefined;
    if (fixture) return json(res, 200, fixture);
    console.log(`fold-serve: no fixture for ${req.method} ${pathname}`);
    return json(res, 404, { error: `No fold fixture for ${req.method} ${pathname}` });
  }
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(DIST, rel);
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return json(res, 403, { error: 'forbidden' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    json(res, 404, { error: 'not found' });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`fold-serve: nishboard renderer on http://127.0.0.1:${PORT}`));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
