/**
 * Story 3-4 — during-round leaderboard with expandable per-player scorecards.
 * Covers: expand/collapse + single-open + aria; the runtime round.id is used in
 * the scorecard fetch URL; cents→dollars (+$5 / -$20 / 0 / —, all on played
 * holes); showMoney gating (money mode vs scores-only); inline unavailable; and
 * non-expandable in event scope (no round.id).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LeaderboardPage } from './events.$eventId.leaderboard';
import { renderInRouter } from '../test-utils/render-in-router';

function render(eventId: string, viewerId?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderInRouter(
    <QueryClientProvider client={qc}>
      <LeaderboardPage eventId={eventId} {...(viewerId !== undefined ? { viewerId } : {})} />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

type Json = Record<string, unknown>;
const RESPONSE = (status: number, body: Json) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** Build an 18-hole scorecard; first entries (with moneyNet) are played par-4s. */
function scorecard(played: Array<{ hole: number; gross: number; net: number; moneyNet: number | null }>) {
  const byHole = new Map(played.map((p) => [p.hole, p]));
  const holes = [];
  for (let n = 1; n <= 18; n++) {
    const p = byHole.get(n);
    holes.push({
      holeNumber: n,
      par: 4,
      grossScore: p ? p.gross : null,
      netScore: p ? p.net : null,
      relativeStrokes: 0,
      hasGreenie: false,
      hasPolie: false,
      hasSandie: false,
      moneyNet: p ? p.moneyNet : null, // CENTS
    });
  }
  return { holes };
}

type LbOpts = { mode?: 'money' | 'scores_only'; moneyEnabled?: boolean; round?: Json | null };
function leaderboard(opts: LbOpts = {}): Json {
  const f1 =
    opts.mode === undefined
      ? undefined
      : { lockState: opts.mode === 'money' ? 'locked' : 'unlocked', mode: opts.mode, moneyEnabled: opts.moneyEnabled ?? true };
  // Realistic: the API returns moneyCents null unless money is exposed (money
  // mode + flag) — mirror that so the row's $ column suppression is testable.
  const moneyExposed = opts.mode === 'money' && (opts.moneyEnabled ?? true);
  const m = (cents: number) => (moneyExposed ? cents : null);
  return {
    rows: [
      { playerId: 'p1', playerName: 'Steve', handicapIndex: 8, courseHandicap: 8, grossThroughHole: 13, netThroughHole: 13, netToPar: -2, throughHole: 3, rank: 1, tiedWith: 1, skinsCents: null, moneyCents: m(1500) },
      { playerId: 'p2', playerName: 'Ronnie', handicapIndex: 10, courseHandicap: 10, grossThroughHole: 15, netThroughHole: 13, netToPar: 1, throughHole: 3, rank: 2, tiedWith: 1, skinsCents: null, moneyCents: m(-1500) },
    ],
    round: opts.round === undefined ? { id: 'round-1', eventRoundId: 'er-1', name: 'Round 1', status: 'in_progress' } : opts.round,
    scope: opts.round === null ? 'event' : 'round',
    computedAt: '2026-06-23T00:00:00.000Z',
    ...(f1 ? { f1 } : {}),
  };
}

/** Route fetch by URL: leaderboard vs per-player scorecard. */
function wireFetch(lb: Json, scByPlayer: Record<string, Json | number>) {
  (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
    if (url.includes('/leaderboard')) return RESPONSE(200, lb);
    const m = url.match(/\/rounds\/([^/]+)\/players\/([^/]+)\/scorecard/);
    if (m) {
      const sc = scByPlayer[m[2]!];
      if (typeof sc === 'number') return RESPONSE(sc, {}); // status code = error case
      if (!sc) return RESPONSE(404, {});
      return RESPONSE(200, sc);
    }
    return RESPONSE(404, {});
  });
}

