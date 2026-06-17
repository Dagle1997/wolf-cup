/**
 * Pete Dye match-play standings page smoke tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MatchPlayStandingsPage } from './events.$eventId.match-play-standings';
import { renderInRouter } from '../test-utils/render-in-router';

function render(eventId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderInRouter(
    <QueryClientProvider client={qc}>
      <MatchPlayStandingsPage eventId={eventId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

const FIXTURE = {
  eventId: 'evt1',
  teams: [
    {
      teamKey: 'a|b',
      players: [
        { playerId: 'a', name: 'David' },
        { playerId: 'b', name: 'Ikie' },
      ],
      matchesPlayed: 2,
      won: 1,
      halved: 1,
      lost: 0,
      points: 1.5,
      holesWon: 18,
      holesLost: 12,
      holesHalved: 6,
      holesDiff: 6,
    },
    {
      teamKey: 'c|d',
      players: [
        { playerId: 'c', name: 'Ronnie' },
        { playerId: 'd', name: 'Steve' },
      ],
      matchesPlayed: 2,
      won: 0,
      halved: 1,
      lost: 1,
      points: 0.5,
      holesWon: 12,
      holesLost: 18,
      holesHalved: 6,
      holesDiff: -6,
    },
  ],
};

describe('MatchPlayStandingsPage', () => {
  it('renders teams with W-H-L, points (incl. ½), and hole differential', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE,
    });
    render('evt1');

    await waitFor(() => expect(screen.getByTestId('match-row-a|b')).toBeInTheDocument());
    expect(screen.getByText('David + Ikie')).toBeInTheDocument();
    expect(screen.getByTestId('points-a|b')).toHaveTextContent('1.5');
    expect(screen.getByTestId('points-c|d')).toHaveTextContent('0.5');
    expect(screen.getByTestId('holes-diff-a|b')).toHaveTextContent('+6');
    expect(screen.getByTestId('holes-diff-c|d')).toHaveTextContent('−6');

    // Server order is authoritative (points desc) → a|b renders first.
    const rows = screen.getAllByTestId(/^match-row-/);
    expect(rows[0]).toHaveAttribute('data-testid', 'match-row-a|b');
    expect(within(rows[0]!).getByText('1-1-0')).toBeInTheDocument();
  });

  it('shows an empty state when no matches have scored', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ eventId: 'evt1', teams: [] }),
    });
    render('evt1');
    await waitFor(() => expect(screen.getByText('No matches scored yet')).toBeInTheDocument());
  });

  it('renders an error card when the fetch fails', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    render('evt1');
    await waitFor(() =>
      expect(screen.getByText("Couldn't load match-play standings.")).toBeInTheDocument(),
    );
  });
});
