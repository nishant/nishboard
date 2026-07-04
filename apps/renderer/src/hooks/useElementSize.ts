import { useEffect, useState } from 'react';

/** Measure an element via callback ref + retry-RAF + ResizeObserver.
 *
 *  WHY a callback ref (not useRef + useLayoutEffect([])): widgets have
 *  conditional early returns for loading/error states, so the measured element
 *  doesn't exist on first render — a []-dep effect fires once on null and never
 *  re-runs. The callback ref re-triggers the effect when the element mounts.
 *
 *  WHY a retry-RAF loop: Chromium (notably on macOS) can return 0 from
 *  getBoundingClientRect for several frames while a flex/grid row composites.
 *  Retry until a real size appears, then hand off to the ResizeObserver.
 *
 *  width/height are 0 until the first successful measure. */
export function useElementSize<T extends HTMLElement = HTMLDivElement>(): {
  ref: (el: T | null) => void;
  el: T | null;
  width: number;
  height: number;
} {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!el) return;

    let rafId: number;
    const tryMeasure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 || height > 0) {
        setSize({ width, height });
      } else {
        rafId = requestAnimationFrame(tryMeasure);
      }
    };
    rafId = requestAnimationFrame(tryMeasure);

    const ro = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [el]);

  return { ref: setEl, el, width: size.width, height: size.height };
}
