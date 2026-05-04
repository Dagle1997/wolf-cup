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
import { queryClient } from '../lib/query-client';
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
      <div>
        <h1>Settle Up</h1>
        <p>Loading…</p>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div>
        <h1>Settle Up</h1>
        <p role="alert">Couldn&apos;t load. {String(query.error)}</p>
      </div>
    );
  }

  const outcome = query.data!;
  if (outcome.kind === 'forbidden') {
    return (
      <div>
        <h1>Settle Up</h1>
        <p role="alert">You aren&apos;t a participant in this event.</p>
      </div>
    );
  }

  const { players, matrix, totals } = outcome.data;
  if (players.length === 0) {
    return (
      <div>
        <h1>Settle Up</h1>
        <p>No participants yet.</p>
      </div>
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
    <div>
      <h1>Settle Up</h1>

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
    </div>
  );
}

export const Route = createFileRoute('/events/$eventId/settle-up')({
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
  return <SettleUpPage eventId={eventId} viewerId={ctx.player.id} />;
}
