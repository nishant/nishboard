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
    let moved = false;
    const DRAG_THRESHOLD = 4;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!(e.target instanceof Element)) return;
      // Don't hijack clicks on interactive elements inside the widget
      if (e.target.closest('button, input, label, a')) return;
      isDragging = true;
      moved = false;
      start = axis === 'x' ? e.pageX : e.pageY;
      startScroll = axis === 'x' ? el.scrollLeft : el.scrollTop;
      el.style.cursor = 'grabbing';
      el.style.userSelect = 'none';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const delta = (axis === 'x' ? e.pageX : e.pageY) - start;
      if (Math.abs(delta) > DRAG_THRESHOLD) moved = true;
      if (axis === 'x') el.scrollLeft = startScroll - delta;
      else el.scrollTop = startScroll - delta;
    };

    // A drag that moved more than 4px must not also count as a click: swallow
    // the click that follows the mouseup (capture phase), once.
    const swallowClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };

    const onMouseUp = () => {
      if (isDragging && moved) {
        el.addEventListener('click', swallowClick, { capture: true, once: true });
        // If no click follows (mouseup landed elsewhere), don't leave it armed.
        setTimeout(() => el.removeEventListener('click', swallowClick, { capture: true }), 0);
      }
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
