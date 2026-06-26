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
import { ViewTabs } from '../components/view-tabs';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';
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

/**
 * A single team's per-hole results as a phone-first stacked mini-list (NOT a
 * wide table). One row per hole: the hole number, each player's gross(net),
 * the team's best net, and a "won" marker on holes this team won. The team's
 * money total sits at the bottom. Replaces the unreadable 8+ column table on
 * a phone; preserves every value the table showed.
 */
function TeamCard({
  teamKey,
  heading,
  players,
  perHole,
  bestOf,
  nameOf,
  totalCents,
  totalLabel,
}: {
  teamKey: 'teamA' | 'teamB';
  heading: string;
  players: Array<{ playerId: string; name: string | null }>;
  perHole: FoursomeHole[];
  bestOf: (h: FoursomeHole) => number | null;
  nameOf: (pid: string) => string;
  totalCents: number;
  totalLabel: string;
}) {
  const cellPad = '2px 0';
  // Per-hole money ("$ to this team"). Hidden when every hole is $0 — which is
  // the case for F1 events (per-hole breakdown is Epic-4 deferred; only the team
  // TOTAL below is real). Legacy 2v2 events DO carry per-hole money, so we show
  // the column then (restores what the old table showed — codex/gemini review).
  const showPerHoleMoney = perHole.some((h) => h.moneyTeamACents !== 0);
  const teamMoney = (h: FoursomeHole) => (teamKey === 'teamA' ? h.moneyTeamACents : -h.moneyTeamACents);
  return (
    <div className="card" style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
      <div
        style={{
          fontWeight: 700,
          fontSize: 'var(--font-sm)',
          marginBottom: 'var(--space-2)',
          wordBreak: 'break-word',
        }}
      >
        {heading}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-sm)', tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)' }}>
            <th style={{ textAlign: 'left', padding: cellPad, width: 36 }}>Hole</th>
            <th style={{ textAlign: 'left', padding: cellPad, width: 24 }}>Par</th>
            {players.map((p) => (
              <th key={p.playerId} style={{ textAlign: 'right', padding: cellPad, wordBreak: 'break-word' }}>
                {nameOf(p.playerId)}
              </th>
            ))}
            <th style={{ textAlign: 'right', padding: cellPad, width: 40 }}>Best</th>
            <th style={{ textAlign: 'center', padding: cellPad, width: 36 }}>Won</th>
            {showPerHoleMoney ? <th style={{ textAlign: 'right', padding: cellPad, width: 52 }}>$</th> : null}
          </tr>
        </thead>
        <tbody>
          {perHole.map((h) => {
            const byId = new Map(h.players.map((p) => [p.playerId, p]));
            const wonThis = h.winner === teamKey;
            return (
              <tr key={h.holeNumber} style={{ borderTop: '1px solid var(--color-border-subtle, var(--color-border))' }}>
                <td style={{ padding: cellPad, fontVariantNumeric: 'tabular-nums' }}>{h.holeNumber}</td>
                <td style={{ padding: cellPad, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{h.par}</td>
                {players.map((p) => (
                  <td key={p.playerId} style={{ textAlign: 'right', padding: cellPad, fontVariantNumeric: 'tabular-nums' }}>
                    {cell(byId.get(p.playerId)?.gross ?? null, byId.get(p.playerId)?.net ?? null)}
                  </td>
                ))}
                <td style={{ textAlign: 'right', padding: cellPad, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{bestOf(h) ?? '—'}</td>
                <td style={{ textAlign: 'center', padding: cellPad, color: wonThis ? 'var(--color-success, var(--color-brand-primary))' : 'var(--color-text-muted)', fontWeight: wonThis ? 700 : 400 }}>
                  {wonThis ? '✓' : h.winner === 'tie' ? '–' : ''}
                </td>
                {showPerHoleMoney ? (
                  <td style={{ textAlign: 'right', padding: cellPad, color: moneyColor(teamMoney(h)), fontVariantNumeric: 'tabular-nums' }}>
                    {formatCents(teamMoney(h))}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginTop: 'var(--space-2)',
          paddingTop: 'var(--space-2)',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <span style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)', wordBreak: 'break-word' }}>{totalLabel}</span>
        <strong style={{ color: moneyColor(totalCents), fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {formatCents(totalCents)}
        </strong>
      </div>
    </div>
  );
}

export function FoursomeResultsPage({
  eventId,
  eventRoundId,
  embedTabs = false,
}: {
  eventId: string;
  eventRoundId: string;
  /** When rendered as the standings "Foursome" tab, show the Teams/Foursome/Skins strip. */
  embedTabs?: boolean;
}) {
  const tabs = embedTabs ? <ViewTabs set="standings" active="foursome" eventId={eventId} /> : null;
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
        {tabs}
        <EmptyState title="No team results yet." body="Once foursomes are scored, the 2-ball match shows up here." />
      </PageShell>
    );
  }

  return (
    <PageShell title="Foursome results">
      <BackLink to="/events/$eventId/leaderboard" params={{ eventId }} label="Leaderboard" />
      {tabs}
      {foursomes.map((f) => {
        const nameOf = (pid: string) =>
          [...f.teamA, ...f.teamB].find((p) => p.playerId === pid)?.name ?? '—';
        const teamAName = f.teamA.map((p) => p.name ?? '—').join(' & ');
        const teamBName = f.teamB.map((p) => p.name ?? '—').join(' & ');
        const teamALabel = teamAName.split(' & ')[0];
        return (
          <section
            key={f.foursomeNumber}
            data-testid={`foursome-${f.foursomeNumber}`}
            style={{ marginBottom: 'var(--space-5)' }}
          >
            <h2 style={{ fontSize: 'var(--font-md, 1rem)', margin: '0 0 var(--space-3)', wordBreak: 'break-word' }}>
              Foursome {f.foursomeNumber}: {teamAName} vs {teamBName}
            </h2>
            <TeamCard
              teamKey="teamA"
              heading={teamAName}
              players={f.teamA}
              perHole={f.perHole}
              bestOf={(h) => h.teamABestNet}
              nameOf={nameOf}
              totalCents={f.teamATotalCents}
              totalLabel={`${teamALabel}’s team`}
            />
            <TeamCard
              teamKey="teamB"
              heading={teamBName}
              players={f.teamB}
              perHole={f.perHole}
              bestOf={(h) => h.teamBBestNet}
              nameOf={nameOf}
              totalCents={-f.teamATotalCents}
              totalLabel={`${teamBName.split(' & ')[0]}’s team`}
            />
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
