/**
 * T6-8 bets page — per-pair live standings.
 *
 * Route: /events/:eventId/bets
 *
 * Polls `GET /api/events/:eventId/bets/mine` every 15s via TanStack
 * Query (matches leaderboard cadence). Auth guard mirrors leaderboard +
 * money pages. 403 → inline forbidden card.
 *
 * v1 limitations (per T6-8 spec):
 * - Organizer-as-non-party + organizer-wide listing deferred to T6-8a.
 * - Hole-by-hole scrub deferred to T6-8b.
 *
 * Dual-export: `Route` for TanStack file-route registration AND
 * `BetsPage` for direct test rendering.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';
import { Card } from '../components/card';
import { formatCents } from '../lib/format-cents';

// ---- Types ----------------------------------------------------------------

type BetStanding = {
  betId: string;
  playerAId: string;
  playerBId: string;
  opponentPlayerId: string;
  opponentName: string;
  betType: 'match_play_per_hole' | 'match_play_with_auto_press';
  stakePerHoleCents: number;
  applicableRoundIds: string[];
  perRoundStanding: Array<{
    eventRoundId: string;
    roundNumber: number;
    holesPlayed: number;
    holesRemaining: number;
    netToViewerCents: number;
  }>;
  totalNetToViewerCents: number;
  presses: Array<{
    betPressId: string;
    eventRoundId: string;
    firedAtHole: number;
    triggerType: 'auto' | 'manual';
    multiplier: number;
  }>;
};

type BetsResponse = { bets: BetStanding[] };

type FetchOutcome =
  | { kind: 'ok'; data: BetsResponse }
  | { kind: 'forbidden' };

// ---- Auth-status loader (mirror leaderboard) ------------------------------


// ---- Bets fetcher ---------------------------------------------------------

async function fetchBets(eventId: string): Promise<FetchOutcome> {
  const res = await fetch(`/api/events/${eventId}/bets/mine`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) throw new Error(`bets_fetch_failed_${res.status}`);
  const body = (await res.json()) as BetsResponse;
  return { kind: 'ok', data: body };
}

// ---- Helpers --------------------------------------------------------------

function netColor(cents: number): string | undefined {
  if (cents > 0) return 'var(--color-money-pos)';
  if (cents < 0) return 'var(--color-money-neg)';
  return undefined;
}

function betTypeLabel(t: BetStanding['betType']): string {
  return t === 'match_play_with_auto_press' ? 'Auto-press match' : 'Match play';
}

// ---- Component ------------------------------------------------------------

export type BetsPageProps = { eventId: string };

export function BetsPage({ eventId }: BetsPageProps) {
  const query = useQuery<FetchOutcome>({
    queryKey: ['eventBets', eventId],
    queryFn: () => fetchBets(eventId),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  if (query.isPending) {
    return (
      <PageShell title="Bets">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <LoadingCard />
      </PageShell>
    );
  }

  if (query.isError) {
    return (
      <PageShell title="Bets">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard
          title="Couldn't load bets."
          error={query.error}
          onRetry={query.refetch}
        />
      </PageShell>
    );
  }

  const outcome = query.data!;
  if (outcome.kind === 'forbidden') {
    return (
      <PageShell title="Bets">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard
          title="Not a participant"
          error="You aren't a participant in this event."
        />
      </PageShell>
    );
  }

  const { bets } = outcome.data;
  if (bets.length === 0) {
    return (
      <PageShell title="Bets">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <EmptyState icon="🎲" title="No bets yet — organizer can add via admin." />
      </PageShell>
    );
  }

  return (
    <PageShell title="Bets">
      <BackLink to="/events/$eventId" params={{ eventId }} />
      {bets.map((bet) => (
        <Card
          key={bet.betId}
          aria-label={`Bet vs ${bet.opponentName}`}
          style={{ marginBottom: 'var(--space-3)' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
            <div style={{ minWidth: 0 }}>
              <strong style={{ overflowWrap: 'anywhere' }}>vs {bet.opponentName}</strong>
              <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)' }}>
                {betTypeLabel(bet.betType)} · {formatCents(bet.stakePerHoleCents)}/hole
              </div>
            </div>
            <div
              style={{
                fontWeight: 'bold',
                fontSize: 'var(--font-md)',
                color: netColor(bet.totalNetToViewerCents),
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatCents(bet.totalNetToViewerCents)}
            </div>
          </div>

          <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {bet.perRoundStanding.map((r) => {
              const total = r.holesPlayed + r.holesRemaining;
              return (
                <div
                  key={r.eventRoundId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 'var(--space-2)',
                    fontSize: 'var(--font-sm)',
                  }}
                >
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere', color: 'var(--color-text-secondary)' }}>
                    Round {r.roundNumber}{' '}
                    <span style={{ color: 'var(--color-text-muted)' }}>
                      · through hole {r.holesPlayed} of {total}
                    </span>
                  </span>
                  <span
                    style={{
                      color: netColor(r.netToViewerCents),
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatCents(r.netToViewerCents)}
                  </span>
                </div>
              );
            })}
          </div>

          {bet.presses.length > 0 ? (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <div style={{ fontSize: 'var(--font-xs)', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Presses
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
                {bet.presses.map((p) => (
                  <div key={p.betPressId} style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>
                    Hole {p.firedAtHole} — {p.triggerType} press, ×{p.multiplier}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      ))}
    </PageShell>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/events/$eventId/bets')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <BetsPage eventId={eventId} />;
}
