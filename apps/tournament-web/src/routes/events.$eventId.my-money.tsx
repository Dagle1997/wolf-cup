/**
 * T13-5 "My Money" board — the viewer's entire event P&L, decomposed by game.
 *
 * Route: /events/:eventId/my-money
 *
 * One section per game (the 2-ball foursome match + each individual side match),
 * each with its own subheading, a per-game total, and a hole-by-hole card; a
 * grand total at the top. Powered by GET /api/events/:eventId/my-money (all
 * values already viewer-signed).
 *
 * Dual-export: Route + MyMoneyPage.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';
import { HeadToHeadCard, type CardHole } from '../components/head-to-head-card';
import { formatCents } from '../lib/format-cents';

type MyMoneyGame = {
  kind: 'foursome' | 'individual' | 'action';
  key: string;
  label: string;
  opponentName: string | null;
  netToViewerCents: number;
  perRound: Array<{
    eventRoundId: string;
    roundNumber: number;
    netToViewerCents: number;
    perHole: CardHole[];
  }>;
};

type MyMoneyResponse = {
  viewerId: string;
  totalNetCents: number;
  games: MyMoneyGame[];
};

type FetchOutcome = { kind: 'ok'; data: MyMoneyResponse } | { kind: 'forbidden' };

async function fetchMyMoney(eventId: string): Promise<FetchOutcome> {
  const res = await fetch(`/api/events/${eventId}/my-money`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) throw new Error(`my_money_fetch_failed_${res.status}`);
  return { kind: 'ok', data: (await res.json()) as MyMoneyResponse };
}

function netColor(cents: number): string | undefined {
  if (cents > 0) return 'var(--color-success, var(--color-brand-primary))';
  if (cents < 0) return 'var(--color-danger, #dc2626)';
  return undefined;
}

export function MyMoneyPage({ eventId }: { eventId: string }) {
  const query = useQuery<FetchOutcome>({
    queryKey: ['myMoney', eventId],
    queryFn: () => fetchMyMoney(eventId),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  if (query.isPending) {
    return (
      <PageShell title="My Money">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="My Money">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard title="Couldn't load your money." error={query.error} onRetry={query.refetch} />
      </PageShell>
    );
  }
  const outcome = query.data!;
  if (outcome.kind === 'forbidden') {
    return (
      <PageShell title="My Money">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard title="Not a participant" error="You aren't a participant in this event." />
      </PageShell>
    );
  }

  const { totalNetCents, games } = outcome.data;
  if (games.length === 0) {
    return (
      <PageShell title="My Money">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <EmptyState icon="💰" title="No money games yet." body="Once your round is scored, your team match and any side bets show up here." />
      </PageShell>
    );
  }

  return (
    <PageShell title="My Money">
      <BackLink to="/events/$eventId" params={{ eventId }} />

      {/* Hero: the one number anyone actually wants. */}
      <div className="card" data-testid="my-money-grand-total" style={{ textAlign: 'center', padding: 'var(--space-5)', marginBottom: 'var(--space-4)' }}>
        <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)', fontWeight: 600 }}>Your money this event</div>
        <div style={{ fontSize: 'var(--font-2xl)', fontWeight: 800, color: netColor(totalNetCents), marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
          {formatCents(totalNetCents)}
        </div>
      </div>

      {/* One collapsible card per game — scannable; tap to see hole-by-hole. */}
      {games.map((game) => (
        <details
          key={game.key}
          data-testid={`my-money-game-${game.key}`}
          aria-label={game.label}
          className="card"
          style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)' }}
        >
          <summary style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', listStyle: 'none' }}>
            <span style={{ fontSize: 'var(--font-md)', fontWeight: 600 }}>{game.label}</span>
            <strong data-testid={`my-money-game-total-${game.key}`} style={{ color: netColor(game.netToViewerCents), fontVariantNumeric: 'tabular-nums' }}>
              {formatCents(game.netToViewerCents)}
            </strong>
          </summary>
          <div style={{ marginTop: 'var(--space-3)' }}>
            {game.perRound.map((r) => (
              <div key={r.eventRoundId} style={{ marginBottom: 'var(--space-2)' }}>
                {game.perRound.length > 1 ? (
                  <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)' }}>Round {r.roundNumber}</div>
                ) : null}
                <HeadToHeadCard
                  opponentLabel={
                    game.kind === 'individual' || game.kind === 'action'
                      ? game.opponentName ?? 'Opponent'
                      : 'Other team'
                  }
                  showOpponentScore={game.kind === 'individual'}
                  perHole={r.perHole}
                />
              </div>
            ))}
          </div>
        </details>
      ))}
    </PageShell>
  );
}

export const Route = createFileRoute('/events/$eventId/my-money')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <MyMoneyPage eventId={eventId} />;
}
