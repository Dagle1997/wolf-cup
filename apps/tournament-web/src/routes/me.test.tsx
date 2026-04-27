/**
 * T3-7 component tests for MePage.
 *
 * Tests render `MePage` directly bypassing TanStack Router's loader so
 * the component's idle / mutation / error / redirect paths are exercised
 * in isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MePage } from './me';

function renderWithQueryClient(props: { isOrganizer?: boolean } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const player = { id: 'player-test-123', isOrganizer: props.isOrganizer ?? false };
  return render(
    <QueryClientProvider client={qc}>
      <MePage player={player} />
    </QueryClientProvider>,
  );
}

let assignSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  assignSpy = vi.fn();
  // window.location.assign is read-only on jsdom; replace via defineProperty.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: assignSpy },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MePage', () => {
  it('idle render: shows player id + "That\'s not me" button', () => {
    renderWithQueryClient();
    expect(screen.getByRole('heading', { name: /your account/i })).toBeInTheDocument();
    expect(screen.getByText(/player-test-123/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /that's not me/i })).toBeInTheDocument();
  });

  it('organizer flag shows "(organizer)" suffix', () => {
    renderWithQueryClient({ isOrganizer: true });
    expect(screen.getByText(/\(organizer\)/i)).toBeInTheDocument();
  });

  it('click "That\'s not me" → POST 204 → window.location.assign("/")', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

    renderWithQueryClient();
    await userEvent.click(screen.getByRole('button', { name: /that's not me/i }));

    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith('/');
    });
    // Verify the POST was made.
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/auth/that-is-not-me',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('click "That\'s not me" → POST 500 → renders friendly error message', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response('boom', { status: 500 }));

    renderWithQueryClient();
    await userEvent.click(screen.getByRole('button', { name: /that's not me/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/couldn't sign out/i);
    });
    // No redirect on error.
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('button disabled while mutation is in-flight', async () => {
    const mockFetch = vi.mocked(fetch);
    const resolveRef: { current: ((res: Response) => void) | null } = { current: null };
    mockFetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRef.current = resolve;
        }),
    );

    renderWithQueryClient();
    const button = screen.getByRole('button', { name: /that's not me/i });
    await userEvent.click(button);

    // Button is now disabled with the "Signing out..." label.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /signing out/i })).toBeDisabled();
    });

    // Drain the in-flight request so the test cleanup doesn't see an
    // unresolved promise.
    resolveRef.current?.(new Response(null, { status: 204 }));
    // Await the mutation's onSuccess (assignSpy) so post-resolve effects
    // settle deterministically before the test exits — prevents
    // intermittent warnings about state updates after teardown.
    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith('/');
    });
  });
});
