/**
 * T11-1 BackLink — consistent back-navigation primitive.
 *
 * Wraps TanStack Router's <Link> with a leading "← " glyph and muted-text
 * styling. Closes the audit-flagged "admin pages are dead-ends on iOS
 * standalone PWA" gap (only 1 admin page had a back link pre-T11).
 *
 * **Typing tradeoff:** `to` is intentionally `string` (not TanStack
 * Router's generic typed `LinkProps['to']`). The fully-typed version
 * resolves the `to` prop against the globally-registered Router type,
 * which makes BackLink unusable in ad-hoc test fixtures that build a
 * memory router with a different route tree. Since BackLink is a
 * presentational primitive (T11-3 will use it ~25 times across admin
 * routes), the string-typing call-site cost is small — typos in route
 * paths surface at runtime (404 page from TanStack Router) rather than
 * compile time. Future micro-enhancement: a typed `BackLinkTo<Router>`
 * generic variant that callers can opt into when they want strict
 * validation.
 *
 * Internally we cast `to` to TanStack Router's expected union shape
 * because its `<Link>` is strictly generic; the runtime accepts any
 * valid path string regardless. The cast is localized here so consumers
 * see only the string-typed surface.
 */
import { Link } from '@tanstack/react-router';
import type { ComponentProps } from 'react';

type LinkProps = ComponentProps<typeof Link>;

export type BackLinkProps = {
  to: string;
  params?: Record<string, string>;
  label?: string;
};

export function BackLink({ to, params, label = 'Back' }: BackLinkProps) {
  // Conditional spread for `params` — exactOptionalPropertyTypes: true
  // in tsconfig forbids passing `undefined` to an optional prop. Mirrors
  // the pattern used elsewhere in this codebase (see activity-feed.test).
  const linkProps = {
    to: to as NonNullable<LinkProps['to']>,
    ...(params !== undefined
      ? { params: params as unknown as NonNullable<LinkProps['params']> }
      : {}),
  };
  return (
    <Link
      {...linkProps}
      style={{
        color: 'var(--color-text-muted)',
        fontSize: 'var(--font-sm)',
        textDecoration: 'none',
        display: 'inline-block',
        marginBottom: 8,
      }}
    >
      ← {label}
    </Link>
  );
}
