import { useEffect, useState } from 'react';

/** Click-and-drag panning for a scrollable element (mouse users on a widget
 *  with hidden scrollbars). Callback ref so it wires up after loading/error
 *  early-returns; move/up listeners on window so a drag continues off-element.
 *  Returns the element too, for callers layering extra listeners (e.g. the
 *  weather widget's wheel→horizontal handler). */
export function useDragScroll<T extends HTMLElement = HTMLDivElement>(axis: 'x' | 'y'): {
  ref: (el: T | null) => void;
  el: T | null;
} {
  const [el, setEl] = useState<T | null>(null);

  useEffect(() => {
    if (!el) return;

    let isDragging = false;
    let start = 0;
    let startScroll = 0;

    const onMouseDown = (e: MouseEvent) => {
      // Don't hijack clicks on interactive elements inside the widget
      if ((e.target as HTMLElement).closest('button, input, label, a')) return;
      isDragging = true;
      start = axis === 'x' ? e.pageX : e.pageY;
      startScroll = axis === 'x' ? el.scrollLeft : el.scrollTop;
      el.style.cursor = 'grabbing';
      el.style.userSelect = 'none';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const delta = (axis === 'x' ? e.pageX : e.pageY) - start;
      if (axis === 'x') el.scrollLeft = startScroll - delta;
      else el.scrollTop = startScroll - delta;
    };

    const onMouseUp = () => {
      isDragging = false;
      el.style.cursor = '';
      el.style.userSelect = '';
    };

    el.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [el, axis]);

  return { ref: setEl, el };
}
