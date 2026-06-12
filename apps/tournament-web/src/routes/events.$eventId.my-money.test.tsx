/**
 * T13-5 My Money board smoke tests.
 *
 * Renders MyMoneyPage directly (bypasses the router auth loader). Mocks fetch
 * with a viewer-signed fixture (one foursome game + one side match) and asserts
 * the grand total, per-game subheadings, and per-game totals render.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MyMoneyPage } from './events.$eventId.my-money';
import { renderInRouter } from '../test-utils/render-in-router';

function render(eventId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderInRouter(
    <QueryClientProvider client={qc}>
      <MyMoneyPage eventId={eventId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

const FIXTURE = {
  viewerId: 'me',
  totalNetCents: 500, // -2000 foursome + 2500 vs Rick
  games: [
    {
      kind: 'foursome' as const,
      key: 'foursome',
      label: '2-Ball Foursome Match',
      opponentName: null,
      netToViewerCents: -2000,
      perRound: [
        {
          eventRoundId: 'er1',
          roundNumber: 1,
          netToViewerCents: -2000,
          perHole: [
            { holeNumber: 1, par: 4, viewerGross: 5, viewerNet: 5, oppGross: null, oppNet: 4, winner: 'opponent' as const, moneyToViewerCents: -2000 },
          ],
        },
      ],
    },
    {
      kind: 'individual' as const,
      key: 'bet-rick',
      label: 'Match vs Rick',
      opponentName: 'Rick',
      netToViewerCents: 2500,
      perRound: [
        {
          eventRoundId: 'er1',
          roundNumber: 1,
          netToViewerCents: 2500,
          perHole: [
            { holeNumber: 1, par: 4, viewerGross: 4, viewerNet: 4, oppGross: 5, oppNet: 5, winner: 'viewer' as const, moneyToViewerCents: 2500 },
          ],
        },
      ],
    },
  ],
};

describe('MyMoneyPage', () => {
  it('renders grand total + a section per game with its own total', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE,
    });
    render('evt1');

    await waitFor(() => expect(screen.getByTestId('my-money-grand-total')).toBeInTheDocument());
    expect(screen.getByTestId('my-money-grand-total')).toHaveTextContent('$5.00');

    // Both game subheadings present.
    expect(screen.getByText('2-Ball Foursome Match')).toBeInTheDocument();
    expect(screen.getByText('Match vs Rick')).toBeInTheDocument();

    // Per-game totals (viewer-signed).
    expect(screen.getByTestId('my-money-game-total-foursome')).toHaveTextContent('-$20.00');
    expect(screen.getByTestId('my-money-game-total-bet-rick')).toHaveTextContent('$25.00');

    // The side match shows the opponent's score column header.
    const betSection = screen.getByTestId('my-money-game-bet-rick');
    expect(within(betSection).getByText('Rick')).toBeInTheDocument();
  });

  it('renders the forbidden card on 403', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    });
    render('evt1');
    await waitFor(() => expect(screen.getByText('Not a participant')).toBeInTheDocument());
  });
});
