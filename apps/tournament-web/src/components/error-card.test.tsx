import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorCard } from './error-card';

describe('ErrorCard', () => {
  test('renders default title and Error.message from an Error instance', () => {
    render(<ErrorCard error={new Error('Boom')} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Something went wrong');
    expect(screen.getByText('Boom')).toBeInTheDocument();
  });

  test('renders custom title', () => {
    render(<ErrorCard error="x" title="Custom title" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Custom title');
  });

  test('renders string error passthrough', () => {
    render(<ErrorCard error="Network down" />);
    expect(screen.getByText('Network down')).toBeInTheDocument();
  });

  test('extracts message from {message: string} object shape', () => {
    render(<ErrorCard error={{ message: 'Wrapped' }} />);
    expect(screen.getByText('Wrapped')).toBeInTheDocument();
  });

  test('falls back to JSON.stringify for JSON-serializable non-Error object', () => {
    render(<ErrorCard error={{ foo: 'bar' }} />);
    expect(screen.getByText('{"foo":"bar"}')).toBeInTheDocument();
  });

  test('renders literal "Unknown error" for undefined input', () => {
    render(<ErrorCard error={undefined} />);
    expect(screen.getByText('Unknown error')).toBeInTheDocument();
  });

  test('renders literal "Unknown error" for primitive inputs (null/number/boolean) — primitives never render their JSON form', () => {
    const cases: unknown[] = [null, 42, 0, true, false];
    for (const c of cases) {
      const { unmount } = render(<ErrorCard error={c} />);
      expect(screen.getByText('Unknown error')).toBeInTheDocument();
      expect(screen.queryByText('null')).not.toBeInTheDocument();
      expect(screen.queryByText('42')).not.toBeInTheDocument();
      expect(screen.queryByText('0')).not.toBeInTheDocument();
      expect(screen.queryByText('true')).not.toBeInTheDocument();
      expect(screen.queryByText('false')).not.toBeInTheDocument();
      unmount();
    }
  });

  test('renders literal "Unknown error" for empty object {}', () => {
    render(<ErrorCard error={{}} />);
    expect(screen.getByText('Unknown error')).toBeInTheDocument();
  });

  test('renders literal "Unknown error" for circular-reference object (JSON.stringify throws)', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    render(<ErrorCard error={circular} />);
    expect(screen.getByText('Unknown error')).toBeInTheDocument();
  });

  test('never renders "[object Object]" for any tested object shape', () => {
    const cases: unknown[] = [{ foo: 'bar' }, { message: 'm' }, {}, null];
    for (const c of cases) {
      const { unmount } = render(<ErrorCard error={c} />);
      expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
      unmount();
    }
  });

  test('does NOT render retry button when onRetry omitted', () => {
    render(<ErrorCard error="x" />);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  test('renders retry button and calls onRetry on click', () => {
    const onRetry = vi.fn();
    render(<ErrorCard error="x" onRetry={onRetry} />);
    const btn = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('does not throw rendering for any of: null, undefined, number, symbol, function', () => {
    const cases: unknown[] = [null, undefined, 42, Symbol('s'), () => {}];
    for (const c of cases) {
      const { unmount } = render(<ErrorCard error={c} />);
      // Render didn't throw — assertion passes implicitly. Add a positive
      // assertion that *some* text is rendered (Unknown error / number / etc).
      expect(screen.getByRole('alert')).toBeInTheDocument();
      unmount();
    }
  });
});
