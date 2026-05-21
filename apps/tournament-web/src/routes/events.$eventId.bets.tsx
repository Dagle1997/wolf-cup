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
  if (cents > 0) return '#16a34a';
  if (cents < 0) return '#dc2626';
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
      <div>
        <h1>Bets</h1>
        <p>Loading…</p>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div>
        <h1>Bets</h1>
        <p role="alert">
          Couldn&apos;t load bets. {String(query.error)}
        </p>
      </div>
    );
  }

  const outcome = query.data!;
  if (outcome.kind === 'forbidden') {
    return (
      <div>
        <h1>Bets</h1>
        <p role="alert">You aren&apos;t a participant in this event.</p>
      </div>
    );
  }

  const { bets } = outcome.data;
  if (bets.length === 0) {
    return (
      <div>
        <h1>Bets</h1>
        <p>No bets yet — organizer can add via admin.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Bets</h1>
      {bets.map((bet) => (
        <section
          key={bet.betId}
          aria-label={`Bet vs ${bet.opponentName}`}
          style={{
            border: '1px solid #ddd',
            borderRadius: 8,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <strong>vs {bet.opponentName}</strong>
              <div style={{ fontSize: '0.85rem', color: '#555' }}>
                {betTypeLabel(bet.betType)} · {formatCents(bet.stakePerHoleCents)}/hole
              </div>
            </div>
            <div
              style={{
                fontWeight: 'bold',
                fontSize: '1.1rem',
                color: netColor(bet.totalNetToViewerCents),
              }}
            >
              {formatCents(bet.totalNetToViewerCents)}
            </div>
          </div>

          <ul style={{ marginTop: 8, paddingLeft: 16 }}>
            {bet.perRoundStanding.map((r) => {
              const total = r.holesPlayed + r.holesRemaining;
              return (
                <li key={r.eventRoundId}>
                  Round {r.roundNumber} — through hole {r.holesPlayed} of {total}{' '}
                  — net{' '}
                  <span style={{ color: netColor(r.netToViewerCents) }}>
                    {formatCents(r.netToViewerCents)}
                  </span>
                </li>
              );
            })}
          </ul>

          {bet.presses.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Presses</div>
              <ul style={{ paddingLeft: 16 }}>
                {bet.presses.map((p) => (
                  <li key={p.betPressId}>
                    Hole {p.firedAtHole} — {p.triggerType} press, ×{p.multiplier}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ))}
    </div>
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
