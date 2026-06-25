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
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { ActivityFeed } from '../components/activity-feed';
import { PageShell } from '../components/page-shell';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';

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
  /** Viewer's display name (auth status omits it). Null → "friend". */
  viewerName?: string | null;
  /** The in-progress scoring round, if any — powers the "Enter scores" CTA. */
  liveRound?: {
    roundId: string;
    eventRoundId: string;
    roundNumber: number;
  } | null;
  /** True when this event is in live-money mode — gates the Money vs My Money card. */
  moneyEnabled?: boolean;
};

type FetchOutcome =
  | { kind: 'ok'; data: EventDetailResponse }
  | { kind: 'forbidden' };

const SCHEDULE_CARD = {
  to: '/events/$eventId/schedule' as const,
  icon: '📅',
  title: 'Schedule',
  desc: 'Rounds, courses, your foursome, your tee',
};

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
  /** When true, render the organizer-only "Admin tools" link at the bottom. */
  isOrganizer?: boolean;
};

// Consolidated home cards. The old screen listed nine cards — three standings
// views (Leaderboard / Team / Match) and four money views (My Money / Money /
// Bets / Settle Up) — all at once. They're now folded into two hubs reached by
// one card each, with Wolf-style tabs at the top of each hub to switch views.
// The Money vs My Money card swaps on `moneyEnabled` (live-money event vs a
// scores-only event where only your private figures exist).
const STANDINGS_CARD = { to: '/events/$eventId/leaderboard' as const, icon: '🏆', title: 'Standings', desc: 'Leaderboard, teams & match play' };
const MONEY_CARD = { to: '/events/$eventId/money' as const, icon: '💰', title: 'Money', desc: 'The board, your P&L & settle-up' };
const MY_MONEY_CARD = { to: '/events/$eventId/my-money' as const, icon: '💰', title: 'My Money', desc: 'Your private running total' };
const BETS_CARD = { to: '/events/$eventId/action' as const, icon: '🎲', title: 'The Action', desc: 'Post a bet & watch the board' };
const PHOTOS_CARD = { to: '/events/$eventId/gallery' as const, icon: '📸', title: 'Photos', desc: 'Trip photos' };

function buildEntryCards(moneyEnabled: boolean) {
  return [
    SCHEDULE_CARD,
    STANDINGS_CARD,
    moneyEnabled ? MONEY_CARD : MY_MONEY_CARD,
    BETS_CARD,
    PHOTOS_CARD,
  ];
}

