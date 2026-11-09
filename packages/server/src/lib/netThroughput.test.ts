import { beforeEach, describe, expect, it, vi } from 'vitest';

const networkStats = vi.fn();
vi.mock('systeminformation', () => ({ default: { networkStats: (...a: unknown[]) => networkStats(...a) } }));

import { getNetThroughput, isRealIface, resetNetThroughputForTests } from './netThroughput';

const row = (iface: string, rx: number, tx: number, operstate = 'up') => ({ iface, rx_sec: rx, tx_sec: tx, operstate });

beforeEach(() => {
  vi.useRealTimers();
  resetNetThroughputForTests();
  networkStats.mockReset();
});

describe('isRealIface', () => {
  it('drops loopbacks', () => {
    expect(isRealIface('lo')).toBe(false);
    expect(isRealIface('Loopback Pseudo-Interface 1')).toBe(false);
    expect(isRealIface('Ethernet')).toBe(true);
  });
});

describe('getNetThroughput', () => {
  it('filters, sorts most-active first and maps to Mbps', async () => {
    networkStats.mockResolvedValue([
      row('lo', 9e9, 9e9),
      row('Wi-Fi', 125_000, 250_000),
      row('Ethernet', 1_250_000, 125_000),
      row('Down', 5e6, 5e6, 'down'),
    ]);
    const out = await getNetThroughput();
    expect(out.map((n) => n.iface)).toEqual(['Ethernet', 'Wi-Fi']);
    expect(out[0]).toEqual({ iface: 'Ethernet', downloadMbps: 10, uploadMbps: 1 });
  });

  it('is single-flight and cached for 1s', async () => {
    vi.useFakeTimers();
    networkStats.mockResolvedValue([row('Ethernet', 1, 1)]);
    await Promise.all([getNetThroughput(), getNetThroughput(), getNetThroughput()]);
    expect(networkStats).toHaveBeenCalledTimes(1);
    await getNetThroughput();
    expect(networkStats).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_100);
    await getNetThroughput();
    expect(networkStats).toHaveBeenCalledTimes(2);
  });

  it('returns [] when networkStats rejects', async () => {
    networkStats.mockRejectedValue(new Error('boom'));
    expect(await getNetThroughput()).toEqual([]);
  });
});
