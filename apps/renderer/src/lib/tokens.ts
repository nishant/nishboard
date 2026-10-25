import type { ColorRole } from './themeVars';

/** A theme color as a CSS value, for places that take a color string instead of a
 *  class (Recharts strokes/fills, inline SVG, style props). A `var()` reference
 *  rather than a snapshot, so it follows theme switches without a re-render.
 *  (Canvas code that needs the resolved value uses @nish/ui's readToken.) */
export function tk(role: ColorRole): string {
  return `var(--nish-${role})`;
}
