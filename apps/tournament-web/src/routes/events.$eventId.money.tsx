/**
 * T6-5 head-to-head money matrix page.
 *
 * Route: /events/:eventId/money
 *
 * Renders the N×N money matrix from `GET /api/events/:eventId/money` as
 * an HTML table. Cells display `formatCents(matrix[a][b])` per the
 * integer-cents discipline (display-only conversion at the render
 * boundary; engine + service emit integer cents).
 *
 * Auth guard mirrors leaderboard pattern: anonymous → redirect to
 * /api/auth/google; 403 → inline forbidden.
 *
 * v1 limitations (per T6-5 spec):
 * - Press multipliers + skins NOT YET aggregated (Followups T6-5f / T6-5a).
 * - No tap-cell drill-down (Followup T6-5b → T6-6 settle-up).
 * - No real-time refresh; fetched once per visit (cache-control: no-store).
 *
 * Dual-export: `Route` for TanStack file-route registration AND
 * `MoneyPage` for direct test rendering.
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

// ---- Types ----------------------------------------------------------------

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

// ---- Auth-status loader (mirror leaderboard) ------------------------------


// ---- Money fetcher --------------------------------------------------------

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

// ---- Component ------------------------------------------------------------

export type MoneyPageProps = { eventId: string; viewerId?: string };

export function MoneyPage({ eventId, viewerId }: MoneyPageProps) {
  const query = useQuery<FetchOutcome>({
    queryKey: ['eventMoney', eventId],
    queryFn: () => fetchMoney(eventId),
    refetchOnWindowFocus: true,
  });

  if (query.isPending) {
    return (
      <PageShell title="Money">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <LoadingCard />
      </PageShell>
    );
  }

  if (query.isError) {
    return (
      <PageShell title="Money">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard
          title="Couldn't load the money matrix."
          error={query.error}
          onRetry={query.refetch}
        />
      </PageShell>
    );
  }

  const outcome = query.data!;
  if (outcome.kind === 'forbidden') {
    return (
      <PageShell title="Money">
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
      <PageShell title="Money">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <EmptyState title="No participants yet." />
      </PageShell>
    );
  }

  return (
    <PageShell title="Money">
      <BackLink to="/events/$eventId" params={{ eventId }} />
      <p style={{ color: '#555', fontSize: '0.85rem' }}>
        Cell shows what the row player is up on the column player.
      </p>
      <ScrollableTable label="Money matrix"><table>
        <thead>
          <tr>
            <th></th>
            {players.map((p) => (
              <th key={p.id}>{p.name}</th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {players.map((rowPlayer) => {
            const isViewer = viewerId === rowPlayer.id;
            return (
              <tr
                key={rowPlayer.id}
                style={isViewer ? { backgroundColor: '#eff6ff' } : undefined}
              >
                <th>{rowPlayer.name}</th>
                {players.map((colPlayer) => {
                  if (rowPlayer.id === colPlayer.id) {
                    return <td key={colPlayer.id}>—</td>;
                  }
                  const cents = matrix[rowPlayer.id]?.[colPlayer.id] ?? 0;
                  return <td key={colPlayer.id}>{formatCents(cents)}</td>;
                })}
                <td>
                  <strong>{formatCents(totals[rowPlayer.id] ?? 0)}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></ScrollableTable>
    </PageShell>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/events/$eventId/money')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  const ctx = Route.useRouteContext();
  return <MoneyPage eventId={eventId} viewerId={ctx.player.id} />;
}
