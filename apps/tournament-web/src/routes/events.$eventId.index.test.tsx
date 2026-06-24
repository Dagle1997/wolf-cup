/**
 * T7-1 Event home page smoke tests.
 *
 * Renders EventHomePage directly (bypasses TanStack Router's auth loader).
 * Mocks fetch with a minimal event + 3 rounds payload and asserts:
 *  - Event name + greeting + 4 entry cards render
 *  - Forbidden state on 403
 *  - Countdown text varies with pinned `nowMs`
 *  - Date range omits year when start+end share year
 *  - Date range uses event timezone (not viewer's local)
 *
 * Uses `nowMs` prop to pin time deterministically (no global clock mock).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';

import { EventHomePage, computeCountdown } from './events.$eventId.index';

// T8-3: EventHomePage embeds <ActivityFeed/> which reads useActivityFeed.
// In production __root.tsx wraps with ActivityFeedProvider; here we
// don't mount __root, so we mock the hook to return an empty stream.
// The empty rows produce the feed's empty-state card — sufficient to
// verify the feed surface is wired without testing its internals.
vi.mock('../hooks/use-activity-feed', () => ({
  useActivityFeed: () => ({
    rows: [],
    cursorBefore: null,
    loadMore: vi.fn(),
    isPolling: false,
    error: null,
  }),
  useActivityStream: () => undefined,
}));

// Same-year fixture: 2026-05-08 to 2026-05-10 in America/New_York.
const MAY_8_NY_MIDNIGHT = Date.UTC(2026, 4, 8, 4);   // 2026-05-08 00:00 NY = 04:00 UTC
const MAY_9_NY_MIDNIGHT = Date.UTC(2026, 4, 9, 4);
const MAY_10_NY_MIDNIGHT = Date.UTC(2026, 4, 10, 4);

const EVENT_FIXTURE = {
  event: {
    id: 'evt-1',
    name: 'Pinehurst 2026',
    startDate: MAY_8_NY_MIDNIGHT,
    endDate: MAY_10_NY_MIDNIGHT,
    timezone: 'America/New_York',
  },
  rounds: [
    { id: 'er-1', roundNumber: 1, roundDate: MAY_8_NY_MIDNIGHT, holesToPlay: 18 },
    { id: 'er-2', roundNumber: 2, roundDate: MAY_9_NY_MIDNIGHT, holesToPlay: 18 },
    { id: 'er-3', roundNumber: 3, roundDate: MAY_10_NY_MIDNIGHT, holesToPlay: 9 },
  ],
};

function renderWithRouter(props: {
  eventId: string;
  viewerName?: string;
  nowMs?: number;
  isOrganizer?: boolean;
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  // <Link> requires a Router context. Build a minimal in-memory router with
  // stub child routes for /events/$eventId/{leaderboard,money,bets,settle-up}.
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/events/$eventId',
    component: () => <EventHomePage {...props} />,
  });
  const childPaths = [
    '/events/$eventId/leaderboard',
    '/events/$eventId/money',
    '/events/$eventId/bets',
    '/events/$eventId/settle-up',
    '/events/$eventId/gallery',
    '/admin/events/$eventId',
    '/rounds/$roundId/score-entry',
  ] as const;
  const stubs = childPaths.map((p) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: p,
      component: () => <div>stub: {p}</div>,
    }),
  );
  const tree = rootRoute.addChildren([indexRoute, ...stubs]);
  const router = createRouter({
    routeTree: tree,
    history: createMemoryHistory({ initialEntries: [`/events/${props.eventId}`] }),
  });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EventHomePage', () => {
  it('renders event name + greeting + 5 entry cards (including Photo Gallery)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(EVENT_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithRouter({ eventId: 'evt-1', viewerName: 'Josh Stoll', nowMs: MAY_8_NY_MIDNIGHT - 3 * 86_400_000 });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Pinehurst 2026' })).toBeInTheDocument();
    });
    expect(screen.getByText(/You're in, Josh\./)).toBeInTheDocument();
    // Consolidated hubs: Standings (folds Leaderboard/Teams/Match) + a money card
    // (My Money when not in live-money mode) + Bets, Schedule, Photos.
    expect(screen.getByText('Standings')).toBeInTheDocument();
    expect(screen.getByText('My Money')).toBeInTheDocument();
    expect(screen.getByText('Bets')).toBeInTheDocument();
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    // T7-4 entry card.
    const galleryLink = screen.getByText('Photos').closest('a');
    expect(galleryLink).toBeInTheDocument();
    expect(galleryLink?.getAttribute('href')).toBe('/events/evt-1/gallery');
    // T8-3: ActivityFeed mounts below the entry cards. Mocked hook
    // returns empty rows → the feed renders its empty-state card.
    expect(screen.getByTestId('activity-feed-empty')).toBeInTheDocument();
  });

  it('prefers the API-supplied viewerName over the prop, and shows the live-round CTA', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...EVENT_FIXTURE,
          viewerName: 'Ronnie Adkins',
          liveRound: { roundId: 'rnd-9', eventRoundId: 'er-2', roundNumber: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    // Prop says "Josh" but the API says "Ronnie" — the API wins.
    renderWithRouter({ eventId: 'evt-1', viewerName: 'Josh Stoll', nowMs: MAY_8_NY_MIDNIGHT });
    await waitFor(() => {
      expect(screen.getByText(/You're in, Ronnie\./)).toBeInTheDocument();
    });
    const cta = screen.getByTestId('event-home-live-cta');
    expect(cta).toBeInTheDocument();
    expect(cta.getAttribute('href')).toBe('/rounds/rnd-9/score-entry');
    // The CTA itself carries the "Round 2 is live" label. (The hero status now
    // mirrors it too, so scope this assertion to the CTA to stay unambiguous.)
    expect(cta).toHaveTextContent(/Round 2 is live/);
  });

  it('hero shows the live state (not a future-date countdown) when liveRound is present but the round date is in the future', async () => {
    // Round 1 is in_progress (API returns liveRound) but its scheduled date is
    // 3 days out — organizer started it early. The hero must NOT read
    // "Round 1 starts in 3 days"; it must lead with the live state.
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...EVENT_FIXTURE,
          liveRound: { roundId: 'rnd-7', eventRoundId: 'er-1', roundNumber: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    renderWithRouter({ eventId: 'evt-1', nowMs: MAY_8_NY_MIDNIGHT - 3 * 86_400_000 });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Pinehurst 2026' })).toBeInTheDocument();
    });
    // Hero headline leads with live, not the misleading countdown.
    expect(screen.getByTestId('event-home-hero-status')).toHaveTextContent('Round 1 is live');
    expect(screen.queryByText(/starts in 3 days/)).toBeNull();
    // The live CTA is still present and unchanged.
    const cta = screen.getByTestId('event-home-live-cta');
    expect(cta.getAttribute('href')).toBe('/rounds/rnd-7/score-entry');
  });

  it('hero keeps the genuine pre-event countdown when there is NO liveRound', async () => {
    // No liveRound → the real future-date countdown must still show.
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(EVENT_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithRouter({ eventId: 'evt-1', nowMs: MAY_8_NY_MIDNIGHT - 3 * 86_400_000 });
    await waitFor(() => {
      expect(screen.getByText(/Round 1 starts in 3 days/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/is live/)).toBeNull();
  });

  it('shows the "Money" hub card (not "My Money") when moneyEnabled', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ ...EVENT_FIXTURE, moneyEnabled: true }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    renderWithRouter({ eventId: 'evt-1', viewerName: 'Josh Stoll', nowMs: MAY_8_NY_MIDNIGHT });
    await waitFor(() => {
      expect(screen.getByText('Standings')).toBeInTheDocument();
    });
    const moneyLink = screen.getByText('Money').closest('a');
    expect(moneyLink?.getAttribute('href')).toBe('/events/evt-1/money');
    // The private "My Money" card is replaced by the full Money hub.
    expect(screen.queryByText('My Money')).not.toBeInTheDocument();
  });

  it('no live-round CTA when liveRound is absent', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(EVENT_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithRouter({ eventId: 'evt-1', nowMs: MAY_8_NY_MIDNIGHT });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Pinehurst 2026' })).toBeInTheDocument();
    });
    expect(screen.queryByTestId('event-home-live-cta')).toBeNull();
  });

  it('renders forbidden state on 403', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{}', { status: 403 }),
    );
    renderWithRouter({ eventId: 'evt-1' });
    await waitFor(() => {
      expect(screen.getByText(/aren't a participant/i)).toBeInTheDocument();
    });
  });

  it('T13-1: organizer sees the "Manage event" admin link (now reachable once the API exempts the organizer)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(EVENT_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithRouter({ eventId: 'evt-1', isOrganizer: true, nowMs: MAY_8_NY_MIDNIGHT });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Pinehurst 2026' })).toBeInTheDocument();
    });
    const adminLink = screen.getByTestId('event-home-admin-link');
    expect(adminLink).toBeInTheDocument();
    expect(adminLink.getAttribute('href')).toBe('/admin/events/evt-1');
  });

  it('T13-1: non-organizer does NOT see the admin link', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(EVENT_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithRouter({ eventId: 'evt-1', isOrganizer: false, nowMs: MAY_8_NY_MIDNIGHT });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Pinehurst 2026' })).toBeInTheDocument();
    });
    expect(screen.queryByTestId('event-home-admin-link')).toBeNull();
  });

  it('countdown — pre-event, 3 days out', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(EVENT_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithRouter({ eventId: 'evt-1', nowMs: MAY_8_NY_MIDNIGHT - 3 * 86_400_000 });
    await waitFor(() => {
      expect(screen.getByText(/Round 1 starts in 3 days/)).toBeInTheDocument();
    });
  });

  it('countdown — post-event', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(EVENT_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithRouter({ eventId: 'evt-1', nowMs: MAY_10_NY_MIDNIGHT + 2 * 86_400_000 });
    await waitFor(() => {
      expect(screen.getByText(/Event complete/)).toBeInTheDocument();
    });
  });

  it('date range — same-year format omits year', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(EVENT_FIXTURE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithRouter({ eventId: 'evt-1', nowMs: MAY_8_NY_MIDNIGHT });
    await waitFor(() => {
      // "May 8 – May 10" — no year token.
      const range = screen.getByText(/May \d+ – May \d+/);
      expect(range).toBeInTheDocument();
      expect(range.textContent).not.toMatch(/2026/);
    });
  });

  it('date range uses event.timezone, NOT viewer local — Pacific/Auckland event renders different day than NY would (codex L #5)', async () => {
    // 2026-05-08 04:00 UTC is:
    //   - 2026-05-08 in America/New_York (00:00 NY local)
    //   - 2026-05-08 in Pacific/Auckland (16:00 NZST)
    // 2026-05-07 18:00 UTC is:
    //   - 2026-05-07 in America/New_York (14:00 NY local)
    //   - 2026-05-08 in Pacific/Auckland (06:00 NZST)
    //
    // We pin the event to Pacific/Auckland with startDate = 2026-05-07 18:00 UTC.
    // If the formatter respects event.timezone (Auckland), the output should
    // contain "May 8". If it leaked viewer's local timezone (likely UTC or
    // NY in CI), it would show "May 7".
    const aucklandFixture = {
      event: {
        id: 'evt-2',
        name: 'Auckland Open',
        startDate: Date.UTC(2026, 4, 7, 18),     // 2026-05-08 06:00 NZST
        endDate:   Date.UTC(2026, 4, 9, 18),     // 2026-05-10 06:00 NZST
        timezone: 'Pacific/Auckland',
      },
      rounds: [
        { id: 'er-a1', roundNumber: 1, roundDate: Date.UTC(2026, 4, 7, 18), holesToPlay: 18 },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(aucklandFixture), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    renderWithRouter({ eventId: 'evt-2', nowMs: Date.UTC(2026, 4, 1) });
    await waitFor(() => {
      // The hero subtitle should show May 8–May 10 in Auckland time.
      // If the formatter leaked viewer's local timezone (UTC/NY), it would
      // show May 7–May 9 — assert the Auckland-time output specifically.
      expect(screen.getByText('May 8 – May 10')).toBeInTheDocument();
    });
  });
});

describe('computeCountdown', () => {
  const rounds = [
    { roundNumber: 1, roundDate: MAY_8_NY_MIDNIGHT },
    { roundNumber: 2, roundDate: MAY_9_NY_MIDNIGHT },
    { roundNumber: 3, roundDate: MAY_10_NY_MIDNIGHT },
  ];

  it('pre-event ≥ 1 day → "Round 1 starts in N days"', () => {
    expect(computeCountdown(rounds, MAY_8_NY_MIDNIGHT - 3 * 86_400_000)).toBe('Round 1 starts in 3 days');
  });

  it('pre-event < 1 day → "Round 1 starts today"', () => {
    expect(computeCountdown(rounds, MAY_8_NY_MIDNIGHT - 12 * 3600 * 1000)).toBe('Round 1 starts today');
  });

  it('singular "day" not "days"', () => {
    expect(computeCountdown(rounds, MAY_8_NY_MIDNIGHT - 1.5 * 86_400_000)).toBe('Round 1 starts in 1 day');
  });

  it('mid-event (after round 1, < 1 day to round 2) → "Round 2 starts today"', () => {
    // Round 1 just started; round 2 is exactly ONE_DAY_MS - 1 ms away → "today".
    expect(computeCountdown(rounds, MAY_8_NY_MIDNIGHT + 1)).toBe('Round 2 starts today');
  });

  it('boundary — diff exactly ONE_DAY_MS → "Round 1 starts in 1 day" (≥ branch, codex M #3)', () => {
    // Pin now exactly ONE_DAY_MS before round 1 → diff === ONE_DAY_MS, NOT < ONE_DAY_MS,
    // so the "today" branch should NOT fire; "1 day" should.
    expect(computeCountdown(rounds, MAY_8_NY_MIDNIGHT - 86_400_000)).toBe('Round 1 starts in 1 day');
  });

  it('boundary — diff ONE_DAY_MS - 1 ms → "Round 1 starts today"', () => {
    expect(computeCountdown(rounds, MAY_8_NY_MIDNIGHT - 86_400_000 + 1)).toBe('Round 1 starts today');
  });

  it('post-event (>= last + 1 day) → "Event complete"', () => {
    expect(computeCountdown(rounds, MAY_10_NY_MIDNIGHT + 86_400_000)).toBe('Event complete');
  });

  it('mid-event window (after last round but before +1 day) → "Round in progress"', () => {
    expect(computeCountdown(rounds, MAY_10_NY_MIDNIGHT + 1)).toBe('Round in progress');
  });

  it('empty rounds → fallback', () => {
    expect(computeCountdown([], 0)).toBe('No rounds scheduled');
  });
});