describe('LeaderboardPage — expandable scorecard (Story 3-4)', () => {
  it('expands rows to render the scorecard grid; MULTI-open (each stays until closed)', async () => {
    wireFetch(leaderboard({ mode: 'money' }), {
      p1: scorecard([{ hole: 1, gross: 4, net: 4, moneyNet: 500 }]),
      p2: scorecard([{ hole: 1, gross: 5, net: 5, moneyNet: -500 }]),
    });
    render('evt1', 'p1');
    await waitFor(() => expect(screen.getByTestId('expand-p1')).toBeInTheDocument());

    const toggle1 = screen.getByTestId('expand-p1');
    expect(toggle1).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle1);
    expect(toggle1).toHaveAttribute('aria-expanded', 'true');
    // The ScorecardGrid rendered (its Front-9 region appears).
    await waitFor(() => expect(screen.getAllByLabelText('Front 9').length).toBeGreaterThan(0));

    // MULTI-open (Wolf-style): opening p2 keeps p1 open.
    await userEvent.click(screen.getByTestId('expand-p2'));
    expect(screen.getByTestId('expand-p2')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('expand-p1')).toHaveAttribute('aria-expanded', 'true');

    // Closing p1 leaves p2 open (independent).
    await userEvent.click(toggle1);
    expect(screen.getByTestId('expand-p1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('expand-p2')).toHaveAttribute('aria-expanded', 'true');
  });

  it('row shows Wolf-style To-Par + $ columns (net-to-par signed/colored; money cents→$)', async () => {
    wireFetch(leaderboard({ mode: 'money' }), {});
    render('evt1');
    await waitFor(() => expect(screen.getByText('Steve')).toBeInTheDocument());
    // p1: netToPar -2 → "-2"; moneyCents 1500 → "+$15". p2: +1 → "+1"; -1500 → "-$15".
    expect(screen.getByText('-2')).toBeInTheDocument();
    expect(screen.getByText('+$15')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('-$15')).toBeInTheDocument();
    // HI · CH · thru sub-line under the name (CH = pinned course handicap).
    expect(screen.getByText(/HI 8\.0 · CH 8 · Thru 3/)).toBeInTheDocument();
  });

  it('row $ column is suppressed (—) when money is not exposed (scores-only)', async () => {
    wireFetch(leaderboard({ mode: 'scores_only' }), {});
    render('evt1');
    await waitFor(() => expect(screen.getByText('Steve')).toBeInTheDocument());
    // moneyCents null on every row → no dollar figures in the $ column.
    expect(screen.queryByText('+$15')).not.toBeInTheDocument();
    expect(screen.queryByText('-$15')).not.toBeInTheDocument();
    // To Par still shows (it's not money-gated).
    expect(screen.getByText('-2')).toBeInTheDocument();
  });

  it('fetches the scorecard with the runtime round.id (not eventRoundId)', async () => {
    wireFetch(leaderboard({ mode: 'money' }), { p1: scorecard([{ hole: 1, gross: 4, net: 4, moneyNet: 500 }]) });
    render('evt1');
    await waitFor(() => expect(screen.getByTestId('expand-p1')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('expand-p1'));
    await waitFor(() => {
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes('/api/rounds/round-1/players/p1/scorecard'))).toBe(true);
      // never the eventRoundId
      expect(calls.some((u) => u.includes('/api/rounds/er-1/'))).toBe(false);
    });
  });

  it('cents→dollars on played holes: 500→+$5, -2000→-$20, 0→0, null→—', async () => {
    wireFetch(leaderboard({ mode: 'money' }), {
      p1: scorecard([
        { hole: 1, gross: 4, net: 4, moneyNet: 500 },
        { hole: 2, gross: 5, net: 5, moneyNet: -2000 },
        { hole: 3, gross: 4, net: 4, moneyNet: 0 },
        { hole: 4, gross: 4, net: 4, moneyNet: null },
      ]),
    });
    render('evt1');
    await waitFor(() => expect(screen.getByTestId('expand-p1')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('expand-p1'));
    const front = await screen.findByLabelText('Front 9');
    expect(within(front).getByText('+$5')).toBeInTheDocument();
    expect(within(front).getByText('-$20')).toBeInTheDocument();
    // 0 (settled push, played) renders '0'; null (played, money unknown) renders '—'.
    expect(within(front).getAllByText('0').length).toBeGreaterThan(0);
    expect(within(front).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('showMoney gating: no $ values when the event is scores-only', async () => {
    wireFetch(leaderboard({ mode: 'scores_only' }), {
      p1: scorecard([{ hole: 1, gross: 4, net: 4, moneyNet: 500 }]),
    });
    render('evt1');
    await waitFor(() => expect(screen.getByTestId('expand-p1')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('expand-p1'));
    await screen.findByLabelText('Front 9');
    // The $ row is hidden → no +$5 even though the mock supplied money.
    expect(screen.queryByText('+$5')).not.toBeInTheDocument();
  });

  it('inline "unavailable" when the scorecard 404s; the board does not crash', async () => {
    wireFetch(leaderboard({ mode: 'money' }), { p1: 404 });
    render('evt1');
    await waitFor(() => expect(screen.getByTestId('expand-p1')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('expand-p1'));
    await waitFor(() => expect(screen.getByTestId('scorecard-unavailable')).toBeInTheDocument());
    // The other row is still there (board intact).
    expect(screen.getByTestId('expand-p2')).toBeInTheDocument();
  });

  it('event scope (no round.id): rows are not expandable', async () => {
    wireFetch(leaderboard({ mode: 'money', round: null }), {});
    render('evt1');
    await waitFor(() => expect(screen.getByText('Steve')).toBeInTheDocument());
    expect(screen.queryByTestId('expand-p1')).not.toBeInTheDocument();
  });

  it('event scope is non-expandable even if a round object is present (defensive scope gate)', async () => {
    const lb = leaderboard({ mode: 'money' });
    lb['scope'] = 'event'; // contrived: scope event but round still set — must NOT expand
    wireFetch(lb, { p1: scorecard([{ hole: 1, gross: 4, net: 4, moneyNet: 500 }]) });
    render('evt1');
    await waitFor(() => expect(screen.getByText('Steve')).toBeInTheDocument());
    expect(screen.queryByTestId('expand-p1')).not.toBeInTheDocument();
  });

  it('does not fetch any scorecard until a row is expanded (lazy)', async () => {
    wireFetch(leaderboard({ mode: 'money' }), { p1: scorecard([{ hole: 1, gross: 4, net: 4, moneyNet: 500 }]) });
    render('evt1');
    await waitFor(() => expect(screen.getByTestId('expand-p1')).toBeInTheDocument());
    const scorecardCalls = () =>
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/scorecard'));
    expect(scorecardCalls()).toHaveLength(0); // nothing fetched before expand
    await userEvent.click(screen.getByTestId('expand-p1'));
    await waitFor(() => expect(scorecardCalls().length).toBeGreaterThan(0));
  });

  it('money mode but moneyEnabled=false: no $ values (gate is mode && moneyEnabled)', async () => {
    wireFetch(leaderboard({ mode: 'money', moneyEnabled: false }), {
      p1: scorecard([{ hole: 1, gross: 4, net: 4, moneyNet: 500 }]),
    });
    render('evt1');
    await waitFor(() => expect(screen.getByTestId('expand-p1')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('expand-p1'));
    await screen.findByLabelText('Front 9');
    expect(screen.queryByText('+$5')).not.toBeInTheDocument();
  });

  it('backlog #8: the leaderboard table uses table-layout:fixed so an expanded wide scorecard cannot widen the table', async () => {
    wireFetch(leaderboard({ mode: 'money' }), { p1: scorecard([{ hole: 1, gross: 4, net: 4, moneyNet: 500 }]) });
    render('evt1');
    await waitFor(() => expect(screen.getByTestId('expand-p1')).toBeInTheDocument());
    // The "To Par" header sits inside the leaderboard table; walk up to the table.
    const table = screen.getByText('To Par').closest('table');
    expect(table).not.toBeNull();
    // Fixed layout is the lever that confines the expanded colSpan scorecard to its
    // own nested scroll region instead of forcing the outer table (and the
    // collapsed To-Par/$ columns) wider than the viewport.
    expect(table).toHaveStyle({ tableLayout: 'fixed' });
    // Sanity: it still spans the full width.
    expect(table).toHaveStyle({ width: '100%' });
  });

  it('switching scope clears an open scorecard (no auto-reopen)', async () => {
    wireFetch(leaderboard({ mode: 'money' }), { p1: scorecard([{ hole: 1, gross: 4, net: 4, moneyNet: 500 }]) });
    render('evt1');
    await waitFor(() => expect(screen.getByTestId('expand-p1')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('expand-p1'));
    expect(screen.getByTestId('expand-p1')).toHaveAttribute('aria-expanded', 'true');
    // Toggle to "All rounds" — the previously-open row must reset to collapsed.
    await userEvent.click(screen.getByTestId('scope-event'));
    await waitFor(() => expect(screen.getByTestId('expand-p1')).toHaveAttribute('aria-expanded', 'false'));
  });
});

describe('LeaderboardPage — client-side sort (Josh 2026-06-26)', () => {
  // Rows arrive in the API's GROSS order (pA first), but pA has the WORSE net.
  // Default sort is Net, so the better-net player (pB) must lead; switching to
  // Gross flips it back. Money chip is absent without money mode.
  const crossedOrder: Json = {
    rows: [
      { playerId: 'pA', playerName: 'Albert', handicapIndex: 0, courseHandicap: 0, grossThroughHole: 10, netThroughHole: 10, netToPar: 3, throughHole: 3, rank: 1, tiedWith: 1, skinsCents: null, moneyCents: null },
      { playerId: 'pB', playerName: 'Bob', handicapIndex: 12, courseHandicap: 12, grossThroughHole: 20, netThroughHole: 8, netToPar: -3, throughHole: 3, rank: 2, tiedWith: 1, skinsCents: null, moneyCents: null },
    ],
    round: { id: 'round-1', eventRoundId: 'er-1', name: 'Round 1', status: 'in_progress' },
    scope: 'round',
    computedAt: '2026-06-23T00:00:00.000Z',
  };

  const rowOrder = () =>
    screen.getAllByTestId(/^expand-/).map((el) => el.getAttribute('data-testid'));

  it('defaults to Net (best individual first) and re-sorts by Gross on demand', async () => {
    wireFetch(crossedOrder, {});
    render('evt1');
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());
    // Default = Net: Bob (-3) ahead of Albert (+3), despite the API's gross order.
    expect(rowOrder()).toEqual(['expand-pB', 'expand-pA']);
    // No money mode → no Money chip; Net + Gross present.
    expect(screen.queryByTestId('sort-money')).toBeNull();
    expect(screen.getByTestId('sort-net')).toBeInTheDocument();
    expect(screen.getByTestId('sort-gross')).toBeInTheDocument();
    // Switch to Gross → Albert (10) leads Bob (20).
    await userEvent.click(screen.getByTestId('sort-gross'));
    expect(rowOrder()).toEqual(['expand-pA', 'expand-pB']);
  });

  it('offers a Money sort only when the $ column is live, and sorts by it desc', async () => {
    // Money mode on: pA loses $20, pB wins $20 — Money sort puts the winner first.
    const withMoney: Json = {
      ...crossedOrder,
      rows: [
        { ...(crossedOrder.rows as Json[])[0]!, moneyCents: -2000 },
        { ...(crossedOrder.rows as Json[])[1]!, moneyCents: 2000 },
      ],
      f1: { lockState: 'locked', mode: 'money', moneyEnabled: true },
    };
    wireFetch(withMoney, {});
    render('evt1');
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());
    expect(screen.getByTestId('sort-money')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('sort-money'));
    // Bob (+$20) ahead of Albert (-$20).
    expect(rowOrder()).toEqual(['expand-pB', 'expand-pA']);
  });
});
