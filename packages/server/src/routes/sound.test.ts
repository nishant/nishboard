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

import { soundRoutes } from './sound';

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
