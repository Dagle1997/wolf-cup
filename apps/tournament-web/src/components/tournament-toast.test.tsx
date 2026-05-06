/**
 * T8-2 TournamentToast component tests. Drives the component via a
 * synthetic provider that exposes a manual emit helper, so we can
 * inject ActivityRow batches without standing up the real polling
 * subscription.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';

import { TournamentToast } from './tournament-toast';
import type { ActivityRow } from '../providers/activity-feed-provider';

// Synthetic provider that exposes a setter via a closure — TournamentToast
// calls useActivityStream which we re-export from here pointing at our
// stub context. We avoid the real network/polling surface entirely.

import { useContext } from 'react';
import { createContext } from 'react';
import { useCallback, useRef } from 'react';

type SubscribeHandler = (rows: ActivityRow[]) => void;
type StubContextValue = {
  subscribe: (h: SubscribeHandler) => () => void;
  emit: (rows: ActivityRow[]) => void;
};

const StubContext = createContext<StubContextValue | null>(null);

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

// Hot-swap the real `useActivityStream` import for our stub.
vi.mock('../hooks/use-activity-feed', () => ({
  useActivityStream: (handler: (rows: ActivityRow[]) => void) =>
    useStubStream(handler),
}));

function renderWithEmitter(): { emit: (rows: ActivityRow[]) => void } {
  let captured: ((rows: ActivityRow[]) => void) | null = null;
  function Capture() {
    const ctx = useContext(StubContext);
    if (ctx === null) throw new Error('no stub context');
    captured = ctx.emit;
    return null;
  }
  render(
    <StubProvider>
      <Capture />
      <TournamentToast />
    </StubProvider>,
  );
  if (captured === null) throw new Error('emit not captured');
  return { emit: captured };
}

function makeRow(
  id: string,
  type: string,
  extra: Record<string, unknown> = {},
): ActivityRow {
  return {
    id,
    createdAt: Date.now(),
    event: {
      type,
      eventId: 'evt-test-0001',
      ...extra,
    },
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TournamentToast — qualifying-type filter', () => {
  it('renders a toast for press.auto_fired', () => {
    const { emit } = renderWithEmitter();
    act(() => {
      emit([
        makeRow('row-1', 'press.auto_fired', {
          triggerHole: 5,
          team: 'teamA',
          multiplier: 2,
          trigger: 'down_2',
        }),
      ]);
    });
    expect(screen.getByTestId('tournament-toast-stack')).toBeInTheDocument();
    expect(screen.getAllByTestId('tournament-toast-entry')).toHaveLength(1);
  });

  it('renders for score.committed only when isBirdieOrBetter=true', () => {
    const { emit } = renderWithEmitter();
    act(() => {
      emit([
        makeRow('row-1', 'score.committed', {
          isBirdieOrBetter: false,
          grossStrokes: 5,
          holeNumber: 7,
          par: 4,
          toPar: 1,
          playerId: 'p1',
          scorerPlayerId: 'p1',
          roundId: 'r1',
        }),
        makeRow('row-2', 'score.committed', {
          isBirdieOrBetter: true,
          grossStrokes: 3,
          holeNumber: 7,
          par: 4,
          toPar: -1,
          playerId: 'p2',
          scorerPlayerId: 'p2',
          roundId: 'r1',
        }),
      ]);
    });
    const entries = screen.getAllByTestId('tournament-toast-entry');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.textContent).toMatch(/birdie/i);
  });

  it('ignores non-qualifying types like rule_set.revised', () => {
    const { emit } = renderWithEmitter();
    act(() => {
      emit([
        makeRow('row-1', 'rule_set.revised', {
          ruleSetId: 'rs',
          revisionId: 'rsr',
        }),
      ]);
    });
    expect(screen.queryByTestId('tournament-toast-stack')).toBeNull();
  });
});

describe('TournamentToast — stack rendering', () => {
  it('stacks multiple toasts in the order they arrived', () => {
    const { emit } = renderWithEmitter();
    act(() => {
      emit([
        makeRow('row-1', 'press.manual_fired', {
          fromHole: 5,
          team: 'teamA',
          multiplier: 2,
          filedByPlayerId: 'p1',
          roundId: 'r1',
        }),
      ]);
    });
    act(() => {
      emit([
        makeRow('row-2', 'award.triggered', {
          awardType: 'first_birdie_of_event',
          playerId: 'p2',
          context: { holeNumber: 7, grossStrokes: 3, par: 4 },
        }),
      ]);
    });
    const entries = screen.getAllByTestId('tournament-toast-entry');
    expect(entries).toHaveLength(2);
    expect(entries[0]!.textContent).toMatch(/pressed/i);
    expect(entries[1]!.textContent).toMatch(/eagle|birdie/i);
  });

  it('dedupes by rowId — same row arriving twice produces one toast', () => {
    const { emit } = renderWithEmitter();
    const row = makeRow('row-1', 'press.auto_fired', {
      triggerHole: 5,
      team: 'teamA',
      multiplier: 2,
      trigger: 'down_2',
    });
    act(() => emit([row]));
    act(() => emit([row]));
    expect(screen.getAllByTestId('tournament-toast-entry')).toHaveLength(1);
  });
});

describe('TournamentToast — auto-dismiss', () => {
  it('removes a toast after its 6-second TTL elapses', () => {
    vi.useFakeTimers();
    const { emit } = renderWithEmitter();
    act(() => {
      emit([
        makeRow('row-1', 'press.auto_fired', {
          triggerHole: 5,
          team: 'teamA',
          multiplier: 2,
          trigger: 'down_2',
        }),
      ]);
    });
    expect(screen.getAllByTestId('tournament-toast-entry')).toHaveLength(1);
    // Advance past the 6s TTL plus one polling tick (500ms granularity).
    act(() => {
      vi.advanceTimersByTime(7_000);
    });
    expect(screen.queryByTestId('tournament-toast-entry')).toBeNull();
    expect(screen.queryByTestId('tournament-toast-stack')).toBeNull();
  });
});
