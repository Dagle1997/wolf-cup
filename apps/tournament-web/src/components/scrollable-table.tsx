/**
 * T12-3 ScrollableTable — accessible horizontal-scroll container for wide tables.
 *
 * T12-2 (commit d6ca3f2) fixed 375px page overflow by wrapping each wide
 * `<table>` in a `<div style={{ overflowX: 'auto' }} tabIndex={0}>` so the
 * table scrolls INSIDE the container instead of pushing the page wide. Those
 * wrappers were focusable (tabIndex={0}) but had no accessible name and no
 * explicit focus ring — the two non-blocking a11y followups recorded in the
 * T12-2 Dev Agent Record.
 *
 * This primitive closes both gaps in one place:
 *  - `role="region"` + a REQUIRED `label` (→ aria-label) gives the focusable
 *    scroll container an accessible name, so screen-reader users hear it on
 *    focus (the WAI-ARIA APG scrollable-region pattern). `role="region"` adds
 *    a named landmark per table; that tradeoff is accepted for data tables and
 *    is reversible to `role="group"` in this one file if a future a11y pass
 *    prefers fewer landmarks.
 *  - `className="scroll-region"` hooks the `.scroll-region:focus-visible`
 *    outline rule in index.css (a focus ring cannot be expressed inline),
 *    matching the existing input `:focus-visible` rule in width/color/offset.
 *
 * The `overflowX: 'auto'` style is responsive by nature (no-op on desktop,
 * scrolls only when the table exceeds the container), so no `@media` is needed
 * — exactly as in T12-2. The outline is drawn outside the border box, so this
 * element's own overflow does not clip its focus ring.
 */
import type { ReactNode } from 'react';

export type ScrollableTableProps = {
  /** Accessible name announced when the scroll region receives keyboard focus. */
  label: string;
  children: ReactNode;
};

export function ScrollableTable({ label, children }: ScrollableTableProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="scroll-region"
      style={{ overflowX: 'auto' }}
    >
      {children}
    </div>
  );
}
