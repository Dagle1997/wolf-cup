/**
 * T8-2 ActivityFeedProvider — single root-mounted provider that drives
 * the live polling subscription for the current event. Exposes rows +
 * cursor state via React context. Toast, Banner, and (future T8-3)
 * Feed all read from this ONE provider — no consumer instantiates its
 * own poll. (Singleton-poll invariant per AC #11.)
 *
 * Mounts at __root.tsx; reads `eventId` from URL via the same
 * extractEventIdFromLocation pattern T7-6's install-prompt-host uses.
 * Renders children with empty stream when no eventId is present.
 *
 * Cursor + bootstrapped flag live in refs (NOT state) so updating them
 * does NOT change the queryKey. Stable `queryKey: ['activity', eventId]`
 * is the load-bearing piece for the singleton invariant — every cursor
 * change re-keying the query would create a new TanStack Query
 * subscription per advance, defeating the singleton design.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';

// ---- Types (mirror tournament-api's ActivityRow / ActivityResponse) ------

export type ActivityRow = {
  id: string;
  createdAt: number;
  // event is the typed discriminated-union payload from T8-1's
  // engine/types/activity-events.ts on the backend. We treat it as
  // a structurally-typed object on the frontend (no shared package
  // yet); consumers narrow on `event.type` before reading variant
  // fields.
  event: {
    type: string;
    eventId: string;
    roundId?: string;
    actorPlayerId?: string;
    [key: string]: unknown;
  };
};

export type ActivityResponse = {
  rows: ActivityRow[];
  nextCursorAfter: string | null;
  nextCursorBefore: string | null;
};

// ---- Context shape --------------------------------------------------------

type ActivityFeedContextValue = {
  rows: ActivityRow[];                // newest-first DESC
  cursorBefore: string | null;
  isPolling: boolean;
  error: Error | null;
  subscribe: (handler: (newRows: ActivityRow[]) => void) => () => void;
  loadMore: () => Promise<void>;
};

const ActivityFeedContext = createContext<ActivityFeedContextValue | null>(null);

// ---- URL eventId detection ------------------------------------------------
// Mirrors __root.tsx's extractEventIdFromLocation regex. 16-128 chars,
// [A-Za-z0-9_-], boundary-anchored.

const EVENT_ID_RE = /\/events\/([A-Za-z0-9_-]{16,128})(?=\/|$)/;
function extractEventIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(EVENT_ID_RE);
  if (!m) return null;
  return m[1] ?? null;
}

// ---- Burst-drop fetch loop (single in-flight cycle per queryFn invocation) -

const PAGE_LIMIT = 100;
const MAX_BURST_ITERATIONS = 3;

async function fetchActivityWithBurstDrop(
  eventId: string,
  initialAfterCursor: string | null,
  bootstrapped: boolean,
): Promise<{
  newRows: ActivityRow[];          // accumulated across all burst iterations, ASC
  finalAfterCursor: string | null;
  finalBeforeCursor: string | null;
}> {
  const accumulated: ActivityRow[] = [];
  let cursor = initialAfterCursor;
  let beforeCursor: string | null = null;
  let actuallyBootstrapped = bootstrapped;

  for (let i = 0; i < MAX_BURST_ITERATIONS; i++) {
    const url =
      actuallyBootstrapped && cursor !== null
        ? `/api/events/${eventId}/activity?after=${encodeURIComponent(cursor)}`
        : `/api/events/${eventId}/activity`;
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) {
      throw new Error(
        `activity fetch failed: ${res.status} ${res.statusText}`,
      );
    }
    const body = (await res.json()) as ActivityResponse;
    accumulated.push(...body.rows);
    actuallyBootstrapped = true;
    // Capture beforeCursor on the bootstrap response only — for T8-3 backfill.
    if (beforeCursor === null) beforeCursor = body.nextCursorBefore;

    const advanced = body.nextCursorAfter !== null && body.nextCursorAfter !== cursor;
    cursor = body.nextCursorAfter;

    // Terminus: response under page limit OR cursor did not advance.
    if (body.rows.length < PAGE_LIMIT || !advanced) break;
  }

  return {
    newRows: accumulated,
    finalAfterCursor: cursor,
    finalBeforeCursor: beforeCursor,
  };
}

// ---- Provider component ---------------------------------------------------

export type ActivityFeedProviderProps = {
  children: ReactNode;
  // Optional override (used by tests). Production reads URL.
  eventIdOverride?: string | null;
};

export function ActivityFeedProvider({
  children,
  eventIdOverride,
}: ActivityFeedProviderProps) {
  const [eventId, setEventId] = useState<string | null>(() =>
    eventIdOverride !== undefined ? eventIdOverride : extractEventIdFromLocation(),
  );

  // Re-detect eventId on path changes. Lightweight popstate listener;
  // most navigations are TanStack Router pushState which doesn't fire
  // popstate, so we also re-detect on a 1s interval as a defensive
  // fallback. (Production: TanStack Router's useLocation hook would
  // be cleaner, but pulling that in adds a dep coupling the provider
  // to a specific router. The polling fallback keeps the provider
  // router-agnostic at the cost of ≤1s latency on event-route entry.)
  useEffect(() => {
    if (eventIdOverride !== undefined) return;
    const update = () => {
      const next = extractEventIdFromLocation();
      setEventId((prev) => (prev === next ? prev : next));
    };
    window.addEventListener('popstate', update);
    const id = window.setInterval(update, 1_000);
    return () => {
      window.removeEventListener('popstate', update);
      window.clearInterval(id);
    };
  }, [eventIdOverride]);

  // Rows accumulated newest-first (DESC).
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [cursorBefore, setCursorBefore] = useState<string | null>(null);

  // Refs for cursor + bootstrap flag — kept OUT of state/queryKey so
  // their changes do NOT trigger re-subscription (singleton invariant).
  const afterCursorRef = useRef<string | null>(null);
  const bootstrappedRef = useRef(false);
  const subscribersRef = useRef<Set<(newRows: ActivityRow[]) => void>>(new Set());

  // Reset state when eventId changes (event navigation).
  useEffect(() => {
    setRows([]);
    setCursorBefore(null);
    afterCursorRef.current = null;
    bootstrappedRef.current = false;
  }, [eventId]);

  const subscribe = useCallback(
    (handler: (newRows: ActivityRow[]) => void) => {
      subscribersRef.current.add(handler);
      return () => {
        subscribersRef.current.delete(handler);
      };
    },
    [],
  );

  // Track the "live" eventId for the queryFn to compare against on
  // resolution — guards against a navigation race where the user
  // navigates from event A to event B mid-fetch, and A's response
  // would otherwise leak into B's state. (codex party-codex round-1 High #1.)
  const liveEventIdRef = useRef<string | null>(eventId);
  useEffect(() => {
    liveEventIdRef.current = eventId;
  }, [eventId]);

  const query = useQuery<ActivityResponse | null, Error>({
    // STABLE queryKey across cursor advances — load-bearing for
    // singleton invariant.
    queryKey: ['activity', eventId ?? '__no_event__'],
    queryFn: async () => {
      if (eventId === null) return null;
      const fetchEventId = eventId; // capture at start
      const { newRows, finalAfterCursor, finalBeforeCursor } =
        await fetchActivityWithBurstDrop(
          fetchEventId,
          afterCursorRef.current,
          bootstrappedRef.current,
        );
      // Drop side effects if the eventId changed mid-flight (user
      // navigated). The fresh provider for the new eventId will run
      // its own queryFn and accumulate the right rows.
      if (liveEventIdRef.current !== fetchEventId) {
        return null;
      }
      // Update refs (cursor advancement) — does NOT change queryKey.
      if (finalAfterCursor !== null) afterCursorRef.current = finalAfterCursor;
      // Capture cursorBefore the FIRST time it transitions to non-null
      // (codex impl-codex round-1 Med #3). The earlier "only on
      // bootstrap" guard meant a bootstrap that returned an empty
      // event would lock cursorBefore at null forever — even after
      // activity arrived in subsequent polls — breaking T8-3's later
      // backfill readiness.
      setCursorBefore((prev) => (prev !== null ? prev : finalBeforeCursor));
      bootstrappedRef.current = true;

      // Merge newRows into rows[]. newRows from burst-drop are accumulated
      // ACROSS all iterations: bootstrap (DESC) OR live polls (ASC).
      // For a clean newest-first display we sort the accumulated rows
      // descending here; for subscriber fan-out we re-sort ASC.
      if (newRows.length > 0) {
        setRows((prev) => {
          // Dedupe by id (defensive; cursor pagination shouldn't produce
          // duplicates, but a refetch race could).
          const seen = new Set(prev.map((r) => r.id));
          const fresh = newRows.filter((r) => !seen.has(r.id));
          if (fresh.length === 0) return prev;
          return [...fresh, ...prev].sort((a, b) =>
            b.createdAt !== a.createdAt
              ? b.createdAt - a.createdAt
              : b.id.localeCompare(a.id),
          );
        });
        // Subscriber fan-out: ASC chronological order.
        const ascForSubscribers = [...newRows].sort((a, b) =>
          a.createdAt !== b.createdAt
            ? a.createdAt - b.createdAt
            : a.id.localeCompare(b.id),
        );
        for (const handler of subscribersRef.current) {
          handler(ascForSubscribers);
        }
      }
      return {
        rows: newRows,
        nextCursorAfter: finalAfterCursor,
        nextCursorBefore: finalBeforeCursor,
      };
    },
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    enabled: eventId !== null,
    retry: false,
  });

  const loadMore = useCallback(async () => {
    // T8-3 will use this to backfill via ?before=. Stub for v1 — T8-3
    // wires up the actual call.
    if (eventId === null || cursorBefore === null) return;
    const url = `/api/events/${eventId}/activity?before=${encodeURIComponent(cursorBefore)}`;
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`backfill failed: ${res.status}`);
    const body = (await res.json()) as ActivityResponse;
    if (body.rows.length === 0) {
      // No older history left. Lock cursorBefore to null so subsequent
      // loadMore() calls short-circuit at the early return above —
      // prevents an infinite-request loop if the UI mashes "Load more"
      // at the end of history (codex party-codex round-1 Med #2).
      setCursorBefore(null);
      return;
    }
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      const fresh = body.rows.filter((r) => !seen.has(r.id));
      return [...prev, ...fresh].sort((a, b) =>
        b.createdAt !== a.createdAt
          ? b.createdAt - a.createdAt
          : b.id.localeCompare(a.id),
      );
    });
    // Always update cursorBefore from the response — non-null on this
    // path because rows.length > 0 means the page has anchor rows for
    // both directions.
    if (body.nextCursorBefore !== null) {
      setCursorBefore(body.nextCursorBefore);
    }
  }, [eventId, cursorBefore]);

  const value: ActivityFeedContextValue = {
    rows,
    cursorBefore,
    isPolling: query.isFetching,
    error: query.error ?? null,
    subscribe,
    loadMore,
  };

  return (
    <ActivityFeedContext.Provider value={value}>
      {children}
    </ActivityFeedContext.Provider>
  );
}

export function useActivityFeedContext(): ActivityFeedContextValue {
  const ctx = useContext(ActivityFeedContext);
  if (ctx === null) {
    throw new Error('must be within ActivityFeedProvider');
  }
  return ctx;
}
