import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Replace the long-lived PowerShell host so no process is spawned; capture scripts.
const holder = vi.hoisted(() => ({ run: null as unknown as (s: string) => Promise<string> }));
vi.mock('../lib/psHost', () => ({
  buildBootstrap: () => '',
  PsHost: class {
    run(script: string) {
      return holder.run(script);
    }
    dispose() {}
  },
}));

// Replace execFile so the macOS branch spawns nothing; capture (cmd, args).
const exec = vi.hoisted(() => ({ calls: [] as Array<{ cmd: string; args: string[] }>, out: '' }));
vi.mock('child_process', () => ({
  execFile: (
    cmd: string,
    args: string[],
    _opts: unknown,
    cb: (e: Error | null, r: { stdout: string; stderr: string }) => void,
  ) => {
    exec.calls.push({ cmd, args });
    cb(null, { stdout: exec.out, stderr: '' });
  },
}));

import { soundRoutes, parseWinDevice, parseWinSessions, parseWinData } from './sound';

describe('POST /device (Windows) passes the device name as base64', () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let app: FastifyInstance;
  let scripts: string[];

  beforeEach(async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    scripts = [];
    holder.run = vi.fn(async (s: string) => {
      scripts.push(s);
      return '';
    });
    app = Fastify();
    await app.register(soundRoutes, { prefix: '/api/sound' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    Object.defineProperty(process, 'platform', realPlatform);
  });

  it.each(['x’; Remove-Item foo; ’', "x'; Remove-Item foo; '"])(
    'never interpolates the raw id (%s)',
    async (id) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sound/device',
        payload: { deviceId: id },
      });
      expect(res.statusCode).toBe(200);
      expect(scripts).toHaveLength(1);
      const script = scripts[0]!;
      expect(script).not.toContain(id);
      expect(script).not.toContain('Remove-Item');
      expect(script).toContain(`FromBase64String('${Buffer.from(id).toString('base64')}')`);
      expect(script).toContain('$_.Name -eq $n');
    },
  );
});

describe('POST /device (macOS) rejects option-like ids', () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform);
  });

  it('returns 400 for an id starting with a dash', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const app = Fastify();
    await app.register(soundRoutes, { prefix: '/api/sound' });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/sound/device', payload: { deviceId: '-t input' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('body validation rejects hand-crafted pid / volumePercent', () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let app: FastifyInstance;
  let scripts: string[];

  beforeEach(async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    scripts = [];
    holder.run = vi.fn(async (s: string) => {
      scripts.push(s);
      return '';
    });
    app = Fastify();
    await app.register(soundRoutes, { prefix: '/api/sound' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    Object.defineProperty(process, 'platform', realPlatform);
  });

  it.each([
    ['/volume', { volumePercent: '50; Remove-Item x' }],
    ['/volume', { volumePercent: 101 }],
    ['/volume', { volumePercent: -1 }],
    ['/volume', {}],
    ['/sessions/volume', { pid: '1; Remove-Item x', volumePercent: 50 }],
    ['/sessions/volume', { pid: 1.5, volumePercent: 50 }],
    ['/sessions/volume', { pid: -4, volumePercent: 50 }],
    ['/sessions/volume', { pid: 4, volumePercent: '50; Remove-Item x' }],
  ])('%s %j returns 400 and runs no script', async (url, payload) => {
    const res = await app.inject({ method: 'POST', url: '/api/sound' + url, payload });
    expect(res.statusCode).toBe(400);
    expect(scripts).toHaveLength(0);
  });

  it('a valid pid puts only the integer in the script', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sound/sessions/volume',
      payload: { pid: 4321, volumePercent: 40 },
    });
    expect(res.statusCode).toBe(200);
    expect(scripts).toEqual(['[W]::SetSessionVolume([uint32]4321, [float]0.400000)']);
  });

  it('the switch script throws when no device matches', async () => {
    await app.inject({ method: 'POST', url: '/api/sound/device', payload: { deviceId: 'Speakers, Left' } });
    expect(scripts[0]).toContain("throw 'device not found'");
  });
});

