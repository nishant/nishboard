import { describe, expect, it } from 'vitest';
import { computeStats, isValidHost, parseMacPing, parseWinPing } from './network';

// Pure-function coverage only — pingOnce/Sampler spawn real child processes
// and are deliberately never exercised here.

describe('computeStats (30-sample ring buffer math)', () => {
  it('empty buffer → all nulls, zero loss, zero samples', () => {
    expect(computeStats([])).toEqual({
      latestMs: null,
      avgMs: null,
      jitterMs: null,
      lossPct: 0,
      samples: 0,
    });
  });

  it('all-lost buffer → nulls with 100% loss (ICMP-blocked degradation)', () => {
    expect(computeStats([null, null, null])).toEqual({
      latestMs: null,
      avgMs: null,
      jitterMs: null,
      lossPct: 100,
      samples: 3,
    });
  });

  it('single success → avg but no jitter (<2 successes)', () => {
    expect(computeStats([15])).toEqual({
      latestMs: 15,
      avgMs: 15,
      jitterMs: null,
      lossPct: 0,
      samples: 1,
    });
  });

  it('mixed buffer: avg/jitter over successes only, loss over the whole window', () => {
    // successes 10, 20, 30 → avg 20; |20-10| + |30-20| over 2 diffs → jitter 10
    const s = computeStats([10, null, 20, 30]);
    expect(s.latestMs).toBe(30);
    expect(s.avgMs).toBe(20);
    expect(s.jitterMs).toBe(10);
    expect(s.lossPct).toBe(25);
    expect(s.samples).toBe(4);
  });

  it('latest lost → latestMs null while avg/jitter survive from earlier successes', () => {
    const s = computeStats([10, 20, null]);
    expect(s.latestMs).toBeNull();
    expect(s.avgMs).toBe(15);
    expect(s.jitterMs).toBe(10);
    expect(s.lossPct).toBe(33.3);
  });

  it('jitter skips over interleaved losses (diffs between consecutive successes)', () => {
    // successes 5, 5, 5 → all diffs 0 even with losses between them
    expect(computeStats([5, null, 5, null, 5]).jitterMs).toBe(0);
  });

  it('rounds avg/jitter/loss to one decimal', () => {
    const s = computeStats([1, 2, null]);
    expect(s.avgMs).toBe(1.5);
    expect(s.jitterMs).toBe(1);
    expect(s.lossPct).toBe(33.3);
  });

  it('keeps sub-millisecond latest (the Windows <1ms form) intact', () => {
    expect(computeStats([0.5]).latestMs).toBe(0.5);
  });
});

describe('isValidHost (argv gate before ping spawn)', () => {
  const accept = [
    '1.1.1.1',
    '8.8.8.8',
    'dns.google',
    'sub-domain.example-host.co',
    'a', // single-char hostname
    'a1.b2.c3',
  ];
  const reject = [
    '-t', // ping flag injection — infinite ping on Windows
    '-n 5',
    '--help',
    '', // empty
    'bad_host', // underscore not in the allowed set
    'host with space',
    'host;rm -rf /', // shell metachars (inert under execFile, still rejected)
    'host-', // trailing hyphen
    '.host', // leading dot
    'host.', // trailing dot
    `a${'b'.repeat(253)}`, // 254 chars — over the 253 cap
  ];

  it.each(accept)('accepts %j', (h) => {
    expect(isValidHost(h)).toBe(true);
  });

  it.each(reject)('rejects %j', (h) => {
    expect(isValidHost(h)).toBe(false);
  });

  it('accepts a hostname at exactly the 253-char limit', () => {
    expect(isValidHost(`a${'b'.repeat(251)}c`)).toBe(true);
  });
});

describe('parseWinPing (Windows-only, localized output)', () => {
  it('parses the English reply line', () => {
    const out = [
      'Pinging 1.1.1.1 with 32 bytes of data:',
      'Reply from 1.1.1.1: bytes=32 time=6ms TTL=55',
      '',
      'Ping statistics for 1.1.1.1:',
      '    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),',
      'Approximate round trip times in milli-seconds:',
      '    Minimum = 6ms, Maximum = 6ms, Average = 6ms',
    ].join('\n');
    expect(parseWinPing(out)).toBe(6);
  });

  it('parses a localized German reply line (never match the word "time")', () => {
    expect(parseWinPing('Antwort von 1.1.1.1: Bytes=32 Zeit=14ms TTL=57')).toBe(14);
  });

  it('parses the sub-millisecond form as 0.5 — English and German', () => {
    expect(parseWinPing('Reply from 192.168.1.1: bytes=32 time<1ms TTL=64')).toBe(0.5);
    expect(parseWinPing('Antwort von 192.168.1.1: Bytes=32 Zeit<1ms TTL=64')).toBe(0.5);
  });

  it('ignores Bytes=32 / TTL=57 tokens — only the ms token counts', () => {
    // If the parser grabbed the first `=N` it would return 32 here.
    expect(parseWinPing('Antwort von 1.1.1.1: Bytes=32 Zeit=14ms TTL=57')).toBe(14);
  });

  it('returns null (= loss) for timeout and unreachable output', () => {
    expect(parseWinPing('Request timed out.')).toBeNull();
    // German timeout — contains "Zeit" as a word but no ms token.
    expect(parseWinPing('Zeitüberschreitung der Anforderung.')).toBeNull();
    expect(parseWinPing('Reply from 10.0.0.1: Destination host unreachable.')).toBeNull();
    expect(parseWinPing('')).toBeNull();
  });
});

describe('parseMacPing (macOS-only, BSD ping)', () => {
  it('parses the fractional time= token', () => {
    const out = [
      'PING 8.8.8.8 (8.8.8.8): 56 data bytes',
      '64 bytes from 8.8.8.8: icmp_seq=0 ttl=117 time=23.238 ms',
      '',
      '--- 8.8.8.8 ping statistics ---',
      '1 packets transmitted, 1 packets received, 0.0% packet loss',
      'round-trip min/avg/max/stddev = 23.238/23.238/23.238/0.000 ms',
    ].join('\n');
    expect(parseMacPing(out)).toBe(23.238);
  });

  it('returns null (= loss) when no reply line exists', () => {
    expect(parseMacPing('Request timeout for icmp_seq 0')).toBeNull();
    expect(parseMacPing('')).toBeNull();
  });
});
