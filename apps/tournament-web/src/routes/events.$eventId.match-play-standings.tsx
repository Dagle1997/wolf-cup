/**
 * Pete Dye Phase 2 — event-level MATCH-PLAY points standings.
 *
 * Route: /events/:eventId/match-play-standings
 * Powered by GET /api/events/:eventId/match-play-standings — each 2-man team's
 * foursome-internal 2v2 match (slots 1&2 vs 3&4), scored per round into
 * win/halve/loss POINTS and aggregated across all rounds.
 *
 * A SEPARATE parallel board from Team Standings (best-ball net-to-par, which
 * decides the $50/man pot). Sorted by points, then cumulative hole differential.
 *
 * Dual-export: Route + MatchPlayStandingsPage.
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
import { ScrollableTable } from '../components/scrollable-table';

type MatchRow = {
  teamKey: string;
  players: Array<{ playerId: string; name: string | null }>;
  matchesPlayed: number;
  won: number;
  halved: number;
  lost: number;
  points: number;
  holesWon: number;
  holesLost: number;
  holesHalved: number;
  holesDiff: number;
};
type MatchPlayStandingsResponse = { eventId: string; teams: MatchRow[] };

async function fetchStandings(eventId: string): Promise<MatchPlayStandingsResponse> {
  const res = await fetch(
    `/api/events/${encodeURIComponent(eventId)}/match-play-standings`,
    { credentials: 'same-origin' },
  );
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as MatchPlayStandingsResponse;
}

function teamName(t: MatchRow): string {
  return t.players.map((p) => p.name ?? '—').join(' + ');
}

/** Hole differential: E, +N, or −N (en-dash minus). */
function fmtDiff(diff: number): string {
  if (diff === 0) return 'E';
  return diff > 0 ? `+${diff}` : `−${Math.abs(diff)}`;
}

/** Points may be fractional (halves); show 0.5 but trim a trailing .0 → "3". */
function fmtPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

export function MatchPlayStandingsPage({ eventId }: { eventId: string }) {
  const query = useQuery<MatchPlayStandingsResponse, Error>({
    queryKey: ['match-play-standings', eventId],
    queryFn: () => fetchStandings(eventId),
    retry: false,
  });

  if (query.isPending) {
    return (
      <PageShell title="Match play">
        <BackLink to="/events/$eventId" params={{ eventId }} label="Event home" />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Match play">
        <BackLink to="/events/$eventId" params={{ eventId }} label="Event home" />
        <ErrorCard error="Couldn't load match-play standings." onRetry={query.refetch} />
      </PageShell>
    );
  }

  const teams = query.data!.teams;

  return (
    <PageShell title="Match play">
      <BackLink to="/events/$eventId" params={{ eventId }} label="Event home" />
      <ViewTabs set="standings" active="match" eventId={eventId} />
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)' }}>
        Foursome match points — each round, the two teams in a foursome play their
        2v2 net match; win = 1, halve = ½. Sorted by points, then holes up.
      </p>

      {teams.length === 0 ? (
        <EmptyState
          title="No matches scored yet"
          body="Set the 2-man teams in the pairings (slots 1-2 / 3-4) and enter scores."
        />
      ) : (
        <ScrollableTable label="Match-play standings">
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 'var(--font-sm)' }}>
            <thead>
              <tr>
                <th style={cell}>#</th>
                <th style={{ ...cell, textAlign: 'left' }}>Team</th>
                <th style={cell}>W-H-L</th>
                <th style={cell}>Points</th>
                <th style={cell}>Holes</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t, i) => (
                <tr key={t.teamKey} data-testid={`match-row-${t.teamKey}`}>
                  <td style={cell}>{i + 1}</td>
                  <td style={{ ...cell, textAlign: 'left' }}>{teamName(t)}</td>
                  <td style={cell}>
                    {t.won}-{t.halved}-{t.lost}
                  </td>
                  <td style={{ ...cell, fontWeight: 700 }} data-testid={`points-${t.teamKey}`}>
                    {fmtPoints(t.points)}
                  </td>
                  <td style={cell} data-testid={`holes-diff-${t.teamKey}`}>
                    {fmtDiff(t.holesDiff)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      )}
    </PageShell>
  );
}

const cell: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--color-border)',
  textAlign: 'center',
  whiteSpace: 'nowrap',
};

export const Route = createFileRoute('/events/$eventId/match-play-standings')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <MatchPlayStandingsPage eventId={eventId} />;
}
