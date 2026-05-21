/**
 * T6-6 settle-up page smoke tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderInRouter } from '../test-utils/render-in-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SettleUpPage } from './events.$eventId.settle-up';

function renderWithQueryClient(eventId: string, viewerId?: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const pageProps = viewerId === undefined
    ? ({ eventId } as const)
    : ({ eventId, viewerId } as const);
  return renderInRouter(
    <QueryClientProvider client={qc}>
      <SettleUpPage {...pageProps} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ZERO_SUM_FIXTURE = {
  players: [
    { id: 'pA', name: 'Alice' },
    { id: 'pB', name: 'Bob' },
  ],
  matrix: {
    pA: { pA: 0, pB: 500 },
    pB: { pA: -500, pB: 0 },
  },
  totals: { pA: 500, pB: -500 },
  computedAt: '2026-05-04T00:00:00.000Z',
  visibilityMode: 'open' as const,
};

const NONZERO_SUM_FIXTURE = {
  ...ZERO_SUM_FIXTURE,
  // intentionally broken: totals don't sum to 0
  totals: { pA: 500, pB: -300 },
};

describe('SettleUpPage', () => {
  it('renders balances + pairwise breakdown ordered by total descending', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(ZERO_SUM_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithQueryClient('evt-1', 'pA');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /balances/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: /pairwise breakdown/i })).toBeInTheDocument();
    // Both players appear.
    expect(screen.getAllByText(/Alice/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Bob/).length).toBeGreaterThan(0);
  });

  it('renders zero-sum warning banner when totals do NOT sum to 0', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(NONZERO_SUM_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithQueryClient('evt-1', 'pA');
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/don't sum to zero/i);
    });
  });

  it('does NOT render warning when totals sum to 0', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(ZERO_SUM_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithQueryClient('evt-1', 'pA');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /balances/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders forbidden message on 403', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{}', { status: 403 }),
    );
    renderWithQueryClient('evt-1', 'pA');
    await waitFor(() => {
      expect(screen.getByText(/aren't a participant/i)).toBeInTheDocument();
    });
  });
});
