/**
 * T7-2 schedule view.
 *
 * Route: /events/:eventId/schedule
 *
 * Renders one card per round (ordered by roundNumber), grouped by
 * roundDate (exact equality). Each card shows: course name + clubName,
 * tee color, holes-to-play chip, viewer's pairing (3-state discriminated
 * union from API: foursome / no_pairings_set / viewer_not_in_foursome).
 *
 * Date formatting uses event.timezone (NOT viewer's local) via
 * Intl.DateTimeFormat — `EEEE, MMMM d` so trip-day names are unambiguous.
 *
 * Auth: leaderboard pattern — beforeLoad redirects anonymous; data fetch
 * 403 → inline forbidden card.
 *
 * Dual-export: `Route` + `SchedulePage` for direct test rendering.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';

// ---- Types ----------------------------------------------------------------

type PairingMember = {
  playerId: string;
  name: string;
  handicapIndex: number;
  isViewer: boolean;
  /** Per-player tee override; null → uses round.teeColor as default. */
  teeColor: string | null;
};

type PairingState =
  | { kind: 'foursome'; foursomeNumber: number; members: PairingMember[] }
  | { kind: 'no_pairings_set' }
  | { kind: 'viewer_not_in_foursome' };

type ScheduleResponse = {
  event: { id: string; name: string; timezone: string };
  rounds: Array<{
    id: string;
    /** Runtime rounds.id (null until /admin/event-rounds/:id/start has run). */
    runtimeRoundId: string | null;
    roundNumber: number;
    roundDate: number;
    holesToPlay: 9 | 18;
    teeColor: string;
    course: { id: string; name: string; clubName: string };
    pairing: PairingState;
  }>;
};

type FetchOutcome =
  | { kind: 'ok'; data: ScheduleResponse }
  | { kind: 'forbidden' };

// ---- Auth-status loader (mirror leaderboard) ------------------------------


// ---- Schedule fetcher -----------------------------------------------------

async function fetchSchedule(eventId: string): Promise<FetchOutcome> {
  const res = await fetch(`/api/events/${eventId}/schedule`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) throw new Error(`schedule_fetch_failed_${res.status}`);
  const body = (await res.json()) as ScheduleResponse;
  return { kind: 'ok', data: body };
}

// ---- Helpers --------------------------------------------------------------

/**
 * Group rounds by exact `roundDate` equality. Within a group, preserve
 * input order (rounds arrive sorted by roundNumber asc). Returns groups
 * in chronological roundDate order.
 *
 * Pure for testability.
 */
