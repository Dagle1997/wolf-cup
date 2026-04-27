/**
 * T3-10 component tests for ProfilePage.
 *
 * Tests render `ProfilePage` directly with a stub player prop, bypassing
 * TanStack Router's loader so the component's idle/mutation/error paths
 * are exercised in isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ProfilePage } from './profile';

function renderProfile(player: {
  id: string;
  isOrganizer: boolean;
  ghin: string | null;
  manualHandicapIndex: number | null;
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProfilePage player={player} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProfilePage', () => {
  it('idle render with ghin=null: shows "Link your GHIN" button + manual-handicap input', () => {
    renderProfile({
      id: 'player-1',
      isOrganizer: false,
      ghin: null,
      manualHandicapIndex: null,
    });

    expect(screen.getByRole('heading', { name: /your profile/i })).toBeInTheDocument();
    expect(screen.getByText(/ghin not linked/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /link your ghin/i })).toBeInTheDocument();
    expect(screen.getByTestId('hi-input')).toBeInTheDocument();
  });

  it('idle render with ghin populated: shows "GHIN linked: <number>" + Unlink button', () => {
    renderProfile({
      id: 'player-2',
      isOrganizer: false,
      ghin: '1234567',
      manualHandicapIndex: 12.5,
    });

    expect(screen.getByText(/ghin linked:/i)).toBeInTheDocument();
    expect(screen.getByText('1234567')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^unlink$/i })).toBeInTheDocument();
    // Manual handicap prepopulated.
    const hi = screen.getByTestId('hi-input') as HTMLInputElement;
    expect(hi.value).toBe('12.5');
  });

  it('click "Link your GHIN" → form appears with two tabs', async () => {
    renderProfile({
      id: 'player-3',
      isOrganizer: false,
      ghin: null,
      manualHandicapIndex: null,
    });

    await userEvent.click(screen.getByRole('button', { name: /link your ghin/i }));

    expect(screen.getByRole('tab', { name: /by ghin number/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /by name/i })).toBeInTheDocument();
    expect(screen.getByTestId('link-direct-input')).toBeInTheDocument();
  });

  it('direct-mode submit → POST → success → linked state', async () => {
    const mockFetch = vi.mocked(fetch);
    let capturedBody: string | null = null;
    mockFetch.mockImplementation(async (input, init) => {
      capturedBody = (init as RequestInit | undefined)?.body as string;
      return new Response(
        JSON.stringify({
          result: 'linked',
          ghinNumber: 1234567,
          handicapIndex: 8.4,
          requestId: 'r',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    renderProfile({
      id: 'player-4',
      isOrganizer: false,
      ghin: null,
      manualHandicapIndex: null,
    });

    await userEvent.click(screen.getByRole('button', { name: /link your ghin/i }));
    await userEvent.type(screen.getByTestId('link-direct-input'), '1234567');
    await userEvent.click(screen.getByRole('button', { name: /^link$/i }));

    await waitFor(() => {
      expect(screen.getByText(/ghin linked:/i)).toBeInTheDocument();
    });
    expect(screen.getByText('1234567')).toBeInTheDocument();
    expect(capturedBody).not.toBeNull();
    const parsed = JSON.parse(capturedBody!) as { mode: string; ghinNumber: number };
    expect(parsed.mode).toBe('direct');
    expect(parsed.ghinNumber).toBe(1234567);
  });

  it('search → multi-match → pick → linked state', async () => {
    const mockFetch = vi.mocked(fetch);
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            result: 'multi-match',
            matches: [
              {
                ghinNumber: 1111111,
                firstName: 'Matt',
                lastName: 'Wood',
                handicapIndex: 10,
                club: 'A',
                state: 'WV',
              },
              {
                ghinNumber: 2222222,
                firstName: 'Matt',
                lastName: 'Jaquint',
                handicapIndex: 12,
                club: 'B',
                state: 'WV',
              },
            ],
            requestId: 'r1',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // Second call: pick → linked
      return new Response(
        JSON.stringify({
          result: 'linked',
          ghinNumber: 2222222,
          handicapIndex: 12,
          requestId: 'r2',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    renderProfile({
      id: 'player-5',
      isOrganizer: false,
      ghin: null,
      manualHandicapIndex: null,
    });

    await userEvent.click(screen.getByRole('button', { name: /link your ghin/i }));
    await userEvent.click(screen.getByRole('tab', { name: /by name/i }));
    await userEvent.type(screen.getByTestId('link-search-lastname'), 'Matt');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByTestId('match-picker')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByTestId('match-pick-2222222'));

    await waitFor(() => {
      expect(screen.getByText(/ghin linked:/i)).toBeInTheDocument();
    });
    expect(screen.getByText('2222222')).toBeInTheDocument();
  });

  it('manual-handicap save → PATCH → success message', async () => {
    const mockFetch = vi.mocked(fetch);
    let capturedBody: string | null = null;
    mockFetch.mockImplementation(async (input, init) => {
      capturedBody = (init as RequestInit | undefined)?.body as string;
      return new Response(
        JSON.stringify({ manualHandicapIndex: 14.2, requestId: 'r' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    renderProfile({
      id: 'player-6',
      isOrganizer: false,
      ghin: null,
      manualHandicapIndex: null,
    });

    await userEvent.type(screen.getByTestId('hi-input'), '14.2');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/saved/i);
    });
    const parsed = JSON.parse(capturedBody!) as { manualHandicapIndex: number };
    expect(parsed.manualHandicapIndex).toBe(14.2);
  });

  it('unlink confirm flow', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ghinNumber: null, requestId: 'r' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderProfile({
      id: 'player-7',
      isOrganizer: false,
      ghin: '5555555',
      manualHandicapIndex: null,
    });

    await userEvent.click(screen.getByRole('button', { name: /^unlink$/i }));
    expect(screen.getByRole('dialog', { name: /confirm unlink/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /confirm unlink/i }));

    await waitFor(() => {
      expect(screen.getByText(/ghin not linked/i)).toBeInTheDocument();
    });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/players/me/ghin',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
