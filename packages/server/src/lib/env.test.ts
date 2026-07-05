import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// env.ts parses process.env.BUILTINS_JSON once at module load (that literal
// reference is the esbuild-define seam), so every test sets the env FIRST and
// then imports a fresh module instance.
async function loadEnv(builtins?: Record<string, string>) {
  vi.resetModules(); // BUILTINS is parsed at module load — force a re-parse
  if (builtins === undefined) delete process.env.BUILTINS_JSON;
  else process.env.BUILTINS_JSON = JSON.stringify(builtins);
  return import('./env');
}

const TEST_KEYS = ['TEST_CRED_A', 'TEST_CRED_B', 'BUILTINS_JSON'] as const;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const k of TEST_KEYS) delete process.env[k];
});

describe('cred', () => {
  it('prefers runtime env over the baked value', async () => {
    process.env.TEST_CRED_A = 'runtime';
    const { cred } = await loadEnv({ TEST_CRED_A: 'baked' });
    expect(cred('TEST_CRED_A')).toBe('runtime');
  });

  it('falls back to the baked value when the env is unset or empty', async () => {
    const { cred } = await loadEnv({ TEST_CRED_A: 'baked' });
    expect(cred('TEST_CRED_A')).toBe('baked');
    process.env.TEST_CRED_B = '';
    const fresh = await loadEnv({ TEST_CRED_B: 'baked-b' });
    expect(fresh.cred('TEST_CRED_B')).toBe('baked-b');
  });

  it('returns "" when neither source has the key (boolean-checkable)', async () => {
    const { cred } = await loadEnv({});
    expect(cred('TEST_CRED_A')).toBe('');
  });

  it('works with no BUILTINS_JSON at all (dev/tsx path)', async () => {
    const { cred } = await loadEnv(undefined);
    expect(cred('TEST_CRED_A')).toBe('');
    process.env.TEST_CRED_A = 'from-dotenv';
    expect(cred('TEST_CRED_A')).toBe('from-dotenv');
  });
});

describe('builtinKeys', () => {
  it('lists only keys with non-empty baked values — never the values', async () => {
    const { builtinKeys } = await loadEnv({ TEST_CRED_A: 'x', TEST_CRED_B: '' });
    expect(builtinKeys()).toEqual(['TEST_CRED_A']);
  });

  it('is empty without bakes', async () => {
    const { builtinKeys } = await loadEnv(undefined);
    expect(builtinKeys()).toEqual([]);
  });
});
