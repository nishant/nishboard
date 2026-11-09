import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';

const clip = vi.hoisted(() => ({ text: '', formats: [] as string[] }));

vi.mock('electron', () => ({
  clipboard: {
    readText: () => Promise.resolve(clip.text),
    writeText: () => Promise.resolve(),
    has: (mime: string) => Promise.resolve(clip.formats.some((f) => mime === `electron application/osclipboard;format="${f}"`)),
  },
}));

function fakeSender(): WebContents & { destroy: () => void; send: ReturnType<typeof vi.fn> } {
  let destroyed = false;
  let onDestroyed: (() => void) | null = null;
  const send = vi.fn();
  return {
    send,
    isDestroyed: () => destroyed,
    once: (_event: string, cb: () => void) => {
      onDestroyed = cb;
    },
    destroy: () => {
      destroyed = true;
      onDestroyed?.();
    },
  } as unknown as WebContents & { destroy: () => void; send: ReturnType<typeof vi.fn> };
}

async function load(): Promise<typeof import('./clipboardHistory')> {
  vi.resetModules();
  return import('./clipboardHistory');
}

describe('clipboardHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clip.text = '';
    clip.formats = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a normal copy and tells the subscriber', async () => {
    const mod = await load();
    const a = fakeSender();
    clip.text = 'hello';
    mod.setClipboardWatch(true, a);
    await vi.advanceTimersByTimeAsync(0);
    expect(mod.getClipboardHistory().map((e) => e.text)).toEqual(['hello']);
    expect(a.send).toHaveBeenCalledWith('clipboard:changed');
    mod.setClipboardWatch(false, a);
  });

  it('skips a concealed copy but does not re-read it later', async () => {
    const mod = await load();
    const a = fakeSender();
    clip.text = 'hunter2';
    clip.formats = ['text/plain', 'org.nspasteboard.ConcealedType'];
    mod.setClipboardWatch(true, a);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mod.getClipboardHistory()).toEqual([]);
    expect(a.send).not.toHaveBeenCalled();
    // Same text now without the marker is still the already-seen value.
    clip.formats = [];
    await vi.advanceTimersByTimeAsync(3000);
    expect(mod.getClipboardHistory()).toEqual([]);
    for (const fmt of ['ExcludeClipboardContentFromMonitorProcessing', 'CanIncludeInClipboardHistory', 'org.nspasteboard.TransientType']) {
      clip.text = `secret-${fmt}`;
      clip.formats = [fmt];
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(mod.getClipboardHistory()).toEqual([]);
    mod.setClipboardWatch(false, a);
  });

  it('stops the interval when the only subscriber is destroyed', async () => {
    const mod = await load();
    const a = fakeSender();
    mod.setClipboardWatch(true, a);
    expect(vi.getTimerCount()).toBe(1);
    a.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('notifies every subscriber and keeps polling until the last one leaves', async () => {
    const mod = await load();
    const a = fakeSender();
    const b = fakeSender();
    mod.setClipboardWatch(true, a);
    mod.setClipboardWatch(true, b);
    expect(vi.getTimerCount()).toBe(1);
    clip.text = 'shared';
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.send).toHaveBeenCalledWith('clipboard:changed');
    expect(b.send).toHaveBeenCalledWith('clipboard:changed');

    mod.setClipboardWatch(false, a); // b still shows the widget
    expect(vi.getTimerCount()).toBe(1);
    mod.setClipboardWatch(false, b);
    expect(vi.getTimerCount()).toBe(0);
  });
});
