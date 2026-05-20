import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageShell } from './page-shell';

describe('PageShell', () => {
  test('renders children with no header when neither title nor actions provided', () => {
    render(
      <PageShell>
        <p>body</p>
      </PageShell>,
    );
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  test('renders header with title only (h1, no actions)', () => {
    render(
      <PageShell title="Events">
        <p>body</p>
      </PageShell>,
    );
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument();
  });

  test('renders header with actions only (no h1)', () => {
    render(
      <PageShell actions={<button>Add</button>}>
        <p>body</p>
      </PageShell>,
    );
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  test('renders header with both title and actions', () => {
    render(
      <PageShell title="Events" actions={<button>Add</button>}>
        <p>body</p>
      </PageShell>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  test('root has CSS-var-driven max-width and padding', () => {
    const { container } = render(
      <PageShell>
        <p>body</p>
      </PageShell>,
    );
    const root = container.firstElementChild as HTMLDivElement;
    expect(root.style.maxWidth).toBe('var(--page-max-width)');
    expect(root.style.padding).toBe('var(--page-padding)');
  });
});
