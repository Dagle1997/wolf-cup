/**
 * T11-1 PageShell — consistent page wrapper for tournament-web routes.
 *
 * Renders:
 *   - A root <div> with max-width: var(--page-max-width) and padding:
 *     var(--page-padding), margin-inline: auto for centering.
 *   - An optional <header> when EITHER title OR actions is provided.
 *     Header is flex with space-between: title left, actions right.
 *     If only actions, header still renders (no <h1>); actions still
 *     right-align via the flex layout.
 *   - children below the header (or as the only child if header omitted).
 *
 * No data fetching, no router awareness, no theming hooks. Thin
 * presentational primitive consumed by T11-3's route migration.
 */
import type { ReactNode } from 'react';

export type PageShellProps = {
  children: ReactNode;
  title?: string;
  actions?: ReactNode;
};

export function PageShell({ children, title, actions }: PageShellProps) {
  const showHeader = Boolean(title) || Boolean(actions);
  return (
    <div
      style={{
        maxWidth: 'var(--page-max-width)',
        padding: 'var(--page-padding)',
        marginInline: 'auto',
      }}
    >
      {showHeader ? (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 16,
          }}
        >
          {title ? <h1 style={{ margin: 0, fontSize: 'var(--font-lg)' }}>{title}</h1> : null}
          {actions ? <div style={{ marginInlineStart: 'auto' }}>{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </div>
  );
}
