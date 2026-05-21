/**
 * T6-6 settle-up page.
 *
 * Route: /events/:eventId/settle-up
 *
 * Reuses GET /api/events/:eventId/money (T6-5). Renders:
 * - Player-balance list ordered by total balance (creditors first).
 * - Pairwise grid (matrix per row).
 * - Zero-sum assertion banner if totals don't sum to 0.
 *
 * Drill-down to per-hole contributions deferred (Followup T6-6a). Min-
 * transactions suggestion deferred (Followup T6-6b).
 */

import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';
import { formatCents } from '../lib/format-cents';

type MoneyMatrixResponse = {
  players: Array<{ id: string; name: string }>;
  matrix: Record<string, Record<string, number>>;
  totals: Record<string, number>;
  computedAt: string;
  visibilityMode: 'open' | 'participant' | 'self_only';
};

type FetchOutcome =
  | { kind: 'ok'; data: MoneyMatrixResponse }
  | { kind: 'forbidden' };


async function fetchMoney(eventId: string): Promise<FetchOutcome> {
  const res = await fetch(`/api/events/${eventId}/money`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) throw new Error(`money_fetch_failed_${res.status}`);
  const body = (await res.json()) as MoneyMatrixResponse;
  return { kind: 'ok', data: body };
}

export type SettleUpPageProps = { eventId: string; viewerId?: string };

export function SettleUpPage({ eventId, viewerId }: SettleUpPageProps) {
  const query = useQuery<FetchOutcome>({
    queryKey: ['eventSettleUp', eventId],
    queryFn: () => fetchMoney(eventId),
    refetchOnWindowFocus: true,
  });

  if (query.isPending) {
    return (
      <PageShell title="Settle Up">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <LoadingCard />
      </PageShell>
    );
  }

  if (query.isError) {
    return (
      <PageShell title="Settle Up">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard
          title="Couldn't load."
          error={query.error}
          onRetry={query.refetch}
        />
      </PageShell>
    );
  }

  const outcome = query.data!;
  if (outcome.kind === 'forbidden') {
    return (
      <PageShell title="Settle Up">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard
          title="Not a participant"
          error="You aren't a participant in this event."
        />
      </PageShell>
    );
  }

  const { players, matrix, totals } = outcome.data;
  if (players.length === 0) {
    return (
      <PageShell title="Settle Up">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <EmptyState title="No participants yet." />
      </PageShell>
    );
  }

  // Order players by total descending (creditors first).
  const sortedPlayers = [...players].sort(
    (a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0),
  );

  // Zero-sum assertion: anti-symmetric matrix guarantees this mathematically;
  // banner is defense-in-depth for stale-cache / drift detection.
  const totalSum = Object.values(totals).reduce((acc, n) => acc + n, 0);
  const zeroSumOk = totalSum === 0;

  return (
    <PageShell title="Settle Up">
      <BackLink to="/events/$eventId" params={{ eventId }} />

      {!zeroSumOk && (
        <div
          role="alert"
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #f87171',
            padding: '0.5rem 1rem',
            marginBottom: '1rem',
          }}
        >
          ⚠ Balances don&apos;t sum to zero ({formatCents(totalSum)}). Try
          refreshing — this likely means data is mid-update.
        </div>
      )}

      <section>
        <h2>Balances</h2>
        <ul>
          {sortedPlayers.map((p) => {
            const balance = totals[p.id] ?? 0;
            const isViewer = viewerId === p.id;
            return (
              <li
                key={p.id}
                style={isViewer ? { fontWeight: 'bold' } : undefined}
              >
                {p.name}: {formatCents(balance)}
              </li>
            );
          })}
        </ul>
      </section>

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Pairwise breakdown</h2>
        <p style={{ fontSize: '0.85rem', color: '#555' }}>
          What each player is up on each opponent.
        </p>
        {sortedPlayers.map((rowPlayer) => {
          const isViewer = viewerId === rowPlayer.id;
          return (
            <div
              key={rowPlayer.id}
              style={{
                border: '1px solid #ddd',
                padding: '0.5rem 1rem',
                marginBottom: '0.5rem',
                backgroundColor: isViewer ? '#eff6ff' : 'transparent',
              }}
            >
              <strong>{rowPlayer.name}</strong>{' '}
              <span style={{ color: '#666' }}>
                (total {formatCents(totals[rowPlayer.id] ?? 0)})
              </span>
              <ul>
                {sortedPlayers
                  .filter((p) => p.id !== rowPlayer.id)
                  .map((colPlayer) => {
                    const cents = matrix[rowPlayer.id]?.[colPlayer.id] ?? 0;
                    return (
                      <li key={colPlayer.id}>
                        vs {colPlayer.name}: {formatCents(cents)}
                      </li>
                    );
                  })}
              </ul>
            </div>
          );
        })}
      </section>
    </PageShell>
  );
}

export const Route = createFileRoute('/events/$eventId/settle-up')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  const ctx = Route.useRouteContext();
  return <SettleUpPage eventId={eventId} viewerId={ctx.player.id} />;
}
