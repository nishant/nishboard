// Asset-free alert sound (Web Audio) + native desktop notification + in-app toast.
// Used by the Timer / Alarm / Countdown widgets when something fires.

import { toast as nishToast } from '@nish/ui';

export type ToastKind = 'info' | 'success' | 'error';

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    // Browsers may start the context suspended until a user gesture; resume best-effort.
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Play a short three-beep chime (no audio asset needed). */
export function playAlarm(): void {
  const ac = audioCtx();
  if (!ac) return;
  const start = ac.currentTime;
  for (const offset of [0, 0.28, 0.56]) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.2);
    osc.connect(gain).connect(ac.destination);
    osc.start(start + offset);
    osc.stop(start + offset + 0.22);
  }
}

/** In-app toast (bottom-right) via @nish/ui's Toaster. No sound, no native
 *  notification. Errors stay until dismissed; the rest fade after 4s. */
export function toast(title: string, body?: string, kind: ToastKind = 'info'): void {
  nishToast[kind](title, body);
}

/** Fire a full alert: chime + in-app toast + native notification (native kept
 *  because timers/alarms fire while the app is unfocused). */
export function fireAlert(title: string, body: string): void {
  playAlarm();
  toast(title, body);
  window.electron?.notify?.(title, body);
}
