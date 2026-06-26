/**
 * Pete Dye team-standings page smoke tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TeamStandingsPage } from './events.$eventId.team-standings';
import { renderInRouter } from '../test-utils/render-in-router';

function render(eventId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderInRouter(
    <QueryClientProvider client={qc}>
      <TeamStandingsPage eventId={eventId} />
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
      holesPlayed: 18,
      grossTotal: 78,
      netTotal: 78,
      parTotal: 72,
      toPar: 6,
    },
    {
      teamKey: 'c|d',
      players: [
        { playerId: 'c', name: 'Ronnie' },
        { playerId: 'd', name: 'Steve' },
      ],
      holesPlayed: 18,
      grossTotal: 84,
      netTotal: 84,
      parTotal: 72,
      toPar: 12,
    },
  ],
};

describe('TeamStandingsPage', () => {
  it('renders teams with gross/net/to-par, sorted by net to par', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE,
    });
    render('evt1');

    await waitFor(() => expect(screen.getByTestId('team-row-a|b')).toBeInTheDocument());
    expect(screen.getByText('David + Ikie')).toBeInTheDocument();
    expect(screen.getByTestId('to-par-a|b')).toHaveTextContent('+6');
    expect(screen.getByTestId('to-par-c|d')).toHaveTextContent('+12');

    // Default order = by to-par → team a|b (the leader) renders first.
    const rows = screen.getAllByTestId(/^team-row-/);
    expect(rows[0]).toHaveAttribute('data-testid', 'team-row-a|b');
    expect(within(rows[0]!).getByTestId('to-par-a|b')).toHaveTextContent('+6');
  });

  it('shows an empty state when no teams have scored', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ eventId: 'evt1', teams: [] }),
    });
    render('evt1');
    await waitFor(() => expect(screen.getByText('No teams scored yet')).toBeInTheDocument());
  });

  it('sorts a no-score team LAST (not tied at even) and renders — for its totals', async () => {
    // A team with no scored holes (toPar 0, net 0) must not outrank a team that
    // actually played to +6 — regardless of sort key.
    const withUnscored = {
      eventId: 'evt1',
      teams: [
        ...FIXTURE.teams,
        {
          teamKey: 'e|f',
          players: [
            { playerId: 'e', name: 'Rich' },
            { playerId: 'f', name: 'Chris' },
          ],
          holesPlayed: 0,
          grossTotal: 0,
          netTotal: 0,
          parTotal: 0,
          toPar: 0,
        },
      ],
    };
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => withUnscored,
    });
    render('evt1');
    await waitFor(() => expect(screen.getByTestId('team-row-e|f')).toBeInTheDocument());
    const rows = screen.getAllByTestId(/^team-row-/);
    // The unscored team is dead last, even though its toPar/net are numerically 0.
    expect(rows[rows.length - 1]).toHaveAttribute('data-testid', 'team-row-e|f');
    // Its totals read "—", not 0 / E.
    expect(within(screen.getByTestId('team-row-e|f')).getByTestId('to-par-e|f')).toHaveTextContent('—');
    expect(screen.getByText(/no scores/)).toBeInTheDocument();
    // Still last after switching to Net sort (where net 0 would otherwise lead).
    await userEvent.click(screen.getByTestId('sort-net'));
    const rows2 = screen.getAllByTestId(/^team-row-/);
    expect(rows2[rows2.length - 1]).toHaveAttribute('data-testid', 'team-row-e|f');
  });

  it('re-sorts when a sort toggle is clicked', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => FIXTURE,
    });
    render('evt1');
    await waitFor(() => expect(screen.getByTestId('sort-gross')).toBeInTheDocument());
    // Gross sort keeps a|b (78) ahead of c|d (84) — but exercises the toggle.
    await userEvent.click(screen.getByTestId('sort-gross'));
    const rows = screen.getAllByTestId(/^team-row-/);
    expect(rows[0]).toHaveAttribute('data-testid', 'team-row-a|b');
  });
});
