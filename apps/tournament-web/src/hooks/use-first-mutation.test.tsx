/**
 * T7-6 useFirstMutation hook + provider tests.
 */

import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  FirstMutationProvider,
  useFirstMutationFlag,
  useMarkMutation,
} from './use-first-mutation';

function FlagDisplay() {
  const flag = useFirstMutationFlag();
  return <div data-testid="flag">{flag ? 'true' : 'false'}</div>;
}

function Trigger() {
  const mark = useMarkMutation();
  return (
    <button data-testid="trigger" onClick={() => mark()}>
      mark
    </button>
  );
}

describe('useFirstMutation', () => {
  it('flag is false outside the provider (default-context fallback)', () => {
    render(<FlagDisplay />);
    expect(screen.getByTestId('flag').textContent).toBe('false');
  });

  it('flag is false inside provider until markMutation fires', () => {
    render(
      <FirstMutationProvider>
        <FlagDisplay />
        <Trigger />
      </FirstMutationProvider>,
    );
    expect(screen.getByTestId('flag').textContent).toBe('false');
  });

  it('markMutation flips flag to true', () => {
    render(
      <FirstMutationProvider>
        <FlagDisplay />
        <Trigger />
      </FirstMutationProvider>,
    );
    act(() => {
      screen.getByTestId('trigger').click();
    });
    expect(screen.getByTestId('flag').textContent).toBe('true');
  });

  it('subsequent markMutation calls are no-ops (idempotent)', () => {
    render(
      <FirstMutationProvider>
        <FlagDisplay />
        <Trigger />
      </FirstMutationProvider>,
    );
    act(() => {
      screen.getByTestId('trigger').click();
      screen.getByTestId('trigger').click();
      screen.getByTestId('trigger').click();
    });
    expect(screen.getByTestId('flag').textContent).toBe('true');
  });

  it('fresh mount resets flag to false', () => {
    const { unmount } = render(
      <FirstMutationProvider>
        <FlagDisplay />
        <Trigger />
      </FirstMutationProvider>,
    );
    act(() => {
      screen.getByTestId('trigger').click();
    });
    expect(screen.getByTestId('flag').textContent).toBe('true');
    unmount();

    render(
      <FirstMutationProvider>
        <FlagDisplay />
        <Trigger />
      </FirstMutationProvider>,
    );
    expect(screen.getByTestId('flag').textContent).toBe('false');
  });
});
