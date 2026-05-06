/**
 * T7-1 Event home page (minimal v1).
 *
 * Route: /events/:eventId
 *
 * Renders hero (name + date range + countdown), greeting row, and 4
 * entry cards (Leaderboard, Money, Bets, Settle-up). Countdown computed
 * once at render — no ticker (followup T7-1a).
 *
 * Auth chain mirrors leaderboard/money/bets:
 *  - beforeLoad: anonymous → redirect to /api/auth/google.
 *  - data fetch: 403 → inline forbidden card.
 *
 * Time-semantics convention (per spec):
 *  - event.startDate / endDate / round.roundDate are ms-since-epoch
 *    encoding local-day-start (midnight) in event.timezone.
 *  - All formatting uses Intl.DateTimeFormat with timeZone: event.timezone.
 *
 * Dual-export: `Route` + `EventHomePage` for direct test rendering.
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../lib/query-client';
import { ActivityFeed } from '../components/activity-feed';

// ---- Types ----------------------------------------------------------------

type EventDetailResponse = {
  event: {
    id: string;
    name: string;
    startDate: number;
    endDate: number;
    timezone: string;
  };
  rounds: Array<{
    id: string;
    roundNumber: number;
    roundDate: number;
    holesToPlay: 9 | 18;
  }>;
};

type FetchOutcome =
  | { kind: 'ok'; data: EventDetailResponse }
  | { kind: 'forbidden' };

// ---- Auth-status loader (mirror leaderboard) ------------------------------

type AuthStatus = { player: null | { id: string; isOrganizer: boolean; name?: string } };

function validateAuthStatus(body: unknown): AuthStatus {
  if (body === null || typeof body !== 'object') return { player: null };
  const p = (body as { player?: unknown }).player;
  if (p === null) return { player: null };
  if (
    p !== null &&
    typeof p === 'object' &&
    typeof (p as { id?: unknown }).id === 'string' &&
    typeof (p as { isOrganizer?: unknown }).isOrganizer === 'boolean'
  ) {
    const obj = p as { id: string; isOrganizer: boolean; name?: unknown };
    return {
      player: {
        id: obj.id,
        isOrganizer: obj.isOrganizer,
        ...(typeof obj.name === 'string' ? { name: obj.name } : {}),
      },
    };
  }
  return { player: null };
}

async function loadAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth/status').catch(() => null);
  if (res === null || !res.ok) return { player: null };
  const body = (await res.json().catch(() => null)) as unknown;
  if (body === null) return { player: null };
  return validateAuthStatus(body);
}

// ---- Event detail fetcher -------------------------------------------------

async function fetchEvent(eventId: string): Promise<FetchOutcome> {
  const res = await fetch(`/api/events/${eventId}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) throw new Error(`event_fetch_failed_${res.status}`);
  const body = (await res.json()) as EventDetailResponse;
  return { kind: 'ok', data: body };
}

// ---- Helpers --------------------------------------------------------------

const ONE_DAY_MS = 86_400_000;

function firstName(fullName: string | undefined): string {
  if (!fullName) return 'friend';
  const trimmed = fullName.trim();
  if (trimmed.length === 0) return 'friend';
  return trimmed.split(/\s+/)[0]!;
}

/**
 * Format a date range in the event's timezone. Omits the year if start
 * and end share the same year. Format: "May 8 – May 10".
 */
function formatDateRange(startMs: number, endMs: number, timeZone: string): string {
  const sameYear =
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(startMs) ===
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(endMs);
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { timeZone, month: 'short', day: 'numeric' }
    : { timeZone, month: 'short', day: 'numeric', year: 'numeric' };
  const fmt = new Intl.DateTimeFormat('en-US', opts);
  return `${fmt.format(startMs)} – ${fmt.format(endMs)}`;
}

/**
 * Compute countdown text from rounds + now. Pure — caller passes `now`.
 *
 * Cases:
 *  - Pre-event (now < first round): "Round 1 starts in N days" or
 *    "Round 1 starts today" if diff < 1 day.
 *  - Mid-event window (first round started, last round + 1 day not passed
 *    yet): "Round in progress" (state-flips deferred to T7-1e).
 *  - Post-event (now >= lastRoundDate + 1 day): "Event complete".
 */
