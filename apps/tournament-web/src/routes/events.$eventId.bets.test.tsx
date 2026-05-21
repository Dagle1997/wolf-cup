/**
 * T6-8 bets page smoke tests.
 *
 * Renders BetsPage directly (bypasses TanStack Router's auth loader).
 * Mocks fetch with minimal bet payloads and asserts:
 *  - bets render with opponent name + total net + per-round rows
 *  - empty state when bets is []
 *  - forbidden message on 403
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderInRouter } from '../test-utils/render-in-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { BetsPage } from './events.$eventId.bets';

function renderWithQueryClient(eventId: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return renderInRouter(
    <QueryClientProvider client={qc}>
      <BetsPage eventId={eventId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const BET_FIXTURE = {
  bets: [
    {
      betId: 'bet-1',
      playerAId: 'pA',
      playerBId: 'pB',
      opponentPlayerId: 'pB',
      opponentName: 'Bob',
      betType: 'match_play_per_hole' as const,
      stakePerHoleCents: 500,
      applicableRoundIds: ['er-1', 'er-2'],
      perRoundStanding: [
        { eventRoundId: 'er-1', roundNumber: 1, holesPlayed: 9, holesRemaining: 9, netToViewerCents: 1500 },
        { eventRoundId: 'er-2', roundNumber: 2, holesPlayed: 0, holesRemaining: 18, netToViewerCents: 0 },
      ],
      totalNetToViewerCents: 1500,
      presses: [
        {
          betPressId: 'pr-1',
          eventRoundId: 'er-1',
          firedAtHole: 7,
          triggerType: 'auto' as const,
          multiplier: 2,
        },
      ],
    },
  ],
};

describe('BetsPage', () => {
  it('renders bet card with opponent name + signed total + per-round row + press', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(BET_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithQueryClient('evt-1');

    await waitFor(() => {
      expect(screen.getByText(/vs Bob/i)).toBeInTheDocument();
    });

    // +$15.00 appears in BOTH the total (top of card) AND the Round 1 net
    // (since round 2 is 0 and round 1 = 1500, the round 1 row also shows
    // +$15.00). Use getAllByText.
    const fifteens = screen.getAllByText('+$15.00');
    expect(fifteens.length).toBeGreaterThanOrEqual(2);

    // Per-round row text.
    expect(screen.getByText(/Round 1/)).toBeInTheDocument();
    expect(screen.getByText(/through hole 9 of 18/)).toBeInTheDocument();

    // Press row.
    expect(screen.getByText(/Hole 7 — auto press, ×2/)).toBeInTheDocument();
  });

  it('renders empty state when bets is []', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ bets: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithQueryClient('evt-1');
    await waitFor(() => {
      expect(screen.getByText(/No bets yet/i)).toBeInTheDocument();
    });
  });

  it('renders forbidden message on 403', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{}', { status: 403 }),
    );
    renderWithQueryClient('evt-1');
    await waitFor(() => {
      expect(screen.getByText(/aren't a participant/i)).toBeInTheDocument();
    });
  });
});
