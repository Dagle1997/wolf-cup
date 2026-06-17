/**
 * Pete Dye event-level 2-man TEAM standings ("best ball" member-guest overall).
 *
 * Route: /events/:eventId/team-standings
 * Powered by GET /api/events/:eventId/team-standings — each 2-man team's
 * cumulative best-ball gross / net / net-to-par across all rounds, sorted by
 * net-to-par. Sort toggle lets you re-rank by gross or net.
 *
 * Match-play POINTS (9/18-hole matches, round-robin opponents) is Phase 2 and
 * will arrive as an additional sortable column once the group locks the format.
 *
 * Dual-export: Route + TeamStandingsPage.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';
import { ScrollableTable } from '../components/scrollable-table';

type TeamRow = {
  teamKey: string;
  players: Array<{ playerId: string; name: string | null }>;
  holesPlayed: number;
  grossTotal: number;
  netTotal: number;
  parTotal: number;
  toPar: number;
};
type TeamStandingsResponse = { eventId: string; teams: TeamRow[] };

type SortKey = 'toPar' | 'net' | 'gross';

async function fetchStandings(eventId: string): Promise<TeamStandingsResponse> {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/team-standings`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as TeamStandingsResponse;
}

/** Net score to par: E, +N, or −N (en-dash minus). */
function fmtToPar(toPar: number): string {
  if (toPar === 0) return 'E';
  return toPar > 0 ? `+${toPar}` : `−${Math.abs(toPar)}`;
}

function teamName(t: TeamRow): string {
  return t.players.map((p) => p.name ?? '—').join(' + ');
}

export function TeamStandingsPage({ eventId }: { eventId: string }) {
  const [sort, setSort] = useState<SortKey>('toPar');
  const query = useQuery<TeamStandingsResponse, Error>({
    queryKey: ['team-standings', eventId],
    queryFn: () => fetchStandings(eventId),
    retry: false,
  });

  if (query.isPending) {
    return (
      <PageShell title="Team standings">
        <BackLink to="/events/$eventId" params={{ eventId }} label="Event home" />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Team standings">
        <BackLink to="/events/$eventId" params={{ eventId }} label="Event home" />
        <ErrorCard error="Couldn't load team standings." onRetry={query.refetch} />
      </PageShell>
    );
  }

  const teams = [...query.data!.teams].sort((a, b) =>
    sort === 'gross'
      ? a.grossTotal - b.grossTotal
      : sort === 'net'
        ? a.netTotal - b.netTotal
        : a.toPar - b.toPar,
  );

  return (
    <PageShell title="Team standings">
      <BackLink to="/events/$eventId" params={{ eventId }} label="Event home" />
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)' }}>
        2-man best ball — each team&apos;s lower net ball per hole, cumulative across all
        rounds. Sorted by net to par.
      </p>

      <div style={{ display: 'flex', gap: 8, margin: '12px 0', fontSize: 'var(--font-sm)' }}>
        <span style={{ color: 'var(--color-text-muted)' }}>Sort:</span>
        {(['toPar', 'net', 'gross'] as const).map((k) => (
          <button
            key={k}
            type="button"
            data-testid={`sort-${k}`}
            onClick={() => setSort(k)}
            style={{
              fontWeight: sort === k ? 700 : 400,
              color: sort === k ? 'var(--color-brand-primary)' : 'var(--color-text-secondary)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {k === 'toPar' ? 'To par' : k === 'net' ? 'Net' : 'Gross'}
          </button>
        ))}
      </div>

      {teams.length === 0 ? (
        <EmptyState
          title="No teams scored yet"
          body="Set the 2-man teams in the pairings (slots 1-2 / 3-4) and enter scores."
        />
      ) : (
        <ScrollableTable label="Team standings">
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 'var(--font-sm)' }}>
            <thead>
              <tr>
                <th style={cell}>#</th>
                <th style={{ ...cell, textAlign: 'left' }}>Team</th>
                <th style={cell}>Gross</th>
                <th style={cell}>Net</th>
                <th style={cell}>To par</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t, i) => (
                <tr key={t.teamKey} data-testid={`team-row-${t.teamKey}`}>
                  <td style={cell}>{i + 1}</td>
                  <td style={{ ...cell, textAlign: 'left' }}>{teamName(t)}</td>
                  <td style={cell}>{t.grossTotal}</td>
                  <td style={cell}>{t.netTotal}</td>
                  <td style={{ ...cell, fontWeight: 700 }} data-testid={`to-par-${t.teamKey}`}>
                    {fmtToPar(t.toPar)}
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

export const Route = createFileRoute('/events/$eventId/team-standings')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <TeamStandingsPage eventId={eventId} />;
}
