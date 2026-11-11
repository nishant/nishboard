import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadStore() {
  const mod = await import('./hardwareStore');
  return mod.useHardwareStore;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe('hardwareStore persistence', () => {
  it('keeps the default for a section missing from the persisted state', async () => {
    localStorage.setItem(
      'hardware-config',
      JSON.stringify({ state: { visible: { cpu: false, gpu: true } }, version: 0 }),
    );
    const store = await loadStore();
    const { visible } = store.getState();
    expect(visible.cpu).toBe(false);
    expect(visible.gpu).toBe(true);
    expect(visible.ram).toBe(true);
    expect(visible.battery).toBe(true);
  });

  it('ignores unknown keys and non-boolean values', async () => {
    localStorage.setItem(
      'hardware-config',
      JSON.stringify({ state: { visible: { cpu: 'no', fans: false } }, version: 0 }),
    );
    const store = await loadStore();
    const visible: Record<string, boolean> = store.getState().visible;
    expect(visible.cpu).toBe(true);
    expect('fans' in visible).toBe(false);
  });

  it('survives a malformed persisted state', async () => {
    localStorage.setItem('hardware-config', JSON.stringify({ state: { visible: 'x' }, version: 0 }));
    const store = await loadStore();
    expect(store.getState().visible.cpu).toBe(true);
  });
});
