/**
 * Story 1.4 admin bets page — void flow.
 *
 * Renders AdminBetsPage directly (bypasses the auth loader), mocks the pairings
 * + bets fetches, and asserts the two-step-confirm Void button posts to the
 * void endpoint and the row flips to the voided state after refetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInRouter } from '../test-utils/render-in-router';
import { AdminBetsPage } from './admin.events.$eventId.bets';

function renderPage(eventId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return renderInRouter(
    <QueryClientProvider client={qc}>
      <AdminBetsPage eventId={eventId} />
    </QueryClientProvider>,
  );
}

const PAIRINGS = {
  rounds: [{ eventRoundId: 'er-1', roundNumber: 1 }],
  roster: [
    { playerId: 'pA', name: 'Rick' },
    { playerId: 'pB', name: 'Ben' },
  ],
};

function betPayload(state: string, stakeCents = 2000) {
  return {
    bets: [
      {
        betId: 'bet-1',
        eventRoundId: 'er-1',
        betType: 'h2h',
        basis: 'net',
        holeScope: 'full18',
        stakeCents,
        state,
        winnerSubjectId: state === 'settled' ? 'pA' : null,
        marginNet: 1,
        sides: [
          { side: 'A', stakeholderPlayerId: 'pA', stakeholderName: 'Rick', subjectPlayerId: 'pA', subjectName: 'Rick', subjectNetTotal: 72 },
          { side: 'B', stakeholderPlayerId: 'pB', stakeholderName: 'Ben', subjectPlayerId: 'pB', subjectName: 'Ben', subjectNetTotal: 73 },
        ],
      },
    ],
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AdminBetsPage — Story 1.4 void', () => {
  it('two-step-confirm Void posts to the void endpoint and the row flips to Void', async () => {
    let voided = false;
    let voidPosts = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/pairings')) return json(PAIRINGS);
      if (url.includes('/void') && method === 'POST') {
        voidPosts += 1;
        voided = true;
        return json({ ok: true });
      }
      if (url.endsWith('/bets')) return json(betPayload(voided ? 'void' : 'settled'));
      return json({}, 404);
    });

    const user = userEvent.setup();
    renderPage('evt-1');

    // Settled bet renders with a Void button (no confirm shown yet).
    await waitFor(() => expect(screen.getByTestId('bet-state-bet-1')).toHaveTextContent('Settled'));
    expect(screen.queryByTestId('confirm-void-bet-1')).not.toBeInTheDocument();

    // First click arms the confirm; nothing posted yet (two-step guard).
    await user.click(screen.getByTestId('void-bet-1'));
    expect(screen.getByTestId('confirm-void-bet-1')).toBeInTheDocument();
    expect(voidPosts).toBe(0);

    // Confirm posts once and the row refetches to the voided state.
    await user.click(screen.getByTestId('confirm-void-bet-1'));
    await waitFor(() => expect(screen.getByTestId('bet-state-bet-1')).toHaveTextContent('Void'));
    expect(voidPosts).toBe(1);
    // A voided bet exposes no further action.
    expect(screen.queryByTestId('void-bet-1')).not.toBeInTheDocument();
  });

  it('Edit loads the bet into the form; a confirmed change PATCHes the new (whole-dollar) stake', async () => {
    let patched: { stakeCents: number } | null = null;
    let stake = 2000;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/pairings')) return json(PAIRINGS);
      if (method === 'PATCH' && /\/bets\/bet-1$/.test(url)) {
        patched = JSON.parse(String(init?.body)) as { stakeCents: number };
        stake = patched.stakeCents;
        return json({ ok: true });
      }
      if (url.endsWith('/bets')) return json(betPayload('settled', stake));
      return json({}, 404);
    });

    const user = userEvent.setup();
    renderPage('evt-1');

    // Click Edit → form populates from the bet ($20.00 → "20") and edit mode shows.
    await user.click(await screen.findByTestId('edit-bet-1'));
    expect(screen.getByTestId('editing-banner')).toBeInTheDocument();
    expect(screen.getByTestId('stake-input')).toHaveValue(20);
    expect(screen.queryByTestId('create-bet-btn')).not.toBeInTheDocument();

    // Change stake to $30 and Save → warning + confirm appear; nothing PATCHed yet.
    const stakeInput = screen.getByTestId('stake-input');
    await user.clear(stakeInput);
    await user.type(stakeInput, '30');
    await user.click(screen.getByTestId('save-edit-btn'));
    expect(screen.getByTestId('edit-warning')).toBeInTheDocument();
    expect(patched).toBeNull();

    // Confirm → PATCH posts whole-dollar cents and edit mode exits.
    await user.click(screen.getByTestId('confirm-edit-btn'));
    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched!.stakeCents).toBe(3000);
    await waitFor(() => expect(screen.queryByTestId('editing-banner')).not.toBeInTheDocument());
  });

  it('a fractional-dollar stake disables Save in edit mode (whole dollars only)', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/pairings')) return json(PAIRINGS);
      if (url.endsWith('/bets')) return json(betPayload('settled'));
      return json({}, 404);
    });

    const user = userEvent.setup();
    renderPage('evt-1');
    await user.click(await screen.findByTestId('edit-bet-1'));

    const stakeInput = screen.getByTestId('stake-input');
    await user.clear(stakeInput);
    await user.type(stakeInput, '25.5');
    expect(screen.getByTestId('save-edit-btn')).toBeDisabled();
  });

  it('Cancel dismisses the confirm without posting', async () => {
    let voidPosts = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/pairings')) return json(PAIRINGS);
      if (url.includes('/void') && method === 'POST') {
        voidPosts += 1;
        return json({ ok: true });
      }
      if (url.endsWith('/bets')) return json(betPayload('settled'));
      return json({}, 404);
    });

    const user = userEvent.setup();
    renderPage('evt-1');
    await waitFor(() => expect(screen.getByTestId('void-bet-1')).toBeInTheDocument());

    await user.click(screen.getByTestId('void-bet-1'));
    await user.click(screen.getByTestId('cancel-void-bet-1'));
    expect(screen.queryByTestId('confirm-void-bet-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('void-bet-1')).toBeInTheDocument();
    expect(voidPosts).toBe(0);
  });
});
