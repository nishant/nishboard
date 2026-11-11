import { describe, expect, it, vi } from 'vitest';
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

describe('single-flight routes', () => {
  it('two concurrent requests trigger one hardware build and one process list', async () => {
    vi.resetModules();
    const calls = { load: 0, procs: 0 };
    vi.doMock('systeminformation', () => {
      const si = {
        powerShellStart: () => undefined,
        powerShellRelease: () => undefined,
        cpu: async () => ({ brand: 'x', cores: 1, physicalCores: 1, speed: 1 }),
        currentLoad: async () => {
          calls.load++;
          await new Promise((r) => setTimeout(r, 20));
          return { currentLoad: 1, cpus: [] };
        },
        cpuTemperature: async () => ({ main: 0 }),
        graphics: async () => ({ controllers: [], displays: [] }),
        mem: async () => ({ total: 1, active: 1, used: 1, swapused: 0, swaptotal: 0 }),
        fsStats: async () => null,
        fsSize: async () => [],
        battery: async () => ({ hasBattery: false }),
        processes: async () => {
          calls.procs++;
          await new Promise((r) => setTimeout(r, 20));
          return { list: [] };
        },
      };
      return { default: si };
    });
    vi.doMock('../lib/netThroughput', () => ({ getNetThroughput: async () => [] }));
    vi.doMock('../lib/winDiskIo', () => ({ readWinDiskIo: async () => null }));
    const { default: Fastify } = await import('fastify');
    const { hardwareRoutes } = await import('./hardware');
    const app = Fastify();
    await app.register(hardwareRoutes);
    const [a, b] = await Promise.all([app.inject('/'), app.inject('/')]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(calls.load).toBe(1);
    await Promise.all([app.inject('/processes'), app.inject('/processes')]);
    expect(calls.procs).toBe(1);
    await app.close();
    vi.doUnmock('systeminformation');
    vi.doUnmock('../lib/netThroughput');
    vi.doUnmock('../lib/winDiskIo');
  });
});
