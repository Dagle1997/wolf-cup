import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { StartRoundPage } from './admin.events.$eventId.start-round';

const ORG_ID = 'org-1';

const STARTABLE = {
  rounds: [
    {
      eventRoundId: 'er-1',
      roundNumber: 1,
      pairings: [
        {
          foursomeNumber: 1,
          locked: true,
          members: [
            { playerId: 'p-a', name: 'Alpha' },
            { playerId: 'p-b', name: 'Bravo' },
          ],
        },
      ],
    },
  ],
};

const UNLOCKED = {
  rounds: [
    {
      eventRoundId: 'er-1',
      roundNumber: 1,
      pairings: [{ foursomeNumber: 1, locked: false, members: [{ playerId: 'p-a', name: 'Alpha' }] }],
    },
  ],
};

function renderPage(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$eventId/start-round',
    component: () => <>{node}</>,
  });
  const stubs = [
    '/admin/events/$eventId',
    '/admin/events/$eventId/pairings',
    '/admin/events/$eventId/game-config',
    '/rounds/$roundId/score-entry',
  ].map((p) =>
    createRoute({ getParentRoute: () => rootRoute, path: p, component: () => <div>stub {p}</div> }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, ...stubs]),
    history: createMemoryHistory({ initialEntries: ['/admin/events/evt-1/start-round'] }),
  });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const POLICY = { policy: 'foursome', designatedPlayerIds: [], roster: [] };

/**
 * URL-aware fetch mock: the page fetches BOTH /pairings and /scorer-policy on
 * mount (order not guaranteed) and /start on click — so a flat `mockResolvedValue`
 * or ordered `…Once` chain races. Route by URL instead.
 */
