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
import { ViewTabs } from '../components/view-tabs';
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


/** Plain dollar magnitude (no +/− sign) — a transfer is an amount owed, not a signed balance. */
function formatDollars(cents: number): string {
  const abs = Math.abs(cents);
  return `$${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}`;
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

/** Greedy minimal-transfer settle: biggest debtor pays biggest creditor. */
function computeTransfers(
  players: Array<{ id: string; name: string }>,
  totals: Record<string, number>,
): Array<{ from: string; to: string; cents: number }> {
  const debtors = players
    .map((p) => ({ name: p.name, amt: -(totals[p.id] ?? 0) }))
    .filter((b) => b.amt > 0)
    .sort((a, b) => b.amt - a.amt);
  const creditors = players
    .map((p) => ({ name: p.name, amt: totals[p.id] ?? 0 }))
    .filter((b) => b.amt > 0)
    .sort((a, b) => b.amt - a.amt);
  const transfers: Array<{ from: string; to: string; cents: number }> = [];
  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const pay = Math.min(debtors[di]!.amt, creditors[ci]!.amt);
    if (pay > 0) transfers.push({ from: debtors[di]!.name, to: creditors[ci]!.name, cents: pay });
    debtors[di]!.amt -= pay;
    creditors[ci]!.amt -= pay;
    if (debtors[di]!.amt === 0) di++;
    if (creditors[ci]!.amt === 0) ci++;
  }
  return transfers;
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
        <EmptyState icon="🤝" title="No participants yet." />
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
  const transfers = computeTransfers(players, totals);

  return (
    <PageShell title="Settle Up">
      <BackLink to="/events/$eventId" params={{ eventId }} />
      <ViewTabs set="money" active="settle" eventId={eventId} />

      {!zeroSumOk && (
        <div
          role="alert"
          style={{
            backgroundColor: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-4)',
            marginBottom: 'var(--space-4)',
          }}
        >
          ⚠ Balances don&apos;t sum to zero ({formatCents(totalSum)}). Try
          refreshing — this likely means data is mid-update.
        </div>
      )}

      {/* The point of this screen: who pays whom. */}
      <section aria-label="Who pays whom">
        <h2 style={{ fontSize: 'var(--font-md)', marginBottom: 'var(--space-2)' }}>Who pays whom</h2>
        {transfers.length === 0 ? (
          <div className="card" style={{ color: 'var(--color-text-secondary)' }}>All square — nobody owes anything yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {transfers.map((t, i) => (
              <div key={i} className="card" data-testid="settle-transfer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)' }}>
                <span style={{ fontSize: 'var(--font-md)' }}>
                  <strong>{t.from}</strong> pays <strong>{t.to}</strong>
                </span>
                <strong style={{ color: 'var(--color-money-neg)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatDollars(t.cents)}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <details style={{ marginTop: 'var(--space-5)' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Balances + pairwise breakdown</summary>
        <section style={{ marginTop: 'var(--space-3)' }}>
          <div className="card" style={{ padding: 'var(--space-2) var(--space-4)' }}>
            {sortedPlayers.map((p, i) => {
              const balance = totals[p.id] ?? 0;
              return (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-2) 0', borderBottom: i < sortedPlayers.length - 1 ? '1px solid var(--color-border-subtle)' : 'none', fontWeight: viewerId === p.id ? 700 : 400 }}>
                  <span>{p.name}{viewerId === p.id ? ' (you)' : ''}</span>
                  <strong style={{ color: balance > 0 ? 'var(--color-money-pos)' : balance < 0 ? 'var(--color-money-neg)' : 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{formatCents(balance)}</strong>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)', marginTop: 'var(--space-3)' }}>What each player is up on each opponent:</p>
          {sortedPlayers.map((rowPlayer) => (
            <div key={rowPlayer.id} className="card" style={{ padding: 'var(--space-2) var(--space-4)', marginBottom: 'var(--space-2)', background: viewerId === rowPlayer.id ? 'var(--color-brand-tint)' : undefined }}>
              <strong>{rowPlayer.name}</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {sortedPlayers.filter((p) => p.id !== rowPlayer.id).map((colPlayer) => {
                  const cents = matrix[rowPlayer.id]?.[colPlayer.id] ?? 0;
                  return <li key={colPlayer.id}>vs {colPlayer.name}: {formatCents(cents)}</li>;
                })}
              </ul>
            </div>
          ))}
        </section>
      </details>
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