export function groupRoundsByDate<R extends { roundDate: number }>(
  rounds: R[],
): Array<{ roundDate: number; rounds: R[] }> {
  const map = new Map<number, R[]>();
  for (const r of rounds) {
    const list = map.get(r.roundDate) ?? [];
    list.push(r);
    map.set(r.roundDate, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([roundDate, rs]) => ({ roundDate, rounds: rs }));
}

/**
 * Format a date in the event's IANA timezone. `EEEE, MMMM d` — e.g.,
 * "Friday, May 8". `Intl.DateTimeFormat` throws on invalid timezone;
 * the spec trusts T3-2 admin validation, so we don't catch.
 */
function formatScheduleDate(roundDate: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(roundDate);
}

// ---- Component ------------------------------------------------------------

export type SchedulePageProps = { eventId: string };

export function SchedulePage({ eventId }: SchedulePageProps) {
  const query = useQuery<FetchOutcome>({
    queryKey: ['eventSchedule', eventId],
    queryFn: () => fetchSchedule(eventId),
    refetchOnWindowFocus: true,
  });

  if (query.isPending) {
    return (
      <PageShell title="Schedule">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Schedule">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard
          title="Couldn't load the schedule."
          error={query.error}
          onRetry={query.refetch}
        />
      </PageShell>
    );
  }
  const outcome = query.data!;
  if (outcome.kind === 'forbidden') {
    return (
      <PageShell title="Schedule">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard
          title="Not a participant"
          error="You aren't a participant in this event."
        />
      </PageShell>
    );
  }

  const { event, rounds } = outcome.data;
  if (rounds.length === 0) {
    return (
      <PageShell title="Schedule">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <EmptyState icon="📅" title="No rounds scheduled yet." />
      </PageShell>
    );
  }

  const groups = groupRoundsByDate(rounds);

  return (
    <PageShell title="Schedule">
      <BackLink to="/events/$eventId" params={{ eventId }} />
      {groups.map((g) => (
        <section key={g.roundDate} aria-label={`Rounds on ${formatScheduleDate(g.roundDate, event.timezone)}`} style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: '1.05rem', margin: '12px 0 8px' }}>
            {formatScheduleDate(g.roundDate, event.timezone)}
          </h2>
          {g.rounds.map((r) => (
            <article
              key={r.id}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                  <strong>Round {r.roundNumber}</strong>
                  <span style={{ marginLeft: 8, color: 'var(--color-text-muted)' }}>
                    {`${r.course.name} · ${r.course.clubName}`}
                  </span>
                </div>
                <div style={{ fontSize: '0.85rem' }}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 12,
                      backgroundColor: 'var(--color-brand-tint)',
                      marginRight: 6,
                    }}
                  >
                    {r.holesToPlay} holes
                  </span>
                  <span style={{ color: 'var(--color-text-muted)' }}>{r.teeColor} tees</span>
                </div>
              </header>

              <div style={{ marginTop: 8 }}>
                <PairingBlock pairing={r.pairing} roundTeeColor={r.teeColor} />
              </div>

              {r.runtimeRoundId !== null && r.pairing.kind === 'foursome' ? (
                <div style={{ marginTop: 8 }}>
                  <a
                    href={`/rounds/${r.runtimeRoundId}/score-entry`}
                    style={{
                      display: 'inline-block',
                      padding: '8px 14px',
                      background: 'var(--color-brand-primary)',
                      color: '#fff',
                      borderRadius: 6,
                      textDecoration: 'none',
                      fontWeight: 600,
                    }}
                    data-testid={`schedule-score-link-${r.id}`}
                  >
                    Score this round →
                  </a>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ))}
    </PageShell>
  );
}

function PairingBlock({
  pairing,
  roundTeeColor,
}: {
  pairing: PairingState;
  roundTeeColor: string;
}) {
  // Exhaustive discriminated-union switch (codex impl finding M #3).
  switch (pairing.kind) {
    case 'no_pairings_set':
      return <p style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Pairings not set yet</p>;
    case 'viewer_not_in_foursome':
      return (
        <p style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          You&apos;re not in a foursome this round
        </p>
      );
    case 'foursome':
      return (
        <ul
          aria-label={`Foursome ${pairing.foursomeNumber} roster`}
          style={{ listStyle: 'none', padding: 0, margin: 0 }}
        >
          {pairing.members.map((m) => {
            // Effective tee = per-player override OR round default. Render
            // an override chip in a distinct color so non-default tees jump
            // out (Judd-on-forward case is the trip-day reason this exists).
            const effectiveTee = m.teeColor ?? roundTeeColor;
            const isOverride = m.teeColor !== null && m.teeColor !== roundTeeColor;
            return (
              <li
                key={m.playerId}
                style={{
                  padding: '4px 8px',
                  backgroundColor: m.isViewer ? 'var(--color-brand-tint)' : 'transparent',
                  fontWeight: m.isViewer ? 'bold' : 'normal',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  flexWrap: 'wrap',
                }}
              >
                <span>
                  {m.name}{' '}
                  <span style={{ color: 'var(--color-text-muted)', fontWeight: 'normal' }}>
                    ({m.handicapIndex.toFixed(1)})
                  </span>
                </span>
                <span
                  data-testid={`schedule-tee-${m.playerId}`}
                  style={{
                    fontSize: '0.75em',
                    padding: '1px 6px',
                    borderRadius: 8,
                    backgroundColor: isOverride ? 'var(--color-warning-bg)' : 'var(--color-surface-sunken)',
                    color: isOverride ? 'var(--color-warning-text)' : 'var(--color-text-secondary)',
                    fontWeight: 'normal',
                  }}
                  title={
                    isOverride
                      ? `Playing ${effectiveTee} (round default: ${roundTeeColor})`
                      : `Round default tee: ${effectiveTee}`
                  }
                >
                  {effectiveTee}
                </span>
              </li>
            );
          })}
        </ul>
      );
    default: {
      // Compile-time exhaustiveness check — if a new kind is added to the
      // PairingState union without a case branch, TS errors here.
      const _exhaustive: never = pairing;
      void _exhaustive;
      return null;
    }
  }
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/events/$eventId/schedule')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <SchedulePage eventId={eventId} />;
}
