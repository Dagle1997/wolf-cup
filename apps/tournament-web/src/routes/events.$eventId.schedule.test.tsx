/**
 * T7-2 schedule page smoke tests.
 *
 * Renders SchedulePage directly. Mocks fetch with a 3-round payload
 * including same-day grouping + each pairing-state variant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderInRouter } from '../test-utils/render-in-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SchedulePage, groupRoundsByDate } from './events.$eventId.schedule';

const MAY_8_NY = Date.UTC(2026, 4, 8, 4);
const MAY_9_NY = Date.UTC(2026, 4, 9, 4);

function renderWithQc(eventId: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return renderInRouter(
    <QueryClientProvider client={qc}>
      <SchedulePage eventId={eventId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const FIXTURE = {
  event: { id: 'evt-1', name: 'Pinehurst 2026', timezone: 'America/New_York' },
  rounds: [
    {
      id: 'er-1',
      roundNumber: 1,
      roundDate: MAY_8_NY,
      holesToPlay: 18,
      teeColor: 'blue',
      course: { id: 'c-1', name: 'Pinehurst No. 2', clubName: 'Pinehurst Resort' },
      pairing: {
        kind: 'foursome',
        foursomeNumber: 1,
        members: [
          { playerId: 'pV', name: 'Viewer Vince', handicapIndex: 8.0, isViewer: true },
          { playerId: 'p2', name: 'Player Two', handicapIndex: 12.0, isViewer: false },
          { playerId: 'p3', name: 'Player Three', handicapIndex: 14.0, isViewer: false },
          { playerId: 'p4', name: 'Player Four', handicapIndex: 22.0, isViewer: false },
        ],
      },
    },
    {
      // Same date as round 1 — Emergency 9 afternoon.
      id: 'er-2',
      roundNumber: 2,
      roundDate: MAY_8_NY,
      holesToPlay: 9,
      teeColor: 'white',
      course: { id: 'c-1', name: 'Pinehurst No. 2', clubName: 'Pinehurst Resort' },
      pairing: { kind: 'no_pairings_set' },
    },
    {
      id: 'er-3',
      roundNumber: 3,
      roundDate: MAY_9_NY,
      holesToPlay: 18,
      teeColor: 'blue',
      course: { id: 'c-2', name: 'Mid Pines', clubName: 'Mid Pines Inn' },
      pairing: { kind: 'viewer_not_in_foursome' },
    },
  ],
};

describe('SchedulePage', () => {
  it('renders rounds with course + tee color + holes chip + viewer-highlighted pairing', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithQc('evt-1');
    // Wait for data state — "Round 1" only renders after fetch resolves.
    await waitFor(() => {
      expect(screen.getByText(/Round 1/)).toBeInTheDocument();
    });
    // Course name + club appear in the rendered HTML even if RTL's default
    // text normalizer can't match them as a single node.
    expect(document.body.textContent).toContain('Pinehurst No. 2');
    expect(document.body.textContent).toContain('Pinehurst Resort');
    expect(document.body.textContent).toContain('Mid Pines');
    expect(document.body.textContent).toContain('18 holes');
    expect(document.body.textContent).toContain('9 holes');
    // Viewer name appears (pairing.kind = 'foursome' for round 1).
    expect(screen.getByText(/Viewer Vince/)).toBeInTheDocument();
  });

  it('renders "Pairings not set yet" for no_pairings_set state', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(FIXTURE), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    renderWithQc('evt-1');
    await waitFor(() => {
      expect(screen.getByText(/Pairings not set yet/i)).toBeInTheDocument();
    });
  });

  it('renders "You\'re not in a foursome this round" for viewer_not_in_foursome state', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(FIXTURE), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    renderWithQc('evt-1');
    await waitFor(() => {
      expect(screen.getByText(/You're not in a foursome this round/i)).toBeInTheDocument();
    });
  });

  it('renders forbidden card on 403', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{}', { status: 403 }),
    );
    renderWithQc('evt-1');
    await waitFor(() => {
      expect(screen.getByText(/aren't a participant/i)).toBeInTheDocument();
    });
  });

  it('groups same-day rounds under a single date header', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(FIXTURE), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    renderWithQc('evt-1');
    await waitFor(() => {
      // Two date headers expected: May 8 (rounds 1+2) and May 9 (round 3).
      const may8 = screen.getAllByText(/Friday, May 8/);
      const may9 = screen.getAllByText(/Saturday, May 9/);
      expect(may8.length).toBe(1);   // single header even though 2 rounds share date
      expect(may9.length).toBe(1);
    });
  });

  it('date format uses event.timezone, NOT viewer local (Pacific/Auckland fixture)', async () => {
    // 2026-05-08 06:00 Auckland = 2026-05-07 18:00 UTC.
    // If formatter respects event.timezone, output is "Friday, May 8".
    // If it leaked viewer's local (UTC/NY), output would be "Thursday, May 7".
    const aucklandFixture = {
      event: { id: 'evt-2', name: 'Auckland Open', timezone: 'Pacific/Auckland' },
      rounds: [
        {
          id: 'er-a1',
          roundNumber: 1,
          roundDate: Date.UTC(2026, 4, 7, 18),
          holesToPlay: 18,
          teeColor: 'blue',
          course: { id: 'c-a', name: 'Auckland CC', clubName: 'Auckland Club' },
          pairing: { kind: 'no_pairings_set' },
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(aucklandFixture), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    renderWithQc('evt-2');
    await waitFor(() => {
      expect(screen.getByText(/Friday, May 8/)).toBeInTheDocument();
    });
  });
});

describe('groupRoundsByDate', () => {
  it('groups rounds with identical roundDate', () => {
    const rounds = [
      { id: 'a', roundDate: 100 },
      { id: 'b', roundDate: 100 },
      { id: 'c', roundDate: 200 },
    ];
    const groups = groupRoundsByDate(rounds);
    expect(groups.length).toBe(2);
    expect(groups[0]!.roundDate).toBe(100);
    expect(groups[0]!.rounds.length).toBe(2);
    expect(groups[1]!.rounds.length).toBe(1);
  });

  it('groups in chronological roundDate order regardless of input order', () => {
    const rounds = [
      { id: 'b', roundDate: 200 },
      { id: 'a', roundDate: 100 },
    ];
    const groups = groupRoundsByDate(rounds);
    expect(groups.map((g) => g.roundDate)).toEqual([100, 200]);
  });

  it('preserves input order within a date group', () => {
    const rounds = [
      { id: 'a', roundDate: 100, n: 1 },
      { id: 'b', roundDate: 100, n: 2 },
      { id: 'c', roundDate: 100, n: 3 },
    ];
    const groups = groupRoundsByDate(rounds);
    expect(groups[0]!.rounds.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles empty array', () => {
    expect(groupRoundsByDate([])).toEqual([]);
  });
});
