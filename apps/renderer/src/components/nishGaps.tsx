// Thin local wrappers over @nish/ui for the few things it does not cover yet.
// Every export here is reported upstream as a ui gap; delete each one (and point
// its imports back at '@nish/ui') once the shared piece ships.
import { forwardRef } from 'react';
import {
  Input as NishInput,
  Select as NishSelect,
  SearchInput as NishSearchInput,
  cn,
  type InputProps,
  type SearchInputProps,
  type SelectProps,
} from '@nish/ui';

// ── Dense field text ─────────────────────────────────────────────────────────
// @nish/ui fields switch to 16px text below the `sm` breakpoint (640px) so iOS
// does not zoom. Nishboard's popout windows are 420px wide but driven by a mouse,
// so the 16px jump only bloats them. These keep the size's own text at every
// width (gap: key the 16px rule on pointer-coarse instead of viewport width).

const DENSE_TEXT = { xs: 'text-2xs', sm: 'text-xs', md: 'text-sm' } as const;

/** Shared Input with its size's text at every viewport width. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ size = 'md', className, ...rest }, ref) {
  return <NishInput ref={ref} size={size} className={cn(DENSE_TEXT[size], className)} {...rest} />;
});

/** Shared Select with its size's text at every viewport width. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', selectClassName, ...rest },
  ref,
) {
  return <NishSelect ref={ref} size={size} selectClassName={cn(DENSE_TEXT[size], selectClassName)} {...rest} />;
});

/** Shared SearchInput with its size's text at every viewport width. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { size = 'md', inputClassName, ...rest },
  ref,
) {
  return <NishSearchInput ref={ref} size={size} inputClassName={cn(DENSE_TEXT[size], inputClassName)} {...rest} />;
});

// ── Menu rows outside a DropdownMenu ─────────────────────────────────────────
// The titlebar menus hold IconButtons, inputs and color pickers, so they are
// Popovers (role=dialog), not DropdownMenus, and MenuItem (role=menuitem,
// tabIndex -1) does not fit there. This is MenuItem's row recipe for a plain
// button (gap: a `menuItemClass({ active, danger })` export).

/** MenuItem's row look for a plain, tabbable button. */
export function menuRowClass(active = false): string {
  return cn(
    'flex w-full select-none items-center gap-2 px-3 py-1.5 text-left text-2xs transition-colors pointer-coarse:min-h-11',
    active ? 'bg-th-overlay font-medium text-th-hi' : 'text-th-hi2 hover:bg-th-overlay hover:text-th-hi',
  );
}

// ── Neutral meter fill ───────────────────────────────────────────────────────
// Meter has no neutral tone (gap: tone="neutral" → bg-th-hi3). Pass this as the
// Meter's className for a gray fill (e.g. swap usage).
export const METER_NEUTRAL = '[&>div]:bg-th-hi3';
