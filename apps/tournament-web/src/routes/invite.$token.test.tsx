/**
 * T3-6 component tests for InvitePage (PUBLIC route — no auth gate).
 *
 * Tests render `InvitePage` directly bypassing TanStack Router's
 * loader (which is intentionally absent on this route per AC #6).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { InvitePage } from './invite.$token';

const TEST_TOKEN = 'invite-tok-test';

function renderWithQueryClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <InvitePage token={TEST_TOKEN} />
    </QueryClientProvider>,
  );
}

const inviteOk = {
  event: {
    id: 'event-1',
    name: 'Pinehurst 2026',
    startDate: 1_715_040_000_000,
    endDate: 1_715_300_000_000,
    timezone: 'America/New_York',
  },
  roster: [
    { playerId: 'p-alice', name: 'Alice Anderson' },
    { playerId: 'p-bob', name: 'Bob Brown' },
  ],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('InvitePage', () => {
  it('idle render: event header + roster picker', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(inviteOk), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderWithQueryClient();

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /you're invited: pinehurst 2026/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Alice Anderson' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bob Brown' })).toBeInTheDocument();
  });

  it('410 expired: renders "this invite has expired"', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'gone', code: 'invite_expired' }), {
        status: 410,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderWithQueryClient();

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /this invite has expired/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/ask josh for a new invite/i);
  });

  it('404 not_found: renders "invite not found"', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'not_found', code: 'invite_not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderWithQueryClient();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /invite not found/i })).toBeInTheDocument();
    });
  });

  it('tap-name → claim flow: success surface with player name + event name', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = (init as RequestInit | undefined)?.method ?? 'GET';

      if (url.includes('/claim') && method === 'POST') {
        return new Response(
          JSON.stringify({
            player: { id: 'p-alice', name: 'Alice Anderson' },
            event: { id: 'event-1', name: 'Pinehurst 2026' },
            deviceBindingId: 'dev-1',
            requestId: 'r',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/api/invites/') && method === 'GET') {
        return new Response(JSON.stringify(inviteOk), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not-mocked', { status: 500 });
    });

    renderWithQueryClient();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Alice Anderson' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Alice Anderson' }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /welcome, alice anderson/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/pinehurst 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/your device is registered/i)).toBeInTheDocument();
  });

  it('claim error: 400 player_not_in_event → friendly inline message; stay on picker', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = (init as RequestInit | undefined)?.method ?? 'GET';

      if (url.includes('/claim') && method === 'POST') {
        return new Response(
          JSON.stringify({ error: 'bad_request', code: 'player_not_in_event' }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/api/invites/') && method === 'GET') {
        return new Response(JSON.stringify(inviteOk), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not-mocked', { status: 500 });
    });

    renderWithQueryClient();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Alice Anderson' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Alice Anderson' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/that name isn't on this event's roster/i);
    });
    // Still on picker
    expect(screen.getByRole('button', { name: 'Alice Anderson' })).toBeInTheDocument();
  });
});