export function computeCountdown(
  rounds: Array<{ roundNumber: number; roundDate: number }>,
  now: number,
): string {
  if (rounds.length === 0) return 'No rounds scheduled';
  const sorted = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);
  const last = sorted[sorted.length - 1]!;

  if (now >= last.roundDate + ONE_DAY_MS) {
    return 'Event complete';
  }

  // Find the next future round; if all are in the past, we're mid-event.
  const next = sorted.find((r) => r.roundDate > now);
  if (!next) {
    return 'Round in progress';
  }
  const diffMs = next.roundDate - now;
  if (diffMs < ONE_DAY_MS) {
    return `Round ${next.roundNumber} starts today`;
  }
  const days = Math.floor(diffMs / ONE_DAY_MS);
  return `Round ${next.roundNumber} starts in ${days} ${days === 1 ? 'day' : 'days'}`;
}

// ---- Component ------------------------------------------------------------

export type EventHomePageProps = {
  eventId: string;
  viewerName?: string;
  /** Test seam — pin "now" for deterministic countdown rendering. */
  nowMs?: number;
};

const ENTRY_CARDS = [
  { to: '/events/$eventId/leaderboard' as const, title: 'Leaderboard',    desc: 'See live standings' },
  { to: '/events/$eventId/money' as const,       title: 'Money',          desc: 'Head-to-head money matrix' },
  { to: '/events/$eventId/bets' as const,        title: 'Bets',           desc: 'Your bets' },
  { to: '/events/$eventId/settle-up' as const,   title: 'Settle Up',      desc: 'End-of-trip settle' },
  { to: '/events/$eventId/gallery' as const,     title: 'Photo Gallery',  desc: 'Trip photos' },
] as const;

export function EventHomePage({ eventId, viewerName, nowMs }: EventHomePageProps) {
  const query = useQuery<FetchOutcome>({
    queryKey: ['eventDetail', eventId],
    queryFn: () => fetchEvent(eventId),
    refetchOnWindowFocus: true,
  });

  if (query.isPending) {
    return (
      <div>
        <h1>Event</h1>
        <p>Loading…</p>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div>
        <h1>Event</h1>
        <p role="alert">Couldn&apos;t load the event. {String(query.error)}</p>
      </div>
    );
  }
  const outcome = query.data!;
  if (outcome.kind === 'forbidden') {
    return (
      <div>
        <h1>Event</h1>
        <p role="alert">You aren&apos;t a participant in this event.</p>
      </div>
    );
  }

  const { event, rounds } = outcome.data;
  const now = nowMs ?? Date.now();
  const countdown = computeCountdown(rounds, now);
  const dateRange = formatDateRange(event.startDate, event.endDate, event.timezone);

  return (
    <div>
      <header style={{ marginBottom: 16 }}>
        <h1>{event.name}</h1>
        <div style={{ color: '#555', fontSize: '0.95rem' }}>{dateRange}</div>
        <div style={{ marginTop: 4, fontWeight: 'bold' }}>{countdown}</div>
      </header>

      <p style={{ marginBottom: 16 }}>
        You&apos;re in, {firstName(viewerName)}.
      </p>

      <nav aria-label="Event sections">
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
          {ENTRY_CARDS.map((card) => (
            <li key={card.to}>
              <Link
                to={card.to}
                params={{ eventId }}
                style={{
                  display: 'block',
                  padding: 12,
                  border: '1px solid #ddd',
                  borderRadius: 8,
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <strong>{card.title}</strong>
                <div style={{ fontSize: '0.85rem', color: '#555' }}>{card.desc}</div>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* T8-3: "What's Happening" feed reads from the root-mounted T8-2
          ActivityFeedProvider context. eventId is detected from URL by
          the provider; no props needed here. */}
      <div style={{ marginTop: 24 }}>
        <ActivityFeed />
      </div>
    </div>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/events/$eventId/')({
  beforeLoad: async () => {
    const status = await queryClient.fetchQuery({
      queryKey: ['auth-status'],
      queryFn: loadAuthStatus,
      staleTime: 30_000,
      retry: false,
    });
    if (status.player === null) {
      window.location.assign('/api/auth/google');
      throw new Error('redirecting-to-oauth');
    }
    return { player: status.player };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  const ctx = Route.useRouteContext();
  const props: EventHomePageProps =
    ctx.player.name !== undefined
      ? { eventId, viewerName: ctx.player.name }
      : { eventId };
  return <EventHomePage {...props} />;
}
