import { describe, expect, it } from 'vitest';
import type si from 'systeminformation';
import { applyNvidiaLive, parseNvidiaSmi } from './hardware';

describe('parseNvidiaSmi', () => {
  it('parses the first csv line', () => {
    expect(parseNvidiaSmi('37, 2048, 8192, 55, 1800\r\n')).toEqual({
      utilizationGpu: 37,
      memoryUsed: 2048,
      memoryTotal: 8192,
      temperatureGpu: 55,
      clockCore: 1800,
    });
  });
  it('returns null for empty, short or N/A output', () => {
    expect(parseNvidiaSmi('')).toBeNull();
    expect(parseNvidiaSmi('1, 2, 3')).toBeNull();
    expect(parseNvidiaSmi('1, 2, 3, [N/A], 5')).toBeNull();
  });
});

describe('applyNvidiaLive', () => {
  const ctrls = [
    { vendor: 'Intel', model: 'UHD', utilizationGpu: 1 },
    { vendor: 'NVIDIA', model: 'RTX 4070', utilizationGpu: 0 },
  ] as si.Systeminformation.GraphicsControllerData[];
  const live = { utilizationGpu: 40, memoryUsed: 100, memoryTotal: 200, temperatureGpu: 60, clockCore: 1500 };

  it('overlays live values on the NVIDIA controller only', () => {
    const out = applyNvidiaLive(ctrls, live);
    expect(out[0].utilizationGpu).toBe(1);
    expect(out[1]).toMatchObject({ utilizationGpu: 40, memoryUsed: 100, temperatureGpu: 60, clockCore: 1500 });
  });
  it('keeps cached values when nvidia-smi gave nothing', () => {
    expect(applyNvidiaLive(ctrls, null)).toBe(ctrls);
  });
});
