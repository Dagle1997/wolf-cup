import { describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { NotFound } from './not-found';

afterEach(() => cleanup());

describe('NotFound', () => {
  it('renders 404 anchor + heading', () => {
    render(<NotFound />);
    expect(screen.getByTestId('not-found')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Page not found/i })).toBeTruthy();
  });
});
