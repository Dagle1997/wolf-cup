/**
 * T8-2 ActivityFeedProvider tests.
 *
 * Coverage:
 *   - Burst-drop loop: 250-row queue is consumed across 3 server-page
 *     fetches inside ONE queryFn invocation (no waiting for the 5s tick).
 *   - Singleton invariant: mounting Toast + Banner + a synthetic feed
 *     consumer produces exactly ONE query in the TanStack Query cache.
 *   - Subscriber ordering: handlers receive new rows in ASC chronological
 *     order even though rows[] is stored DESC for display.
 *   - Bootstrap-then-live transition: first fetch is paramless GET,
 *     subsequent fetches use ?after=<cursor>.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  render,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';

import {
  ActivityFeedProvider,
  type ActivityRow,
  type ActivityResponse,
} from './activity-feed-provider';
import {
  useActivityFeed,
  useActivityStream,
} from '../hooks/use-activity-feed';

const TEST_EVENT_ID = 'evt-test-1234567890ab';

// ---- Helpers --------------------------------------------------------------

function makeRow(seq: number, createdAt: number): ActivityRow {
  return {
    id: `row-${seq.toString().padStart(8, '0')}-uuid`,
    createdAt,
    event: {
      type: 'gallery.uploaded',
      eventId: TEST_EVENT_ID,
      actorPlayerId: 'plr-actor',
      photoId: `ph-${seq}`,
    },
  };
}

function encodeCursor(o: { createdAt: number; id: string }): string {
  return Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
}

function buildClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}

function Wrapper({ qc, children }: { qc: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={qc}>
      <ActivityFeedProvider eventIdOverride={TEST_EVENT_ID}>
        {children}
      </ActivityFeedProvider>
    </QueryClientProvider>
  );
}

// ---- Lifecycle -------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---- Singleton invariant ---------------------------------------------------

describe('ActivityFeedProvider — singleton invariant', () => {
  it('exactly ONE query in cache regardless of consumer count', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          rows: [makeRow(1, 1_000_000)],
          nextCursorAfter: encodeCursor({
            createdAt: 1_000_000,
            id: 'row-00000001-uuid',
          }),
          nextCursorBefore: encodeCursor({
            createdAt: 1_000_000,
            id: 'row-00000001-uuid',
          }),
        } satisfies ActivityResponse),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    function ConsumerA() {
      useActivityFeed();
      return <div data-testid="consumer-a" />;
    }
    function ConsumerB() {
      useActivityStream(() => undefined);
      return <div data-testid="consumer-b" />;
    }
    function ConsumerC() {
      useActivityStream(() => undefined);
      return <div data-testid="consumer-c" />;
    }

    const qc = buildClient();
    render(
      <Wrapper qc={qc}>
        <ConsumerA />
        <ConsumerB />
        <ConsumerC />
      </Wrapper>,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    // Cache invariant: exactly one query keyed on the activity prefix.
    const activityQueries = qc.getQueryCache().getAll().filter((q) => {
      const k = q.queryKey;
      return Array.isArray(k) && k[0] === 'activity';
    });
    expect(activityQueries).toHaveLength(1);
  });
});

// ---- Burst-drop loop -------------------------------------------------------

describe('ActivityFeedProvider — burst-drop loop', () => {
  it('consumes 250 server-side rows across 3 fetch cycles inside one queryFn invocation', async () => {
    // Build the 3-cycle response sequence.
    const cycle1Rows = Array.from({ length: 100 }, (_, i) =>
      makeRow(i + 1, 1_000_000 + (i + 1) * 10),
    );
    const cycle2Rows = Array.from({ length: 100 }, (_, i) =>
      makeRow(i + 101, 1_000_000 + (i + 101) * 10),
    );
    const cycle3Rows = Array.from({ length: 50 }, (_, i) =>
      makeRow(i + 201, 1_000_000 + (i + 201) * 10),
    );

    let callCount = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      callCount++;
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      let rows: ActivityRow[];
      let nextCursorAfter: string;
      if (!url.includes('after=')) {
        // Bootstrap call — return cycle1 (DESC; reverse of build order).
        rows = [...cycle1Rows].reverse();
        nextCursorAfter = encodeCursor({
          createdAt: rows[0]!.createdAt,
          id: rows[0]!.id,
        });
      } else if (callCount === 2) {
        rows = cycle2Rows;
        nextCursorAfter = encodeCursor({
          createdAt: rows[rows.length - 1]!.createdAt,
          id: rows[rows.length - 1]!.id,
        });
      } else {
        rows = cycle3Rows;
        // <100 rows on cycle 3 — the loop should terminate AFTER this.
        nextCursorAfter = encodeCursor({
          createdAt: rows[rows.length - 1]!.createdAt,
          id: rows[rows.length - 1]!.id,
        });
      }
      return new Response(
        JSON.stringify({
          rows,
          nextCursorAfter,
          nextCursorBefore: encodeCursor({
            createdAt: rows[rows.length - 1]!.createdAt,
            id: rows[rows.length - 1]!.id,
          }),
        } satisfies ActivityResponse),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    function FeedReader({ onRows }: { onRows: (n: number) => void }) {
      const { rows } = useActivityFeed();
      const lastReportedRef = useRef(-1);
      useEffect(() => {
        if (rows.length !== lastReportedRef.current) {
          lastReportedRef.current = rows.length;
          onRows(rows.length);
        }
      }, [rows.length, onRows]);
      return null;
    }

    const seenLengths: number[] = [];
    const qc = buildClient();
    render(
      <Wrapper qc={qc}>
        <FeedReader onRows={(n) => seenLengths.push(n)} />
      </Wrapper>,
    );
    // After the bootstrap-with-burst-drop completes, all 250 rows are
    // accumulated in a SINGLE queryFn invocation (3 fetch cycles).
    await waitFor(
      () => {
        expect(fetch).toHaveBeenCalledTimes(3);
      },
      { timeout: 3_000 },
    );
    await waitFor(() => {
      const last = seenLengths[seenLengths.length - 1];
      expect(last).toBe(250);
    });
  });
});

// ---- Subscriber ordering ---------------------------------------------------

describe('ActivityFeedProvider — subscriber ordering', () => {
  it('subscribers receive new rows in ASC chronological order', async () => {
    // Bootstrap returns 3 rows DESC (newest first per backend contract).
    const r1 = makeRow(1, 1_000);
    const r2 = makeRow(2, 2_000);
    const r3 = makeRow(3, 3_000);
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          rows: [r3, r2, r1], // DESC
          nextCursorAfter: encodeCursor({ createdAt: 3_000, id: r3.id }),
          nextCursorBefore: encodeCursor({ createdAt: 1_000, id: r1.id }),
        } satisfies ActivityResponse),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const handlerArgs: ActivityRow[][] = [];
    function Subscriber() {
      useActivityStream((rows) => {
        handlerArgs.push(rows);
      });
      return null;
    }

    const qc = buildClient();
    render(
      <Wrapper qc={qc}>
        <Subscriber />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(handlerArgs.length).toBeGreaterThan(0);
    });
    // The handler must have been called with rows in ASC order even though
    // the server delivered DESC.
    const firstCall = handlerArgs[0]!;
    expect(firstCall.map((r) => r.createdAt)).toEqual([1_000, 2_000, 3_000]);
  });
});
