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
import { queryClient } from '../lib/query-client';
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

type AuthStatus = { player: null | { id: string; isOrganizer: boolean } };

function validateAuthStatus(body: unknown): AuthStatus {
  if (body === null || typeof body !== 'object') return { player: null };
  const p = (body as { player?: unknown }).player;
  if (p === null) return { player: null };
  if (
    p !== null &&
    typeof p === 'object' &&
    typeof (p as { id?: unknown }).id === 'string' &&
    typeof (p as { isOrganizer?: unknown }).isOrganizer === 'boolean'
  ) {
    return {
      player: {
        id: (p as { id: string }).id,
        isOrganizer: (p as { isOrganizer: boolean }).isOrganizer,
      },
    };
  }
  return { player: null };
}

async function loadAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth/status').catch(() => null);
  if (res === null || !res.ok) return { player: null };
  const body = (await res.json().catch(() => null)) as unknown;
  if (body === null) return { player: null };
  return validateAuthStatus(body);
}

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
      <div>
        <h1>Money</h1>
        <p>Loading…</p>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div>
        <h1>Money</h1>
        <p role="alert">
          Couldn&apos;t load the money matrix. {String(query.error)}
        </p>
      </div>
    );
  }

  const outcome = query.data!;
  if (outcome.kind === 'forbidden') {
    return (
      <div>
        <h1>Money</h1>
        <p role="alert">You aren&apos;t a participant in this event.</p>
      </div>
    );
  }

  const { players, matrix, totals } = outcome.data;
  if (players.length === 0) {
    return (
      <div>
        <h1>Money</h1>
        <p>No participants yet.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Money</h1>
      <p style={{ color: '#555', fontSize: '0.85rem' }}>
        Cell shows what the row player is up on the column player.
      </p>
      <table>
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
      </table>
    </div>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/events/$eventId/money')({
  beforeLoad: async () => {
    const status = await queryClient.fetchQuery({
      queryKey: ['auth-status'],
      queryFn: loadAuthStatus,
      staleTime: 30_000,
      retry: false,
    });
    if (status.player === null) {
      window.location.assign('/api/auth/google');
      throw new Error('redirecting-to-oauth');
    }
    return { player: status.player };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  const ctx = Route.useRouteContext();
  return <MoneyPage eventId={eventId} viewerId={ctx.player.id} />;
}
