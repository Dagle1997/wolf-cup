/**
 * T13-5 "Foursome results" — the 2-ball team match for a round, hole by hole.
 *
 * Route: /events/:eventId/event-rounds/:eventRoundId/foursome-results
 * Reached from the leaderboard at round-end. Powered by
 * GET /api/events/:eventId/event-rounds/:eventRoundId/foursome-results.
 *
 * Neutral (not viewer-signed): each foursome shows team A vs team B, each
 * player's gross(net), the team best net, hole winner, and money to team A.
 *
 * Dual-export: Route + FoursomeResultsPage.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';
import { ScrollableTable } from '../components/scrollable-table';
import { formatCents } from '../lib/format-cents';

type PlayerHole = { playerId: string; gross: number | null; net: number | null };
type FoursomeHole = {
  holeNumber: number;
  par: number;
  teamABestNet: number | null;
  teamBBestNet: number | null;
  winner: 'teamA' | 'teamB' | 'tie' | null;
  moneyTeamACents: number;
  players: PlayerHole[];
};
type Foursome = {
  foursomeNumber: number;
  teamA: Array<{ playerId: string; name: string | null }>;
  teamB: Array<{ playerId: string; name: string | null }>;
  teamATotalCents: number;
  perHole: FoursomeHole[];
};
type FoursomeResultsResponse = {
  eventRoundId: string;
  roundNumber: number;
  foursomes: Foursome[];
};

type FetchOutcome = { kind: 'ok'; data: FoursomeResultsResponse } | { kind: 'forbidden' };

async function fetchFoursomeResults(eventId: string, eventRoundId: string): Promise<FetchOutcome> {
  const res = await fetch(
    `/api/events/${eventId}/event-rounds/${eventRoundId}/foursome-results`,
    { credentials: 'same-origin', cache: 'no-store' },
  );
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) throw new Error(`foursome_results_fetch_failed_${res.status}`);
  return { kind: 'ok', data: (await res.json()) as FoursomeResultsResponse };
}

function moneyColor(cents: number): string | undefined {
  if (cents > 0) return 'var(--color-success, var(--color-brand-primary))';
  if (cents < 0) return 'var(--color-danger, #dc2626)';
  return undefined;
}
function cell(gross: number | null, net: number | null): string {
  if (gross === null) return '—';
  return net !== null && net !== gross ? `${gross} (${net})` : `${gross}`;
}

export function FoursomeResultsPage({
  eventId,
  eventRoundId,
}: {
  eventId: string;
  eventRoundId: string;
}) {
  const query = useQuery<FetchOutcome>({
    queryKey: ['foursomeResults', eventId, eventRoundId],
    queryFn: () => fetchFoursomeResults(eventId, eventRoundId),
    refetchInterval: 15_000,
  });

  if (query.isPending) {
    return (
      <PageShell title="Foursome results">
        <BackLink to="/events/$eventId/leaderboard" params={{ eventId }} label="Leaderboard" />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Foursome results">
        <BackLink to="/events/$eventId/leaderboard" params={{ eventId }} label="Leaderboard" />
        <ErrorCard title="Couldn't load foursome results." error={query.error} onRetry={query.refetch} />
      </PageShell>
    );
  }
  const outcome = query.data!;
  if (outcome.kind === 'forbidden') {
    return (
      <PageShell title="Foursome results">
        <BackLink to="/events/$eventId/leaderboard" params={{ eventId }} label="Leaderboard" />
        <ErrorCard title="Not a participant" error="You aren't a participant in this event." />
      </PageShell>
    );
  }

  const { foursomes } = outcome.data;
  if (foursomes.length === 0) {
    return (
      <PageShell title="Foursome results">
        <BackLink to="/events/$eventId/leaderboard" params={{ eventId }} label="Leaderboard" />
        <EmptyState title="No team results yet." body="Once foursomes are scored, the 2-ball match shows up here." />
      </PageShell>
    );
  }

  return (
    <PageShell title="Foursome results">
      <BackLink to="/events/$eventId/leaderboard" params={{ eventId }} label="Leaderboard" />
      {foursomes.map((f) => {
        const nameOf = (pid: string) =>
          [...f.teamA, ...f.teamB].find((p) => p.playerId === pid)?.name ?? '—';
        const teamAName = f.teamA.map((p) => p.name ?? '—').join(' & ');
        const teamBName = f.teamB.map((p) => p.name ?? '—').join(' & ');
        return (
          <section
            key={f.foursomeNumber}
            data-testid={`foursome-${f.foursomeNumber}`}
            style={{ marginBottom: 20 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <h2 style={{ fontSize: 'var(--font-md, 1rem)', margin: 0 }}>
                Foursome {f.foursomeNumber}: {teamAName} vs {teamBName}
              </h2>
              <strong style={{ color: moneyColor(f.teamATotalCents) }}>
                {teamAName.split(' & ')[0]}’s team {formatCents(f.teamATotalCents)}
              </strong>
            </div>
            <ScrollableTable label={`Foursome ${f.foursomeNumber} scorecard`}>
              <table style={{ borderCollapse: 'collapse', fontSize: 'var(--font-sm)' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '2px 6px' }}>Hole</th>
                    <th style={{ textAlign: 'right', padding: '2px 6px' }}>Par</th>
                    {f.teamA.map((p) => (
                      <th key={p.playerId} style={{ textAlign: 'right', padding: '2px 6px' }}>{nameOf(p.playerId)}</th>
                    ))}
                    <th style={{ textAlign: 'right', padding: '2px 6px' }}>A best</th>
                    {f.teamB.map((p) => (
                      <th key={p.playerId} style={{ textAlign: 'right', padding: '2px 6px' }}>{nameOf(p.playerId)}</th>
                    ))}
                    <th style={{ textAlign: 'right', padding: '2px 6px' }}>B best</th>
                    <th style={{ textAlign: 'center', padding: '2px 6px' }}>Won</th>
                    <th style={{ textAlign: 'right', padding: '2px 6px' }}>$ A</th>
                  </tr>
                </thead>
                <tbody>
                  {f.perHole.map((h) => {
                    const byId = new Map(h.players.map((p) => [p.playerId, p]));
                    const won = h.winner === 'teamA' ? 'A' : h.winner === 'teamB' ? 'B' : h.winner === 'tie' ? '–' : '';
                    return (
                      <tr key={h.holeNumber}>
                        <td style={{ padding: '2px 6px' }}>{h.holeNumber}</td>
                        <td style={{ textAlign: 'right', padding: '2px 6px' }}>{h.par}</td>
                        {f.teamA.map((p) => (
                          <td key={p.playerId} style={{ textAlign: 'right', padding: '2px 6px' }}>
                            {cell(byId.get(p.playerId)?.gross ?? null, byId.get(p.playerId)?.net ?? null)}
                          </td>
                        ))}
                        <td style={{ textAlign: 'right', padding: '2px 6px', fontWeight: 600 }}>{h.teamABestNet ?? '—'}</td>
                        {f.teamB.map((p) => (
                          <td key={p.playerId} style={{ textAlign: 'right', padding: '2px 6px' }}>
                            {cell(byId.get(p.playerId)?.gross ?? null, byId.get(p.playerId)?.net ?? null)}
                          </td>
                        ))}
                        <td style={{ textAlign: 'right', padding: '2px 6px', fontWeight: 600 }}>{h.teamBBestNet ?? '—'}</td>
                        <td style={{ textAlign: 'center', padding: '2px 6px' }}>{won}</td>
                        <td style={{ textAlign: 'right', padding: '2px 6px', color: moneyColor(h.moneyTeamACents) }}>
                          {h.moneyTeamACents === 0 ? '—' : formatCents(h.moneyTeamACents)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollableTable>
          </section>
        );
      })}
    </PageShell>
  );
}

export const Route = createFileRoute('/events/$eventId/event-rounds/$eventRoundId/foursome-results')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId, eventRoundId } = Route.useParams();
  return <FoursomeResultsPage eventId={eventId} eventRoundId={eventRoundId} />;
}
