import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

/** Slider state that follows a polled server value without fighting the user:
 *  local state while dragging, sync-from-server only when idle, commit on
 *  pointer-up. Consolidates the three per-widget copies (Spotify volume,
 *  Sound master volume, Sound per-app sessions). */
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
  };
} {
  const [value, setValueState] = useState(serverValue);
  const pointerDown = useRef(false);

  // Sync from the server only when the user isn't touching the slider, so
  // polls update the display while idle but never interrupt an active drag
  // or snap the thumb back right after a commit.
  useEffect(() => {
    if (!pointerDown.current) setValueState(serverValue);
  }, [serverValue]);

  const setValue = (v: number, commit = false) => {
    setValueState(v);
    if (commit) onCommit(v);
  };

  return {
    value,
    setValue,
    sliderProps: {
      value,
      onChange: (e) => setValueState(Number(e.target.value)),
      onPointerDown: () => { pointerDown.current = true; },
      onPointerUp: () => {
        pointerDown.current = false;
        onCommit(value);
      },
    },
  };
}
