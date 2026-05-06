/**
 * T8-2 TournamentBanner component tests. Same stub-provider trick as
 * the Toast tests so we can inject ActivityRow batches deterministically.
 *
 * Coverage:
 *   - Persistence until dismiss
 *   - localStorage dismissal survives remount
 *   - Storm collapse: 3 events within 5s → 1 summary banner
 *   - Modal expansion + atomic dismiss-all
 *   - Sub-threshold (1-2 events): renders individuals, no storm summary
 *   - Unmount clears the storm timer
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';

import { TournamentBanner } from './tournament-banner';
import type { ActivityRow } from '../providers/activity-feed-provider';

const TEST_EVENT_ID = 'evt-test-1234567890ab'; // 20 chars, matches the URL regex

type SubscribeHandler = (rows: ActivityRow[]) => void;
const StubContext = createContext<{
  subscribe: (h: SubscribeHandler) => () => void;
  emit: (rows: ActivityRow[]) => void;
} | null>(null);

function StubProvider({ children }: { children: ReactNode }) {
  const subsRef = useRef<Set<SubscribeHandler>>(new Set());
  const subscribe = useCallback((h: SubscribeHandler) => {
    subsRef.current.add(h);
    return () => {
      subsRef.current.delete(h);
    };
  }, []);
  const emit = useCallback((rows: ActivityRow[]) => {
    for (const h of subsRef.current) h(rows);
  }, []);
  return (
    <StubContext.Provider value={{ subscribe, emit }}>
      {children}
    </StubContext.Provider>
  );
}

function useStubStream(handler: (rows: ActivityRow[]) => void): void {
  const ctx = useContext(StubContext);
  if (ctx === null) throw new Error('StubContext missing');
  useEffect(() => ctx.subscribe(handler), [ctx, handler]);
}

vi.mock('../hooks/use-activity-feed', () => ({
  useActivityStream: (handler: (rows: ActivityRow[]) => void) =>
    useStubStream(handler),
}));

function renderWithEmitter(): { emit: (rows: ActivityRow[]) => void; unmount: () => void } {
  let captured: ((rows: ActivityRow[]) => void) | null = null;
  function Capture() {
    const ctx = useContext(StubContext);
    if (ctx === null) throw new Error('no stub context');
    captured = ctx.emit;
    return null;
  }
  const result = render(
    <StubProvider>
      <Capture />
      <TournamentBanner />
    </StubProvider>,
  );
  if (captured === null) throw new Error('emit not captured');
  return { emit: captured, unmount: result.unmount };
}

function makeRow(
  id: string,
  type: string,
  extra: Record<string, unknown> = {},
): ActivityRow {
  return {
    id,
    createdAt: Date.now(),
    event: { type, eventId: TEST_EVENT_ID, ...extra },
  };
}

beforeEach(() => {
  // Set the URL so the banner reads its eventId for localStorage keying.
  window.history.replaceState({}, '', `/events/${TEST_EVENT_ID}/leaderboard`);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

// ---- Persistence + dismiss + localStorage ---------------------------------

describe('TournamentBanner — single-event persistence', () => {
  it('renders an individual banner after the storm window closes (1 event below threshold)', () => {
    vi.useFakeTimers();
    const { emit } = renderWithEmitter();
    act(() => {
      emit([
        makeRow('row-1', 'press.auto_fired', {
          triggerHole: 5,
          team: 'teamA',
          multiplier: 2,
          trigger: 'down_2',
          roundId: 'r1',
        }),
      ]);
    });
    // Below storm threshold — the timer must fire to flush as individual.
    act(() => {
      vi.advanceTimersByTime(5_500);
    });
    expect(screen.getByTestId('tournament-banner-stack')).toBeInTheDocument();
    expect(screen.getAllByTestId('tournament-banner-entry')).toHaveLength(1);
    // Storm summary is NOT rendered.
    expect(screen.queryByTestId('tournament-banner-storm')).toBeNull();
  });

  it('persists until Dismiss is tapped', () => {
    vi.useFakeTimers();
    const { emit } = renderWithEmitter();
    act(() => {
      emit([
        makeRow('row-1', 'rule_set.revised', {
          ruleSetId: 'rs',
          revisionId: 'rsr',
        }),
      ]);
    });
    act(() => vi.advanceTimersByTime(5_500));
    expect(screen.getByTestId('tournament-banner-entry')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tournament-banner-dismiss-row-1'));
    expect(screen.queryByTestId('tournament-banner-entry')).toBeNull();
    expect(screen.queryByTestId('tournament-banner-stack')).toBeNull();
  });

  it('localStorage dismissal survives a remount', () => {
    vi.useFakeTimers();
    const first = renderWithEmitter();
    act(() => {
      first.emit([
        makeRow('row-persist', 'rule_set.revised', {
          ruleSetId: 'rs',
          revisionId: 'rsr',
        }),
      ]);
    });
    act(() => vi.advanceTimersByTime(5_500));
    fireEvent.click(screen.getByTestId('tournament-banner-dismiss-row-persist'));
    first.unmount();

    // Verify localStorage carries the dismissed id.
    const raw = localStorage.getItem(`tournament:banner-dismissed:${TEST_EVENT_ID}`);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).ids).toContain('row-persist');

    // Remount and re-emit the SAME rowId — banner must NOT resurrect.
    const second = renderWithEmitter();
    act(() => {
      second.emit([
        makeRow('row-persist', 'rule_set.revised', {
          ruleSetId: 'rs',
          revisionId: 'rsr',
        }),
      ]);
    });
    act(() => vi.advanceTimersByTime(5_500));
    expect(screen.queryByTestId('tournament-banner-entry')).toBeNull();
  });
});

// ---- Storm collapse -------------------------------------------------------

describe('TournamentBanner — storm collapse', () => {
  it('collapses ≥3 banner-eligible events within 5s into one summary banner', () => {
    vi.useFakeTimers();
    const { emit } = renderWithEmitter();
    act(() => {
      emit([
        makeRow('row-1', 'press.auto_fired', {
          triggerHole: 5,
          team: 'teamA',
          multiplier: 2,
          trigger: 'down_2',
          roundId: 'r1',
        }),
        makeRow('row-2', 'press.manual_fired', {
          fromHole: 6,
          team: 'teamB',
          multiplier: 2,
          filedByPlayerId: 'p1',
          roundId: 'r1',
        }),
        makeRow('row-3', 'rule_set.revised', {
          ruleSetId: 'rs',
          revisionId: 'rsr',
        }),
      ]);
    });
    // Advance time past the storm window.
    act(() => vi.advanceTimersByTime(5_500));

    expect(screen.getByTestId('tournament-banner-storm')).toBeInTheDocument();
    expect(screen.getByTestId('tournament-banner-storm-summary').textContent).toMatch(/3 updates/);
    // No individual banners — they were absorbed into the storm.
    expect(screen.queryAllByTestId('tournament-banner-entry')).toHaveLength(0);
  });

  it('Review button expands the modal listing all N events', () => {
    vi.useFakeTimers();
    const { emit } = renderWithEmitter();
    act(() => {
      emit([
        makeRow('row-1', 'press.auto_fired', {
          triggerHole: 5,
          team: 'teamA',
          multiplier: 2,
          trigger: 'down_2',
          roundId: 'r1',
        }),
        makeRow('row-2', 'press.manual_fired', {
          fromHole: 6,
          team: 'teamB',
          multiplier: 2,
          filedByPlayerId: 'p1',
          roundId: 'r1',
        }),
        makeRow('row-3', 'round.finalized', { roundId: 'r1' }),
      ]);
    });
    act(() => vi.advanceTimersByTime(5_500));
    fireEvent.click(screen.getByTestId('tournament-banner-storm-expand'));
    const modalEntries = screen.getAllByTestId('tournament-banner-storm-modal-entry');
    expect(modalEntries).toHaveLength(3);
  });

  it('Dismiss-all marks every event in the storm as dismissed atomically', () => {
    vi.useFakeTimers();
    const { emit } = renderWithEmitter();
    act(() => {
      emit([
        makeRow('row-1', 'press.auto_fired', {
          triggerHole: 5,
          team: 'teamA',
          multiplier: 2,
          trigger: 'down_2',
          roundId: 'r1',
        }),
        makeRow('row-2', 'press.manual_fired', {
          fromHole: 6,
          team: 'teamB',
          multiplier: 2,
          filedByPlayerId: 'p1',
          roundId: 'r1',
        }),
        makeRow('row-3', 'round.finalized', { roundId: 'r1' }),
      ]);
    });
    act(() => vi.advanceTimersByTime(5_500));
    fireEvent.click(screen.getByTestId('tournament-banner-storm-dismiss'));

    expect(screen.queryByTestId('tournament-banner-storm')).toBeNull();
    expect(screen.queryByTestId('tournament-banner-stack')).toBeNull();
    const raw = localStorage.getItem(
      `tournament:banner-dismissed:${TEST_EVENT_ID}`,
    );
    const ids = JSON.parse(raw!).ids as string[];
    expect(ids).toContain('row-1');
    expect(ids).toContain('row-2');
    expect(ids).toContain('row-3');
  });
});

// ---- Unmount cleanup ------------------------------------------------------

describe('TournamentBanner — unmount cleanup', () => {
  it('clearing the component during the 5s window does not throw', () => {
    vi.useFakeTimers();
    const { emit, unmount } = renderWithEmitter();
    act(() => {
      emit([
        makeRow('row-1', 'press.auto_fired', {
          triggerHole: 5,
          team: 'teamA',
          multiplier: 2,
          trigger: 'down_2',
          roundId: 'r1',
        }),
      ]);
    });
    // Storm timer is running with 1 pending entry. Unmount before it fires.
    expect(() => unmount()).not.toThrow();
    // Advancing timers after unmount must NOT cause errors.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
  });
});
