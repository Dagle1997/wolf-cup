import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingCard } from './loading-card';

describe('LoadingCard', () => {
  test('renders default "Loading…" message when no prop', () => {
    render(<LoadingCard />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  test('renders custom message', () => {
    render(<LoadingCard message="Fetching scores" />);
    expect(screen.getByText('Fetching scores')).toBeInTheDocument();
  });

  test('uses role="status" with aria-live="polite" for screen readers', () => {
    render(<LoadingCard />);
    const node = screen.getByRole('status');
    expect(node).toHaveAttribute('aria-live', 'polite');
  });
});
