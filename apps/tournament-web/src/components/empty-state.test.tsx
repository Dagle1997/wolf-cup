import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  test('renders title only', () => {
    render(<EmptyState title="No rounds yet" />);
    expect(screen.getByRole('heading', { level: 2, name: 'No rounds yet' })).toBeInTheDocument();
  });

  test('renders body when provided', () => {
    render(<EmptyState title="No rounds yet" body="Create one to get started." />);
    expect(screen.getByText('Create one to get started.')).toBeInTheDocument();
  });

  test('renders action when provided', () => {
    render(
      <EmptyState
        title="No rounds yet"
        body="Create one to get started."
        action={<button>New round</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'New round' })).toBeInTheDocument();
  });

  test('renders title only when neither body nor action provided (no body paragraph, no action wrapper)', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Empty' })).toBeInTheDocument();
    // No <p> element should exist (body not rendered).
    expect(container.querySelector('p')).toBeNull();
    // No <button> element should exist (action not rendered).
    expect(container.querySelector('button')).toBeNull();
  });
});
