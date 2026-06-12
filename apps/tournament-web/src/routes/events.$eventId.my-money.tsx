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
  kind: 'foursome' | 'individual';
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
  if (cents > 0) return 'var(--color-success, #16a34a)';
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
        <EmptyState title="No money games yet." body="Once your round is scored, your team match and any side bets show up here." />
      </PageShell>
    );
  }

  return (
    <PageShell title="My Money">
      <BackLink to="/events/$eventId" params={{ eventId }} />

      <div
        data-testid="my-money-grand-total"
        style={{ fontSize: 'var(--font-lg)', fontWeight: 'bold', marginBottom: 16 }}
      >
        Total: <span style={{ color: netColor(totalNetCents) }}>{formatCents(totalNetCents)}</span>
      </div>

      {games.map((game) => (
        <section
          key={game.key}
          data-testid={`my-money-game-${game.key}`}
          aria-label={game.label}
          style={{ border: '1px solid var(--color-border, #ddd)', borderRadius: 8, padding: 12, marginBottom: 16 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <h2 style={{ fontSize: 'var(--font-md, 1rem)', margin: 0 }}>{game.label}</h2>
            <strong data-testid={`my-money-game-total-${game.key}`} style={{ color: netColor(game.netToViewerCents) }}>
              {formatCents(game.netToViewerCents)}
            </strong>
          </div>
          {game.perRound.map((r) => (
            <div key={r.eventRoundId} style={{ marginBottom: 8 }}>
              {game.perRound.length > 1 ? (
                <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted, #666)' }}>
                  Round {r.roundNumber}
                </div>
              ) : null}
              <HeadToHeadCard
                opponentLabel={game.kind === 'individual' ? game.opponentName ?? 'Opponent' : 'Other team'}
                showOpponentScore={game.kind === 'individual'}
                perHole={r.perHole}
              />
            </div>
          ))}
        </section>
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