export function EventHomePage({ eventId, viewerName, nowMs, isOrganizer }: EventHomePageProps) {
  const query = useQuery<FetchOutcome>({
    queryKey: ['eventDetail', eventId],
    queryFn: () => fetchEvent(eventId),
    refetchOnWindowFocus: true,
  });

  if (query.isPending) {
    return (
      <PageShell title="Event">
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Event">
        <ErrorCard
          title="Couldn't load the event."
          error={query.error}
          onRetry={query.refetch}
        />
      </PageShell>
    );
  }
  const outcome = query.data!;
  if (outcome.kind === 'forbidden') {
    return (
      <PageShell title="Event">
        <ErrorCard
          title="Not a participant"
          error="You aren't a participant in this event."
        />
      </PageShell>
    );
  }

  const { event, rounds, liveRound } = outcome.data;
  const cards = buildEntryCards(outcome.data.moneyEnabled ?? false);
  const now = nowMs ?? Date.now();
  // When a round is actually in progress (API returns liveRound), the hero
  // must lead with the live state — never a "starts in N days" countdown.
  // A round can be live while its scheduled roundDate is still in the future
  // (organizer started it early), which would otherwise read as a confusing
  // future-date countdown even though scoring is live. The live CTA below
  // remains the primary action; this only fixes the hero headline.
  const countdown = liveRound
    ? `Round ${liveRound.roundNumber} is live`
    : computeCountdown(rounds, now);
  const dateRange = formatDateRange(event.startDate, event.endDate, event.timezone);
  // Real name from the API takes precedence; the `viewerName` prop is a test seam.
  const greetName = outcome.data.viewerName ?? viewerName;

  return (
    <PageShell title={event.name}>
      {/* Back to the events list. A PLAIN full-reload anchor (not a client Link):
          (1) it can't silently no-op if the PWA holds mismatched cached chunks,
          and (2) `?list=1` tells the landing NOT to auto-bounce back into a lone
          active event (which made a client Link a flash-reload). Josh 2026-06-25. */}
      <a
        href="/?list=1"
        data-testid="event-home-all-events"
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 'var(--font-sm)',
          textDecoration: 'none',
          display: 'inline-block',
          marginBottom: 8,
        }}
      >
        ← All events
      </a>
      {/* Hero: date range + the one line that says "what's next". */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, var(--color-brand-primary), var(--color-brand-strong))',
          color: '#fff',
          padding: 'var(--space-4) var(--space-5)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <div style={{ fontSize: 'var(--font-sm)', opacity: 0.9 }}>{dateRange}</div>
        <div data-testid="event-home-hero-status" style={{ marginTop: 4, fontSize: 'var(--font-lg)', fontWeight: 800 }}>{countdown}</div>
        <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--font-sm)', opacity: 0.95, wordBreak: 'break-word' }}>
          <span aria-hidden>✓ </span>You&apos;re in, {firstName(greetName)}.
        </div>
      </div>

      {/* Live round → the one action that matters mid-event: enter scores. */}
      {liveRound ? (
        <Link
          to="/rounds/$roundId/score-entry"
          params={{ roundId: liveRound.roundId }}
          data-testid="event-home-live-cta"
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            minHeight: 'var(--control-height-lg)',
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-4)',
            textDecoration: 'none',
            color: 'var(--color-on-accent)',
            background: 'var(--color-accent)',
            fontWeight: 700,
          }}
        >
          <span aria-hidden style={{ fontSize: '1.25rem' }}>●</span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 'var(--font-md)' }}>Round {liveRound.roundNumber} is live</span>
            <span style={{ fontSize: 'var(--font-sm)', opacity: 0.95, fontWeight: 400 }}>Tap to enter scores</span>
          </span>
          <span aria-hidden>→</span>
        </Link>
      ) : null}

      <nav aria-label="Event sections">
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--space-2)' }}>
          {cards.map((card) => (
            <li key={card.to}>
              <Link
                to={card.to}
                params={{ eventId }}
                className="card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  minHeight: 'var(--control-height-lg)',
                  padding: 'var(--space-3) var(--space-4)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <span aria-hidden style={{ fontSize: '1.5rem', lineHeight: 1, width: '1.5rem', textAlign: 'center', flexShrink: 0 }}>{card.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: 'block', fontSize: 'var(--font-md)', wordBreak: 'break-word' }}>{card.title}</strong>
                  <span style={{ display: 'block', fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)', wordBreak: 'break-word' }}>{card.desc}</span>
                </span>
                <span aria-hidden style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>›</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {isOrganizer === true ? (
        <div
          className="card"
          style={{
            marginTop: 'var(--space-4)',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-surface-sunken)',
          }}
        >
          <strong style={{ display: 'block', marginBottom: 4, fontSize: 'var(--font-sm)', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>Admin tools</strong>
          <Link
            to="/admin/events/$eventId"
            params={{ eventId }}
            data-testid="event-home-admin-link"
          >
            Manage event → pairings, roster, sub-games, courses
          </Link>
        </div>
      ) : null}

      {/* T8-3: "What's Happening" feed reads from the root-mounted T8-2
          ActivityFeedProvider context. eventId is detected from URL by
          the provider; no props needed here. */}
      <div style={{ marginTop: 24 }}>
        <ActivityFeed />
      </div>
    </PageShell>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/events/$eventId/')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  const ctx = Route.useRouteContext();
  // T11-2: the viewerName branch was dead — /api/auth/status never returns
  // a `name` field (verified: returns {id, isOrganizer, ghin,
  // manualHandicapIndex}), so ctx.player.name was always undefined. The
  // shared requireAuthOrRedirect returns {id, isOrganizer}; viewerName is
  // simply omitted (EventHomePage's viewerName prop is optional).
  const props: EventHomePageProps = { eventId, isOrganizer: ctx.player.isOrganizer };
  return <EventHomePage {...props} />;
}
