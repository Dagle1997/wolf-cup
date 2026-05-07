/**
 * T8-4 AwardCelebration component tests. Uses the StubProvider pattern
 * from T8-2's Toast/Banner tests so we can inject ActivityRow batches
 * deterministically AND control the auth-session value.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { AwardCelebration } from './award-celebration';
import type { ActivityRow } from '../providers/activity-feed-provider';

const SESSION_PLAYER_ID = 'plr-me';
const OTHER_PLAYER_ID = 'plr-other';

// ---- Stub provider --------------------------------------------------------

type SubscribeHandler = (rows: ActivityRow[]) => void;
type StubCtx = {
  rows: ActivityRow[];
  subscribe: (h: SubscribeHandler) => () => void;
  emit: (rows: ActivityRow[]) => void;
  setRows: (rows: ActivityRow[]) => void;
};

const StubContext = createContext<StubCtx | null>(null);

function StubProvider({
  initialRows,
  children,
}: {
  initialRows: ActivityRow[];
  children: ReactNode;
}) {
  const [rows, setRowsState] = useState<ActivityRow[]>(initialRows);
  const subsRef = useRef<Set<SubscribeHandler>>(new Set());
  const subscribe = useCallback((h: SubscribeHandler) => {
    subsRef.current.add(h);
    return () => {
      subsRef.current.delete(h);
    };
  }, []);
  const emit = useCallback((newRows: ActivityRow[]) => {
    for (const h of subsRef.current) h(newRows);
  }, []);
  const setRows = useCallback((next: ActivityRow[]) => {
    setRowsState(next);
  }, []);
  return (
    <StubContext.Provider value={{ rows, subscribe, emit, setRows }}>
      {children}
    </StubContext.Provider>
  );
}

vi.mock('../hooks/use-activity-feed', () => ({
  useActivityFeed: () => {
    const ctx = useContext(StubContext);
    if (ctx === null) throw new Error('StubContext missing');
    return {
      rows: ctx.rows,
      cursorBefore: null,
      loadMore: vi.fn(),
      isPolling: false,
      error: null,
    };
  },
  useActivityStream: (handler: SubscribeHandler) => {
    const ctx = useContext(StubContext);
    if (ctx === null) throw new Error('StubContext missing');
    useEffect(() => ctx.subscribe(handler), [ctx, handler]);
  },
}));

// ---- Mockable auth-session hook -------------------------------------------

type MockSession = { player: { id: string; isOrganizer: boolean } | null; device: null };
let mockSession: MockSession = { player: null, device: null };

vi.mock('../hooks/use-auth-session', () => ({
  useAuthSession: () => mockSession,
}));

// ---- Helpers --------------------------------------------------------------

function makeAwardRow(opts: {
  rowId: string;
  awardType: 'first_birdie_of_event' | 'first_eagle_of_event';
  playerId: string;
  createdAt?: number;
}): ActivityRow {
  return {
    id: opts.rowId,
    createdAt: opts.createdAt ?? Date.now(),
    event: {
      type: 'award.triggered',
      eventId: 'evt-test',
      playerId: opts.playerId,
      awardType: opts.awardType,
      context: { holeNumber: 7, grossStrokes: 3, par: 4 },
    },
  };
}

function renderWithEmitter(initialRows: ActivityRow[] = []): {
  emit: (rows: ActivityRow[]) => void;
  setRows: (rows: ActivityRow[]) => void;
} {
  const captured: { emit?: (rows: ActivityRow[]) => void; setRows?: (rows: ActivityRow[]) => void } = {};
  function Capture() {
    const ctx = useContext(StubContext);
    if (ctx === null) throw new Error('no stub context');
    captured.emit = ctx.emit;
    captured.setRows = ctx.setRows;
    return null;
  }
  render(
    <StubProvider initialRows={initialRows}>
      <Capture />
      <AwardCelebration />
    </StubProvider>,
  );
  if (!captured.emit || !captured.setRows) throw new Error('capture failed');
  return { emit: captured.emit, setRows: captured.setRows };
}

beforeEach(() => {
  mockSession = { player: { id: SESSION_PLAYER_ID, isOrganizer: false }, device: null };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ---- Tests ----------------------------------------------------------------

describe('AwardCelebration — affected player render paths', () => {
  it('renders corner birdie animation for affected player + birdie award', () => {
    const { emit } = renderWithEmitter();
    act(() => {
      emit([
        makeAwardRow({
          rowId: 'r-1',
          awardType: 'first_birdie_of_event',
          playerId: SESSION_PLAYER_ID,
        }),
      ]);
    });
    expect(screen.getByTestId('award-celebration-birdie')).toBeInTheDocument();
    expect(screen.queryByTestId('award-celebration-eagle')).toBeNull();
  });

  it('renders full-screen eagle overlay for affected player + eagle award', () => {
    const { emit } = renderWithEmitter();
    act(() => {
      emit([
        makeAwardRow({
          rowId: 'r-1',
          awardType: 'first_eagle_of_event',
          playerId: SESSION_PLAYER_ID,
        }),
      ]);
    });
    expect(screen.getByTestId('award-celebration-eagle')).toBeInTheDocument();
    expect(screen.queryByTestId('award-celebration-birdie')).toBeNull();
  });
});

describe("AwardCelebration — other player's award", () => {
  it('renders nothing when the award.playerId !== session.player.id', () => {
    const { emit } = renderWithEmitter();
    act(() => {
      emit([
        makeAwardRow({
          rowId: 'r-1',
          awardType: 'first_birdie_of_event',
          playerId: OTHER_PLAYER_ID,
        }),
      ]);
    });
    expect(screen.queryByTestId('award-celebration-birdie')).toBeNull();
    expect(screen.queryByTestId('award-celebration-eagle')).toBeNull();
  });
});

describe('AwardCelebration — auto-dismiss', () => {
  it('removes the celebration after the 4s TTL', () => {
    vi.useFakeTimers();
    const { emit } = renderWithEmitter();
    act(() => {
      emit([
        makeAwardRow({
          rowId: 'r-1',
          awardType: 'first_birdie_of_event',
          playerId: SESSION_PLAYER_ID,
        }),
      ]);
    });
    expect(screen.getByTestId('award-celebration-birdie')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4_500);
    });
    expect(screen.queryByTestId('award-celebration-birdie')).toBeNull();
  });
});

describe('AwardCelebration — no session', () => {
  it('renders nothing when session.player is null even on a matching event', () => {
    mockSession = { player: null, device: null };
    const { emit } = renderWithEmitter();
    act(() => {
      emit([
        makeAwardRow({
          rowId: 'r-1',
          awardType: 'first_birdie_of_event',
          playerId: SESSION_PLAYER_ID,
        }),
      ]);
    });
    expect(screen.queryByTestId('award-celebration-birdie')).toBeNull();
    expect(screen.queryByTestId('award-celebration-eagle')).toBeNull();
  });
});

describe('AwardCelebration — auth-resolve catchup', () => {
  it('catches up an award that arrived before auth resolved (within TTL)', () => {
    // Simulate: row already in provider rows[] (recent createdAt), but
    // auth was null when the stream emitted. Now auth resolves → the
    // useEffect catchup picks up the recent matching row from rows[].
    mockSession = { player: null, device: null };
    const recentRow = makeAwardRow({
      rowId: 'r-recent',
      awardType: 'first_birdie_of_event',
      playerId: SESSION_PLAYER_ID,
      createdAt: Date.now() - 1_000, // 1s ago — within 4s TTL
    });
    // First mount with no session.
    const { rerender } = render(
      <StubProvider initialRows={[recentRow]}>
        <AwardCelebration />
      </StubProvider>,
    );
    expect(screen.queryByTestId('award-celebration-birdie')).toBeNull();
    // Now resolve the session.
    mockSession = { player: { id: SESSION_PLAYER_ID, isOrganizer: false }, device: null };
    rerender(
      <StubProvider initialRows={[recentRow]}>
        <AwardCelebration />
      </StubProvider>,
    );
    expect(screen.getByTestId('award-celebration-birdie')).toBeInTheDocument();
  });

  it('does NOT replay a stale award older than the TTL window', () => {
    mockSession = { player: null, device: null };
    const staleRow = makeAwardRow({
      rowId: 'r-stale',
      awardType: 'first_birdie_of_event',
      playerId: SESSION_PLAYER_ID,
      createdAt: Date.now() - 10_000, // 10s ago — past 4s TTL
    });
    const { rerender } = render(
      <StubProvider initialRows={[staleRow]}>
        <AwardCelebration />
      </StubProvider>,
    );
    expect(screen.queryByTestId('award-celebration-birdie')).toBeNull();
    mockSession = { player: { id: SESSION_PLAYER_ID, isOrganizer: false }, device: null };
    rerender(
      <StubProvider initialRows={[staleRow]}>
        <AwardCelebration />
      </StubProvider>,
    );
    // Stale row → no celebration.
    expect(screen.queryByTestId('award-celebration-birdie')).toBeNull();
    expect(screen.queryByTestId('award-celebration-eagle')).toBeNull();
  });
});

describe('AwardCelebration — eagle priority over birdie', () => {
  it('renders eagle overlay when both birdie and eagle fire in one batch', () => {
    const { emit } = renderWithEmitter();
    const now = Date.now();
    act(() => {
      emit([
        makeAwardRow({
          rowId: 'r-birdie',
          awardType: 'first_birdie_of_event',
          playerId: SESSION_PLAYER_ID,
          createdAt: now - 500, // recent — within TTL
        }),
        makeAwardRow({
          rowId: 'r-eagle',
          awardType: 'first_eagle_of_event',
          playerId: SESSION_PLAYER_ID,
          createdAt: now - 200, // most recent — within TTL
        }),
      ]);
    });
    // Eagle overlay wins over corner birdie animation.
    expect(screen.getByTestId('award-celebration-eagle')).toBeInTheDocument();
    expect(screen.queryByTestId('award-celebration-birdie')).toBeNull();
  });
});
