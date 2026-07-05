import { describe, expect, it } from 'vitest';
import { UpstreamError } from './http';
import { RefreshAuthError, rethrowRefreshFailure } from './userTokenStore';

// The classification decides whether a stored OAuth session gets wiped — a
// wrong answer here once destroyed a valid Twitch session on a transient 4xx.
describe('rethrowRefreshFailure', () => {
  function classify(err: unknown): unknown {
    try {
      rethrowRefreshFailure(err);
    } catch (out) {
      return out;
    }
    throw new Error('rethrowRefreshFailure must always throw');
  }

  it('converts definitive token-endpoint rejections (400/401/403) to RefreshAuthError', () => {
    for (const status of [400, 401, 403]) {
      const out = classify(new UpstreamError(status, `token endpoint ${status}`));
      expect(out).toBeInstanceOf(RefreshAuthError);
      expect((out as RefreshAuthError).status).toBe(status);
    }
  });

  it('rethrows transient upstream failures unchanged (session must survive)', () => {
    for (const status of [408, 429, 500, 502, 503]) {
      const original = new UpstreamError(status, `token endpoint ${status}`);
      const out = classify(original);
      expect(out).toBe(original);
      expect(out).not.toBeInstanceOf(RefreshAuthError);
    }
  });

  it('rethrows network errors and timeouts unchanged', () => {
    const network = new TypeError('fetch failed');
    expect(classify(network)).toBe(network);
    const abort = new DOMException('The operation timed out', 'TimeoutError');
    expect(classify(abort)).toBe(abort);
  });

  it('RefreshAuthError is an UpstreamError (central error handler mapping applies)', () => {
    const err = new RefreshAuthError(401, 'revoked');
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.name).toBe('RefreshAuthError');
  });
});
