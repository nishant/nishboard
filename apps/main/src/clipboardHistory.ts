import { clipboard } from 'electron';
import type { WebContents } from 'electron';
import { randomUUID } from 'crypto';
import type { ClipboardEntryData, IpcChannels } from '@dash/shared';

// Clipboard history is deliberately ephemeral: text-only, module memory only,
// capped, and the poller runs ONLY while the widget has it enabled. Nothing
// here ever touches disk.

const MAX_ENTRIES = 50;
const MAX_TEXT_LEN = 10_000; // cap pathological copies (huge file dumps)
const POLL_MS = 1000;

let history: ClipboardEntryData[] = [];
let timer: NodeJS.Timeout | null = null;
let lastText: string | null = null;
let subscriber: WebContents | null = null;

function notify(): void {
  if (subscriber && !subscriber.isDestroyed()) {
    subscriber.send('clipboard:changed' satisfies IpcChannels);
  }
}

function poll(): void {
  let text = '';
  try {
    text = clipboard.readText();
  } catch {
    return; // clipboard occupied by another app mid-write — try next tick
  }
  if (!text || text === lastText) return; // dedupe consecutive reads
  lastText = text;
  history = [
    { id: randomUUID(), text: text.slice(0, MAX_TEXT_LEN), at: Date.now() },
    ...history,
  ].slice(0, MAX_ENTRIES);
  notify();
}

export function setClipboardWatch(enabled: boolean, sender: WebContents): void {
  subscriber = sender;
  if (enabled && !timer) {
    lastText = null; // capture whatever is on the clipboard right now
    timer = setInterval(poll, POLL_MS);
    poll();
  } else if (!enabled && timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function getClipboardHistory(): ClipboardEntryData[] {
  return history;
}

export function copyClipboardEntry(id: string): void {
  const entry = history.find((e) => e.id === id);
  if (!entry) return;
  lastText = entry.text; // don't re-capture our own write as a new entry
  clipboard.writeText(entry.text);
}

export function clearClipboardHistory(): void {
  history = [];
  notify();
}