function setFetch(pairings: unknown, startStatus = 201): void {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/scorer-policy')) {
      return new Response(JSON.stringify(POLICY), { status: 200, headers: JSON_HEADERS });
    }
    if (url.includes('/start')) {
      return new Response(JSON.stringify({ roundId: 'round-1' }), { status: startStatus, headers: JSON_HEADERS });
    }
    return new Response(JSON.stringify(pairings), { status: 200, headers: JSON_HEADERS });
  });
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe('StartRoundPage', () => {
  it('renders a scorer picker per foursome for a locked round', async () => {
    setFetch(STARTABLE);
    renderPage(<StartRoundPage eventId="evt-1" organizerId={ORG_ID} />);
    await waitFor(() => expect(screen.getByTestId('scorer-er-1:1')).toBeInTheDocument());
    expect(screen.getByTestId('start-btn-er-1')).toBeInTheDocument();
    // Picker offers the organizer + the foursome members.
    expect(screen.getByText('You (organizer)')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Bravo')).toBeInTheDocument();
  });

  it('Start posts the designated scorers (defaults to the organizer)', async () => {
    setFetch(STARTABLE, 201);
    renderPage(<StartRoundPage eventId="evt-1" organizerId={ORG_ID} />);
    await waitFor(() => expect(screen.getByTestId('start-btn-er-1')).toBeInTheDocument());
    // Start is a one-way action → a confirm step gates the POST.
    fireEvent.click(screen.getByTestId('start-btn-er-1'));
    await waitFor(() => expect(screen.getByTestId('confirm-start-er-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-start-er-1'));
    await waitFor(() => {
      const startCall = vi.mocked(fetch).mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/event-rounds/er-1/start'),
      );
      expect(startCall).toBeTruthy();
      const body = JSON.parse((startCall![1] as RequestInit).body as string);
      expect(body.scorers).toEqual([{ foursomeNumber: 1, scorerPlayerId: ORG_ID }]);
    });
  });

  it('shows an empty state when no round has all-locked pairings', async () => {
    setFetch(UNLOCKED);
    renderPage(<StartRoundPage eventId="evt-1" organizerId={ORG_ID} />);
    await waitFor(() => expect(screen.getByText(/No round is ready to start/i)).toBeInTheDocument());
  });

  it('422 no_game_config → scores-only prompt; "Start scores-only" re-posts with confirmNoGame', async () => {
    // First /start (no confirm) → 422 no_game_config; a confirmNoGame start → 201.
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/scorer-policy')) {
        return new Response(JSON.stringify(POLICY), { status: 200, headers: JSON_HEADERS });
      }
      if (url.includes('/start')) {
        const body = JSON.parse((init as RequestInit).body as string) as { confirmNoGame?: boolean };
        return body.confirmNoGame === true
          ? new Response(JSON.stringify({ roundId: 'round-1' }), { status: 201, headers: JSON_HEADERS })
          : new Response(JSON.stringify({ code: 'no_game_config' }), { status: 422, headers: JSON_HEADERS });
      }
      return new Response(JSON.stringify(STARTABLE), { status: 200, headers: JSON_HEADERS });
    });
    renderPage(<StartRoundPage eventId="evt-1" organizerId={ORG_ID} />);
    await waitFor(() => expect(screen.getByTestId('start-btn-er-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('start-btn-er-1'));
    await waitFor(() => expect(screen.getByTestId('confirm-start-er-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-start-er-1'));
    // The guard surfaces the scores-only prompt (with a Rules & Games link).
    await waitFor(() => expect(screen.getByTestId('no-game-prompt-er-1')).toBeInTheDocument());
    expect(screen.getByTestId('go-game-config-er-1')).toBeInTheDocument();
    // The first start carried NO confirmNoGame flag.
    const firstStart = vi.mocked(fetch).mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('/start'),
    );
    expect(JSON.parse((firstStart![1] as RequestInit).body as string).confirmNoGame).toBeUndefined();
    // Tapping "Start scores-only" re-posts WITH confirmNoGame:true.
    fireEvent.click(screen.getByTestId('start-scores-only-er-1'));
    await waitFor(() => {
      const confirmed = vi.mocked(fetch).mock.calls.find((c) => {
        if (typeof c[0] !== 'string' || !c[0].includes('/start')) return false;
        return JSON.parse((c[1] as RequestInit).body as string).confirmNoGame === true;
      });
      expect(confirmed).toBeTruthy();
    });
  });

  it('422 no_claim_modifiers → bonuses prompt; "Start without bonuses" re-posts with confirmNoModifiers', async () => {
    // First /start (no confirm) → 422 no_claim_modifiers; confirmNoModifiers → 201.
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/scorer-policy')) {
        return new Response(JSON.stringify(POLICY), { status: 200, headers: JSON_HEADERS });
      }
      if (url.includes('/start')) {
        const body = JSON.parse((init as RequestInit).body as string) as { confirmNoModifiers?: boolean };
        return body.confirmNoModifiers === true
          ? new Response(JSON.stringify({ roundId: 'round-1' }), { status: 201, headers: JSON_HEADERS })
          : new Response(JSON.stringify({ code: 'no_claim_modifiers' }), { status: 422, headers: JSON_HEADERS });
      }
      return new Response(JSON.stringify(STARTABLE), { status: 200, headers: JSON_HEADERS });
    });
    renderPage(<StartRoundPage eventId="evt-1" organizerId={ORG_ID} />);
    await waitFor(() => expect(screen.getByTestId('start-btn-er-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('start-btn-er-1'));
    await waitFor(() => expect(screen.getByTestId('confirm-start-er-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('confirm-start-er-1'));
    // The guard surfaces the no-bonuses prompt with rules links.
    await waitFor(() => expect(screen.getByTestId('no-modifiers-prompt-er-1')).toBeInTheDocument());
    expect(screen.getByTestId('go-game-config-modifiers-er-1')).toBeInTheDocument();
    expect(screen.getByTestId('go-foursome-rules-er-1')).toBeInTheDocument();
    // First start carried NO confirmNoModifiers flag.
    const firstStart = vi.mocked(fetch).mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('/start'),
    );
    expect(JSON.parse((firstStart![1] as RequestInit).body as string).confirmNoModifiers).toBeUndefined();
    // Tapping "Start without bonuses" re-posts WITH confirmNoModifiers:true.
    fireEvent.click(screen.getByTestId('start-without-bonuses-er-1'));
    await waitFor(() => {
      const confirmed = vi.mocked(fetch).mock.calls.find((c) => {
        if (typeof c[0] !== 'string' || !c[0].includes('/start')) return false;
        return JSON.parse((c[1] as RequestInit).body as string).confirmNoModifiers === true;
      });
      expect(confirmed).toBeTruthy();
    });
  });
});