describe('macOS branch', () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform);
  });

  it('passes the device id as one argv entry, intact', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    exec.calls = [];
    const app = Fastify();
    await app.register(soundRoutes, { prefix: '/api/sound' });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/sound/device',
      payload: { deviceId: 'USB DAC, Left -t input' },
    });
    expect(res.statusCode).toBe(200);
    expect(exec.calls).toEqual([{ cmd: 'SwitchAudioSource', args: ['-s', 'USB DAC, Left -t input'] }]);
    await app.close();
  });

  it('reports a missing-value volume as 0, not null', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    exec.out = 'missing value';
    const app = Fastify();
    await app.register(soundRoutes, { prefix: '/api/sound' });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/sound' });
    exec.out = '';
    expect(res.statusCode).toBe(200);
    expect(res.json().volumePercent).toBe(0);
    await app.close();
  });
});

describe('Windows sound parsers', () => {
  it('keeps device names with commas and pipes whole, with ids', () => {
    const d = parseWinDevice({
      kind: 'C',
      vol: '42%',
      mute: 'True',
      def: 'Speakers, Left | Right',
      devices: [
        { id: '{A}', name: 'Speakers, Left | Right', def: true },
        { id: '{B}', name: 'Headset (USB)', def: false },
        { id: '{C}', name: 'Headset (USB)', def: false },
      ],
    });
    expect(d.volumePercent).toBe(42);
    expect(d.muted).toBe(true);
    expect(d.devices.map((x) => x.id)).toEqual(['{A}', '{B}', '{C}']);
    expect(d.devices[0]).toEqual({ id: '{A}', name: 'Speakers, Left | Right', isDefault: true });
  });

  it('accepts a single device object (PowerShell unrolls one-element arrays)', () => {
    const d = parseWinDevice({ kind: 'C', vol: '10', mute: 'False', def: 'A', devices: { id: '1', name: 'A', def: true } });
    expect(d.devices).toEqual([{ id: '1', name: 'A', isDefault: true }]);
  });

  it('WASAPI fallback and a non-numeric volume clamp to 0', () => {
    const w = parseWinDevice({ kind: 'W', vol: '55', mute: 'False' });
    expect(w.volumePercent).toBe(55);
    expect(w.devices).toHaveLength(1);
    expect(parseWinDevice({ kind: 'W', vol: 'abc', mute: 'x' }).volumePercent).toBe(0);
    expect(parseWinDevice('garbage').volumePercent).toBe(0);
  });

  it('parses sessions whose names contain pipes and commas, dropping bad pids', () => {
    const s = parseWinSessions([
      { pid: '12', name: 'My|App, v2', vol: '30', mute: 'True' },
      { pid: 'x', name: 'bad', vol: '10', mute: 'False' },
      { pid: '7', name: 'NaN vol', vol: 'oops', mute: 'False' },
    ]);
    expect(s).toEqual([
      { pid: 12, name: 'My|App, v2', volumePercent: 30, muted: true },
      { pid: 7, name: 'NaN vol', volumePercent: 0, muted: false },
    ]);
    expect(parseWinSessions(null)).toEqual([]);
  });

  it('parseWinData reads the full JSON object and rejects non-JSON', () => {
    const text = JSON.stringify({
      kind: 'C',
      vol: '20%',
      mute: 'False',
      def: 'A,B',
      devices: [{ id: '1', name: 'A,B', def: true }],
      sessions: [{ pid: '5', name: 'a|b', vol: '99', mute: 'False' }],
    });
    const d = parseWinData(text);
    expect(d.activeDeviceName).toBe('A,B');
    expect(d.sessions[0]).toMatchObject({ pid: 5, name: 'a|b', volumePercent: 99 });
    expect(() => parseWinData('C|42%|True|x|y')).toThrow();
  });
});
