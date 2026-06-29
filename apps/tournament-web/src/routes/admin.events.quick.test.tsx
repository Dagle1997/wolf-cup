import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';

import { QuickEventPage } from './admin.events.quick';

vi.mock('../hooks/use-auth-session', () => ({
  useAuthSession: () => ({ player: { id: 'org-1', isOrganizer: true }, device: null, isLoading: false }),
}));

const JSON_HEADERS = { 'content-type': 'application/json' };

const COURSES = {
  courses: [
    {
      id: 'course-1',
      name: 'Pete Dye',
      clubName: 'Guyan',
      latestRevision: { id: 'rev-1', tees: [{ color: 'Blue', rating: 723, slope: 130 }] },
    },
  ],
};

// Captures every non-GET call body for assertions.
const calls: Array<{ url: string; method: string; body: unknown }> = [];

function setFetch(): void {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    if (method !== 'GET') calls.push({ url, method, body });

    if (url.includes('/api/courses')) {
      return new Response(JSON.stringify(COURSES), { status: 200, headers: JSON_HEADERS });
    }
    if (url.includes('/api/players/search')) {
      return new Response(
        JSON.stringify({
          results: [
            { ghinNumber: 1234567, firstName: 'Dave', lastName: 'Miller', handicapIndex: 8.4, club: 'Guyan G&CC', state: 'WV' },
          ],
        }),
        { status: 200, headers: JSON_HEADERS },
      );
    }
    if (url.includes('/admin-context')) {
      return new Response(
        JSON.stringify({ groups: [{ id: 'group-1' }], eventRounds: [{ id: 'er-1' }] }),
        { status: 200, headers: JSON_HEADERS },
      );
    }
    if (url.endsWith('/api/admin/events') && method === 'POST') {
      return new Response(JSON.stringify({ eventId: 'evt-1', inviteToken: 'tok' }), { status: 201, headers: JSON_HEADERS });
    }
    if (url.includes('/members') && method === 'POST') {
      // A distinct player id per add, derived from the call count.
      const id = `player-${calls.filter((c) => c.url.includes('/members')).length}`;
      return new Response(JSON.stringify({ player: { id } }), { status: 201, headers: JSON_HEADERS });
    }
    if (url.includes('/start') && method === 'POST') {
      return new Response(JSON.stringify({ roundId: 'round-1' }), { status: 201, headers: JSON_HEADERS });
    }
    // scorer-policy, game-config, sub-games, pairings → generic ok.
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
  });
}

