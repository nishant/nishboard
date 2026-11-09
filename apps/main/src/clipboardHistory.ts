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
// Every window whose widget currently has the watch enabled (main window and
// popouts can both show the widget).
const subscribers = new Set<WebContents>();
// Senders that already have a 'destroyed' listener, so re-enabling never stacks them.
const tracked = new WeakSet<WebContents>();

// Password managers mark secret copies with these OS opt-out formats. Windows'
// own clipboard history honours them, so this poller does too.
const SECRET_FORMATS = [
  'ExcludeClipboardContentFromMonitorProcessing', // Windows
  'CanIncludeInClipboardHistory', // Windows
  'org.nspasteboard.ConcealedType', // macOS
  'org.nspasteboard.TransientType', // macOS
];

function notify(): void {
  for (const sub of subscribers) {
    if (!sub.isDestroyed()) sub.send('clipboard:changed' satisfies IpcChannels);
  }
}

// Electron 45's async clipboard has no availableFormats(); has() with the
// osclipboard prefix tests one raw platform format by name.
const rawFormat = (name: string): string => `electron application/osclipboard;format="${name}"`;

async function isSecretCopy(): Promise<boolean> {
  try {
    const found = await Promise.all(SECRET_FORMATS.map((f) => clipboard.has(rawFormat(f))));
    return found.some(Boolean);
  } catch {
    return false; // unsupported format name or clipboard busy: treat as an ordinary copy
  }
}

function stopPolling(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function unsubscribe(sender: WebContents): void {
  subscribers.delete(sender);
  if (subscribers.size === 0) stopPolling();
}

// Electron 44+: clipboard access in main is async. The guard keeps 1s ticks from overlapping.
let polling = false;

async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    // Checked before reading: a secret copy is read only to dedupe it.
    const secret = await isSecretCopy();
    let text = '';
    try {
      text = await clipboard.readText();
    } catch {
      return; // clipboard occupied by another app mid-write — try next tick
    }
    if (!text || text === lastText) return; // dedupe consecutive reads
    lastText = text;
    if (secret) return; // remembered only so it is not re-read; never stored
    history = [
      { id: randomUUID(), text: text.slice(0, MAX_TEXT_LEN), at: Date.now() },
      ...history,
    ].slice(0, MAX_ENTRIES);
    notify();
  } finally {
    polling = false;
  }
}

export function setClipboardWatch(enabled: boolean, sender: WebContents): void {
  if (!enabled) {
    unsubscribe(sender);
    return;
  }
  subscribers.add(sender);
  // A closed popout, reload or renderer crash never sends setEnabled(false).
  if (!tracked.has(sender)) {
    tracked.add(sender);
    sender.once('destroyed', () => unsubscribe(sender));
  }
  if (!timer) {
    lastText = null; // capture whatever is on the clipboard right now
    timer = setInterval(() => void poll(), POLL_MS);
    void poll();
  }
}

export function getClipboardHistory(): ClipboardEntryData[] {
  return history;
}

export async function copyClipboardEntry(id: string): Promise<void> {
  const entry = history.find((e) => e.id === id);
  if (!entry) return;
  lastText = entry.text; // don't re-capture our own write as a new entry
  await clipboard.writeText(entry.text);
}

export function clearClipboardHistory(): void {
  history = [];
  notify();
}
