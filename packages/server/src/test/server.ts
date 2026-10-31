import type { FastifyInstance, InjectOptions, LightMyRequestResponse as InjectResponse } from 'fastify';
import { buildServer } from '../app';

export const TEST_API_TOKEN = 'test-api-token';
export const TEST_PORT = 7432;

/** The headers the real renderer sends: the bearer token and an allowed Host
 *  (light-my-request defaults Host to `localhost:80`, which the guard refuses). */
export const RENDERER_HEADERS = {
  authorization: `Bearer ${TEST_API_TOKEN}`,
  host: `127.0.0.1:${TEST_PORT}`,
};

/** buildServer as the packaged app runs it, with `inject` sending
 *  RENDERER_HEADERS unless a test overrides one. Tests about the guard itself
 *  use `rawInject`, which sends only what the test gives it. */
export async function testServer(): Promise<FastifyInstance & { rawInject: (o: InjectOptions) => Promise<InjectResponse> }> {
  const app = await buildServer({ logger: false, apiToken: TEST_API_TOKEN, port: TEST_PORT });
  // Captured before the override below, or rawInject would call itself.
  const rawInject: (o: InjectOptions) => Promise<InjectResponse> = app.inject.bind(app);
  const authed = (o: InjectOptions): Promise<InjectResponse> =>
    rawInject({ ...o, headers: { ...RENDERER_HEADERS, ...o.headers } });
  Object.defineProperty(app, 'inject', { value: authed });
  return Object.assign(app, { rawInject });
}
