import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';

const COMMIT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);
const CHANGE_DEBOUNCE_MS = 300;

/** Slider state that follows a polled server value without fighting the user:
 *  local state while dragging, sync-from-server only when idle, commit on
 *  pointer-up (and on keyup / a debounced change for keyboard and assistive
 *  tech). Consolidates the three per-widget copies (Spotify volume, Sound
 *  master volume, Sound per-app sessions). */
export function useDeferredSlider(
  serverValue: number,
  onCommit: (v: number) => void,
): {
  value: number;
  /** Programmatic set (e.g. mute-toggle button); commit=true also fires onCommit. */
  setValue: (v: number, commit?: boolean) => void;
  sliderProps: {
    value: number;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
    onPointerDown: () => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onLostPointerCapture: () => void;
    onKeyUp: (e: KeyboardEvent<HTMLInputElement>) => void;
  };
} {
  const [value, setValueState] = useState(serverValue);
  const pointerDown = useRef(false);
  const latest = useRef(serverValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  // Sync from the server only when the user isn't touching the slider, so
  // polls update the display while idle but never interrupt an active drag
  // or snap the thumb back right after a commit.
  useEffect(() => {
    if (!pointerDown.current && !timer.current) {
      latest.current = serverValue;
      setValueState(serverValue);
    }
  }, [serverValue]);

  useEffect(() => clearTimer, []);

  const setValue = (v: number, commit = false) => {
    latest.current = v;
    setValueState(v);
    if (commit) onCommit(v);
  };

  const commitNow = () => {
    clearTimer();
    commitRef.current(latest.current);
  };

  const releasePointer = () => { pointerDown.current = false; };

  return {
    value,
    setValue,
    sliderProps: {
      value,
      onChange: (e) => {
        const v = Number(e.target.value);
        latest.current = v;
        setValueState(v);
        if (!pointerDown.current) {
          clearTimer();
          timer.current = setTimeout(() => {
            timer.current = null;
            commitRef.current(latest.current);
          }, CHANGE_DEBOUNCE_MS);
        }
      },
      onPointerDown: () => { pointerDown.current = true; clearTimer(); },
      onPointerUp: () => {
        releasePointer();
        commitNow();
      },
      onPointerCancel: releasePointer,
      onLostPointerCapture: releasePointer,
      onKeyUp: (e) => {
        if (COMMIT_KEYS.has(e.key)) commitNow();
      },
    },
  };
}
