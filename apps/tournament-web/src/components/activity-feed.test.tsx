/**
 * T8-3 ActivityFeed component tests. Uses a stub provider context that
 * the feed reads from via the useActivityFeed hook.
 *
 * 10 cases per AC #10:
 *   1. Empty state
 *   2. 20-event initial render
 *   3. 20-event with cursorBefore non-null → Load more visible + click triggers loadMore()
 *   4. 40-event with visibleCount=20 → Load more reveals next 20 locally (no loadMore call)
 *   5. Load more after slice catches up → loadMore() called once
 *   6. Live-event prepend
 *   7. Score-correction inline rendering
 *   8. Relative time across fixture timestamps
 *   9. Tap routing for score.committed → Link href to leaderboard
 *  10. round.cancelled non-link rendering
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ActivityFeed } from './activity-feed';
import type { ActivityRow } from '../providers/activity-feed-provider';

// ---- Stub provider --------------------------------------------------------

type StubCtx = {
  rows: ActivityRow[];
  cursorBefore: string | null;
  loadMoreSpy: ReturnType<typeof vi.fn>;
  // Setter to push a new row into the provider's rows state (for live-event tests).
  prepend: (row: ActivityRow) => void;
  // Setter that simulates a successful loadMore() resolve (appends rows older than the current oldest).
  appendOlder: (rows: ActivityRow[]) => void;
};

const StubReactCtx = createContext<StubCtx | null>(null);

function StubProvider({
  initialRows,
  initialCursorBefore,
  loadMoreImpl,
  children,
}: {
  initialRows: ActivityRow[];
  initialCursorBefore: string | null;
  loadMoreImpl?: (ctx: StubCtx) => Promise<void>;
  children: ReactNode;
}) {
  const [rows, setRows] = useState<ActivityRow[]>(initialRows);
  const [cursorBefore, setCursorBefore] = useState<string | null>(initialCursorBefore);
  // Stabilize the spy across renders — recreating it per render means
  // a Capture component sees a different vi.fn instance than the click
  // handler invokes. useRef gives us a single stable reference.
  const spyRef = useRef<ReturnType<typeof vi.fn>>(undefined);
  if (spyRef.current === undefined) {
    spyRef.current = vi.fn(async () => {
      if (loadMoreImpl) {
        await loadMoreImpl(valueRef.current);
      }
    });
  }
  const valueRef = useRef<StubCtx>({} as StubCtx);
  const value: StubCtx = {
    rows,
    cursorBefore,
    loadMoreSpy: spyRef.current,
    prepend: (row) => setRows((prev) => [row, ...prev]),
    appendOlder: (newRows) => {
      setRows((prev) => [...prev, ...newRows]);
    },
  };
  valueRef.current = value;
  // Allow the loadMoreImpl to mutate cursorBefore directly.
  (value as StubCtx & { _setCursorBefore?: (c: string | null) => void })._setCursorBefore =
    setCursorBefore;
  return (
    <StubReactCtx.Provider value={value}>{children}</StubReactCtx.Provider>
  );
}

// Hot-swap the real `useActivityFeed` import for our stub.
vi.mock('../hooks/use-activity-feed', () => ({
  useActivityFeed: () => {
    const ctx = useContext(StubReactCtx);
    if (ctx === null) throw new Error('StubReactCtx missing');
    return {
      rows: ctx.rows,
      cursorBefore: ctx.cursorBefore,
      loadMore: ctx.loadMoreSpy,
      isPolling: false,
      error: null,
    };
  },
}));

// ---- Router scaffolding (so <Link> resolves) ------------------------------

function buildRouter(testElement: ReactNode) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{testElement}</>,
  });
  const leaderboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/events/$eventId/leaderboard',
    component: () => <div>leaderboard</div>,
  });
  const moneyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/events/$eventId/money',
    component: () => <div>money</div>,
  });
  const betsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/events/$eventId/bets',
    component: () => <div>bets</div>,
  });
  const galleryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/events/$eventId/gallery',
    component: () => <div>gallery</div>,
  });
  const scoreEntryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/rounds/$roundId/score-entry',
    component: () => <div>score-entry</div>,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      leaderboardRoute,
      moneyRoute,
      betsRoute,
      galleryRoute,
      scoreEntryRoute,
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
}

function renderWith(opts: {
  initialRows: ActivityRow[];
  initialCursorBefore?: string | null;
  loadMoreImpl?: (ctx: StubCtx) => Promise<void>;
  capture?: ReactNode;
}): void {
  // Conditional spread for `loadMoreImpl` — exactOptionalPropertyTypes
  // forbids passing `undefined` to an optional prop.
  const stubProps = {
    initialRows: opts.initialRows,
    initialCursorBefore: opts.initialCursorBefore ?? null,
    ...(opts.loadMoreImpl ? { loadMoreImpl: opts.loadMoreImpl } : {}),
  };
  const router = buildRouter(
    <StubProvider {...stubProps}>
      {opts.capture}
      <ActivityFeed />
    </StubProvider>,
  );
  render(<RouterProvider router={router} />);
}

// ---- Helpers --------------------------------------------------------------

function makeRow(
  seq: number,
  type: string,
  extra: Record<string, unknown> = {},
  createdAt = 1_000_000 - seq * 1_000,
): ActivityRow {
  return {
    id: `row-${seq.toString().padStart(8, '0')}-uuid`,
    createdAt,
    event: { type, eventId: 'evt-test-1234567890ab', ...extra },
  };
}

function makeRows(count: number, type = 'gallery.uploaded'): ActivityRow[] {
  return Array.from({ length: count }, (_, i) =>
    makeRow(i, type, { photoId: `ph-${i}`, actorPlayerId: 'p-actor' }),
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---- Tests ----------------------------------------------------------------

describe('ActivityFeed — empty state', () => {
  it('renders the empty-state card and no Load more button when rows.length === 0', async () => {
    renderWith({ initialRows: [] });
    expect(await screen.findByTestId('activity-feed-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-feed-load-more')).toBeNull();
  });

  it('empty state takes precedence over a non-null cursorBefore', async () => {
    // Edge case: cursorBefore is non-null but rows are empty.
    renderWith({ initialRows: [], initialCursorBefore: 'cursor-x' });
    expect(await screen.findByTestId('activity-feed-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-feed-load-more')).toBeNull();
  });
});

describe('ActivityFeed — initial render', () => {
  it('shows the newest 20 rows when rows.length is exactly 20 and cursorBefore is null', async () => {
    renderWith({ initialRows: makeRows(20), initialCursorBefore: null });
    await screen.findByTestId('activity-feed-list');
    const rows = screen.getAllByTestId('activity-feed-row');
    expect(rows).toHaveLength(20);
    // No Load more button — caught up locally and remotely.
    expect(screen.queryByTestId('activity-feed-load-more')).toBeNull();
  });

  it('shows Load more when cursorBefore is non-null even with 20 rows', async () => {
    renderWith({
      initialRows: makeRows(20),
      initialCursorBefore: 'cursor-x',
    });
    expect(await screen.findByTestId('activity-feed-load-more')).toBeInTheDocument();
  });
});

describe('ActivityFeed — Load more two-stage', () => {
  it('reveals next 20 locally when 40 rows exist but visibleCount=20 (no loadMore() call)', async () => {
    let capturedSpy: ReturnType<typeof vi.fn> | null = null;
    function Capture() {
      const ctx = useContext(StubReactCtx);
      if (ctx) capturedSpy = ctx.loadMoreSpy;
      return null;
    }
    renderWith({
      initialRows: makeRows(40),
      initialCursorBefore: null,
      capture: <Capture />,
    });
    await screen.findByTestId('activity-feed-list');
    expect(screen.getAllByTestId('activity-feed-row')).toHaveLength(20);
    fireEvent.click(screen.getByTestId('activity-feed-load-more'));
    expect(screen.getAllByTestId('activity-feed-row')).toHaveLength(40);
    expect(capturedSpy).not.toBeNull();
    expect(capturedSpy!).not.toHaveBeenCalled();
  });

  it('calls loadMore() exactly once when slice catches up and cursorBefore is non-null', async () => {
    let capturedSpy: ReturnType<typeof vi.fn> | null = null;
    function Capture() {
      const ctx = useContext(StubReactCtx);
      if (ctx) capturedSpy = ctx.loadMoreSpy;
      return null;
    }
    renderWith({
      initialRows: makeRows(20),
      initialCursorBefore: 'cursor-x',
      loadMoreImpl: async (ctx) => {
        ctx.appendOlder(
          makeRows(20).map((r, i) =>
            makeRow(20 + i, r.event.type, { photoId: `older-${i}`, actorPlayerId: 'p' }),
          ),
        );
        const setter = (ctx as StubCtx & { _setCursorBefore?: (c: string | null) => void })
          ._setCursorBefore;
        if (setter) setter(null);
      },
      capture: <Capture />,
    });
    await screen.findByTestId('activity-feed-load-more');
    fireEvent.click(screen.getByTestId('activity-feed-load-more'));
    expect(capturedSpy).not.toBeNull();
    await waitFor(() => {
      expect(capturedSpy!).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ActivityFeed — live event prepend', () => {
  it('renders the new row at the top after provider rows mutate', async () => {
    let capturedCtx: StubCtx | null = null;
    function Capture() {
      const ctx = useContext(StubReactCtx);
      if (ctx) capturedCtx = ctx;
      return null;
    }
    renderWith({
      initialRows: makeRows(5),
      initialCursorBefore: null,
      capture: <Capture />,
    });
    await screen.findByTestId('activity-feed-list');
    expect(screen.getAllByTestId('activity-feed-row')).toHaveLength(5);
    expect(capturedCtx).not.toBeNull();
    capturedCtx!.prepend(
      makeRow(999, 'gallery.uploaded', { photoId: 'ph-new', actorPlayerId: 'p' }, 9_999_999),
    );
    await waitFor(() => {
      expect(screen.getAllByTestId('activity-feed-row')).toHaveLength(6);
    });
    const rowsAfter = screen.getAllByTestId('activity-feed-row');
    expect(rowsAfter[0]!.getAttribute('data-row-id')).toBe('row-00000999-uuid');
  });
});

describe('ActivityFeed — score-correction inline rendering', () => {
  it('renders priorGross + newGross + Corrected by {actor}', async () => {
    const correctedRow = makeRow(0, 'score.corrected', {
      playerId: 'p-rick',
      holeNumber: 7,
      priorGross: 5,
      newGross: 4,
      actorPlayerId: 'p-organizer',
      roundId: 'r',
    });
    renderWith({ initialRows: [correctedRow] });
    const headline = await screen.findByTestId('activity-feed-row-headline');
    expect(headline.textContent).toMatch(/Corrected by p-organizer/);
    expect(headline.textContent).toMatch(/p-rick/);
    expect(headline.textContent).toMatch(/hole 7/);
    expect(headline.textContent).toMatch(/5 → 4/);
  });
});

describe('ActivityFeed — relative time', () => {
  it('renders the right label for each fixture-time bucket', async () => {
    // No fake timers — vi.useFakeTimers() blocks the TanStack Router's
    // async route mount, hanging findByTestId. Instead we compute
    // timestamps relative to Date.now() at test setup; the gap between
    // fixture creation and component render is microseconds.
    const now = Date.now();
    const rows = [
      makeRow(0, 'gallery.uploaded', { photoId: 'a', actorPlayerId: 'p' }, now - 5_000),
      makeRow(1, 'gallery.uploaded', { photoId: 'b', actorPlayerId: 'p' }, now - 45_000),
      makeRow(2, 'gallery.uploaded', { photoId: 'c', actorPlayerId: 'p' }, now - 5 * 60_000),
      makeRow(3, 'gallery.uploaded', { photoId: 'd', actorPlayerId: 'p' }, now - 2 * 60 * 60_000),
      makeRow(4, 'gallery.uploaded', { photoId: 'e', actorPlayerId: 'p' }, now - 3 * 24 * 60 * 60_000),
    ];
    renderWith({ initialRows: rows });
    await screen.findByTestId('activity-feed-list');
    const times = screen.getAllByTestId('activity-feed-row-time').map((el) => el.textContent);
    expect(times[0]).toBe('just now');
    expect(times[1]).toBe('45s ago');
    expect(times[2]).toBe('5m ago');
    expect(times[3]).toBe('2h ago');
    expect(times[4]).toBe('3d ago');
  });
});

describe('ActivityFeed — tap routing', () => {
  it('score.committed wraps in <Link> with leaderboard href', async () => {
    const row = makeRow(0, 'score.committed', {
      playerId: 'p',
      grossStrokes: 4,
      holeNumber: 7,
      par: 4,
      toPar: 0,
      isBirdieOrBetter: false,
      scorerPlayerId: 'p',
      roundId: 'r',
    });
    renderWith({ initialRows: [row] });
    const link = await screen.findByTestId('activity-feed-row');
    expect(link.tagName).toBe('A');
    const href = link.getAttribute('href');
    expect(href).toBe('/events/evt-test-1234567890ab/leaderboard');
  });

  it('round.cancelled renders without a Link wrapper', async () => {
    const row = makeRow(0, 'round.cancelled', { roundId: 'r', actorPlayerId: 'p' });
    renderWith({ initialRows: [row] });
    const el = await screen.findByTestId('activity-feed-row');
    expect(el.tagName).toBe('DIV');
    expect(el.getAttribute('href')).toBeNull();
  });
});
