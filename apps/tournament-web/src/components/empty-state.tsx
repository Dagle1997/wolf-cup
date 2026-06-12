/**
 * T11-1 EmptyState — uniform empty-state card.
 *
 * Replaces hand-rolled empty messages (e.g., "No rounds yet.") that
 * currently sit next to live controls without visual hierarchy.
 *
 * title is required; body + action are optional.
 */
import type { CSSProperties, ReactNode } from 'react';

export type EmptyStateProps = {
  title: string;
  body?: string;
  action?: ReactNode;
  /** Decorative icon shown above the title. Defaults to ⛳ (golf context). */
  icon?: ReactNode;
};

const cardStyle: CSSProperties = {
  textAlign: 'center',
  padding: 24,
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 8,
};

export function EmptyState({ title, body, action, icon = '⛳' }: EmptyStateProps) {
  return (
    <div style={cardStyle}>
      <div aria-hidden style={{ fontSize: '2.5rem', lineHeight: 1, marginBottom: 8 }}>
        {icon}
      </div>
      <h2 style={{ margin: 0, fontSize: 'var(--font-lg)', color: 'var(--color-text-primary)' }}>
        {title}
      </h2>
      {body ? (
        <p
          style={{
            margin: '8px 0 0 0',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--font-sm)',
          }}
        >
          {body}
        </p>
      ) : null}
      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
    </div>
  );
}
