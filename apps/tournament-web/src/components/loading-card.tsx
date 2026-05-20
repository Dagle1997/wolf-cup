/**
 * T11-1 LoadingCard — uniform loading state.
 *
 * Replaces ~15+ hand-rolled `<p>Loading…</p>` variants across routes.
 * No spinner v1; future enhancement.
 */
import type { CSSProperties } from 'react';

export type LoadingCardProps = {
  message?: string;
};

const cardStyle: CSSProperties = {
  textAlign: 'center',
  padding: 24,
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-sm)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 8,
};

export function LoadingCard({ message = 'Loading…' }: LoadingCardProps) {
  return (
    <div role="status" aria-live="polite" style={cardStyle}>
      {message}
    </div>
  );
}
