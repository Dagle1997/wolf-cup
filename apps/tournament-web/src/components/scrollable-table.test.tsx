import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ScrollableTable } from './scrollable-table';

describe('ScrollableTable', () => {
  test('renders its children', () => {
    render(
      <ScrollableTable label="Leaderboard">
        <table>
          <tbody>
            <tr>
              <td>cell</td>
            </tr>
          </tbody>
        </table>
      </ScrollableTable>,
    );
    expect(screen.getByText('cell')).toBeInTheDocument();
  });

  test('exposes a named region landmark using the label as accessible name', () => {
    render(
      <ScrollableTable label="Money matrix">
        <table>
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </ScrollableTable>,
    );
    // getByRole with a name implicitly asserts role="region" + aria-label.
    const region = screen.getByRole('region', { name: 'Money matrix' });
    expect(region).toBeInTheDocument();
  });

  test('the scroll region is keyboard-focusable (tabIndex 0)', () => {
    render(
      <ScrollableTable label="Pairings">
        <table>
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </ScrollableTable>,
    );
    const region = screen.getByRole('region', { name: 'Pairings' });
    expect(region).toHaveAttribute('tabindex', '0');
  });

  test('carries the scroll-region class that the focus-ring CSS rule keys on', () => {
    render(
      <ScrollableTable label="Course holes">
        <table>
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </ScrollableTable>,
    );
    const region = screen.getByRole('region', { name: 'Course holes' });
    expect(region).toHaveClass('scroll-region');
    // overflow-x:auto is what makes it scroll horizontally (T12-2 fix preserved).
    expect(region).toHaveStyle({ overflowX: 'auto' });
  });
});