function renderWizard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/quick',
    component: QuickEventPage,
  });
  const stubs = ['/', '/rounds/$roundId/score-entry'].map((p) =>
    createRoute({ getParentRoute: () => rootRoute, path: p, component: () => <div>stub {p}</div> }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute, ...stubs]),
    history: createMemoryHistory({ initialEntries: ['/admin/events/quick'] }),
  });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn());
  setFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe('QuickEventPage', () => {
  it('orchestrates create→roster→rules→pairings→start and navigates to score entry', async () => {
    renderWizard();

    // Step 1 — course + tee.
    await waitFor(() => expect(screen.getByTestId('quick-course')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('quick-course'), { target: { value: 'rev-1' } });
    await waitFor(() => expect(screen.getByTestId('quick-tee')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('quick-tee'), { target: { value: 'Blue' } });
    fireEvent.click(screen.getByTestId('quick-next-1'));

    // Step 2 — 4 players (default count) with names.
    await waitFor(() => expect(screen.getByTestId('quick-step-players')).toBeInTheDocument());
    for (let i = 0; i < 4; i++) {
      fireEvent.change(screen.getByTestId(`quick-player-name-${i}`), { target: { value: `P${i + 1}` } });
    }
    fireEvent.click(screen.getByTestId('quick-next-2'));

    // Step 3 — arrange (defaults to one group of 4).
    await waitFor(() => expect(screen.getByTestId('quick-step-arrange')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('quick-next-3'));

    // Step 4 — rules (Guyan on by default) + snake on, then start.
    await waitFor(() => expect(screen.getByTestId('quick-step-rules')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('quick-snake-toggle'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('quick-start'));
    });

    // Navigated to the score-entry stub.
    await waitFor(() => expect(screen.getByText('stub /rounds/$roundId/score-entry')).toBeInTheDocument());

    // Event created with one round on the selected course/tee.
    const createCall = calls.find((c) => c.url.endsWith('/api/admin/events') && c.method === 'POST');
    expect(createCall).toBeTruthy();
    const createBody = createCall!.body as { rounds: Array<{ course_revision_id: string; tee_color: string; holes_to_play: number }> };
    expect(createBody.rounds[0]!.course_revision_id).toBe('rev-1');
    expect(createBody.rounds[0]!.tee_color).toBe('Blue');

    // 4 roster members added.
    expect(calls.filter((c) => c.url.includes('/members') && c.method === 'POST').length).toBe(4);

    // Scoring set to open policy.
    const policyCall = calls.find((c) => c.url.includes('/scorer-policy'));
    expect((policyCall!.body as { policy: string }).policy).toBe('open');

    // Snake sub-game requested.
    const subGamesCall = calls.find((c) => c.url.includes('/sub-games'));
    expect((subGamesCall!.body as { subGames: Array<{ type: string }> }).subGames.some((s) => s.type === 'snake')).toBe(true);

    // Pairings locked.
    const pairingsCall = calls.find((c) => c.url.includes('/pairings'));
    const pairingsBody = pairingsCall!.body as { rounds: Array<{ pairings: Array<{ locked: boolean; memberPlayerIds: string[] }> }> };
    expect(pairingsBody.rounds[0]!.pairings[0]!.locked).toBe(true);
    expect(pairingsBody.rounds[0]!.pairings[0]!.memberPlayerIds.length).toBe(4);

    // Start carried a scorer + confirmNoModifiers.
    const startCall = calls.find((c) => c.url.includes('/start'));
    const startBody = startCall!.body as { scorers: Array<{ scorerPlayerId: string }>; confirmNoModifiers: boolean };
    expect(startBody.scorers[0]!.scorerPlayerId).toBe('org-1');
    // Guyan on with bonuses on → no need to confirm "no modifiers".
    expect(startBody.confirmNoModifiers).toBe(false);
  });

  it('adds a GHIN-searched player by GHIN mode (live handicap, no manual index)', async () => {
    renderWizard();

    // Step 1 — course + tee.
    await waitFor(() => expect(screen.getByTestId('quick-course')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('quick-course'), { target: { value: 'rev-1' } });
    await waitFor(() => expect(screen.getByTestId('quick-tee')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('quick-tee'), { target: { value: 'Blue' } });
    fireEvent.click(screen.getByTestId('quick-next-1'));

    // Step 2 — search GHIN, add the match, then trim the blank manual rows.
    await waitFor(() => expect(screen.getByTestId('quick-step-players')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('quick-ghin-last'), { target: { value: 'Miller' } });
    fireEvent.click(screen.getByTestId('quick-ghin-search'));
    await waitFor(() => expect(screen.getByTestId('quick-ghin-add-1234567')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('quick-ghin-add-1234567'));
    // Drop the 4 default blank manual rows so only the GHIN player remains.
    fireEvent.change(screen.getByTestId('quick-num-players'), { target: { value: '1' } });

    fireEvent.click(screen.getByTestId('quick-next-2'));
    await waitFor(() => expect(screen.getByTestId('quick-step-arrange')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('quick-next-3'));
    await waitFor(() => expect(screen.getByTestId('quick-step-rules')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByTestId('quick-start')); });
    await waitFor(() => expect(screen.getByText('stub /rounds/$roundId/score-entry')).toBeInTheDocument());

    // Exactly one roster add, and it used GHIN mode (no manualHandicapIndex).
    const memberCalls = calls.filter((c) => c.url.includes('/members') && c.method === 'POST');
    expect(memberCalls.length).toBe(1);
    const body = memberCalls[0]!.body as { mode: string; ghin: number; firstName: string; lastName: string; manualHandicapIndex?: number };
    expect(body.mode).toBe('ghin');
    expect(body.ghin).toBe(1234567);
    expect(body.firstName).toBe('Dave');
    expect(body.lastName).toBe('Miller');
    expect(body.manualHandicapIndex).toBeUndefined();
  });

  it('scores-only (Guyan off) confirms no_game_config and skips game-config', async () => {
    renderWizard();
    await waitFor(() => expect(screen.getByTestId('quick-course')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('quick-course'), { target: { value: 'rev-1' } });
    await waitFor(() => expect(screen.getByTestId('quick-tee')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('quick-tee'), { target: { value: 'Blue' } });
    fireEvent.click(screen.getByTestId('quick-next-1'));
    await waitFor(() => expect(screen.getByTestId('quick-step-players')).toBeInTheDocument());
    for (let i = 0; i < 4; i++) {
      fireEvent.change(screen.getByTestId(`quick-player-name-${i}`), { target: { value: `P${i + 1}` } });
    }
    fireEvent.click(screen.getByTestId('quick-next-2'));
    await waitFor(() => expect(screen.getByTestId('quick-step-arrange')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('quick-next-3'));
    await waitFor(() => expect(screen.getByTestId('quick-step-rules')).toBeInTheDocument());
    // Turn Guyan OFF → scores-only.
    fireEvent.click(screen.getByTestId('quick-guyan-toggle'));
    await act(async () => { fireEvent.click(screen.getByTestId('quick-start')); });

    await waitFor(() => expect(screen.getByText('stub /rounds/$roundId/score-entry')).toBeInTheDocument());
    // No game-config PUT was sent.
    expect(calls.find((c) => c.url.includes('/game-config'))).toBeUndefined();
    // Start carried confirmNoGame.
    const startBody = calls.find((c) => c.url.includes('/start'))!.body as { confirmNoGame: boolean };
    expect(startBody.confirmNoGame).toBe(true);
  });

  it('blocks Start on a non-whole-dollar point value (no silent coercion)', async () => {
    renderWizard();
    await waitFor(() => expect(screen.getByTestId('quick-course')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('quick-course'), { target: { value: 'rev-1' } });
    await waitFor(() => expect(screen.getByTestId('quick-tee')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('quick-tee'), { target: { value: 'Blue' } });
    fireEvent.click(screen.getByTestId('quick-next-1'));
    await waitFor(() => expect(screen.getByTestId('quick-step-players')).toBeInTheDocument());
    for (let i = 0; i < 4; i++) {
      fireEvent.change(screen.getByTestId(`quick-player-name-${i}`), { target: { value: `P${i + 1}` } });
    }
    fireEvent.click(screen.getByTestId('quick-next-2'));
    await waitFor(() => expect(screen.getByTestId('quick-step-arrange')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('quick-next-3'));
    await waitFor(() => expect(screen.getByTestId('quick-step-rules')).toBeInTheDocument());

    // A decimal point value is invalid (engine requires whole dollars).
    fireEvent.change(screen.getByTestId('quick-point-value'), { target: { value: '2.5' } });
    expect(screen.getByTestId('quick-point-error')).toBeInTheDocument();
    expect((screen.getByTestId('quick-start') as HTMLButtonElement).disabled).toBe(true);

    // A whole-dollar value clears the gate.
    fireEvent.change(screen.getByTestId('quick-point-value'), { target: { value: '10' } });
    expect(screen.queryByTestId('quick-point-error')).toBeNull();
    expect((screen.getByTestId('quick-start') as HTMLButtonElement).disabled).toBe(false);
  });
});
