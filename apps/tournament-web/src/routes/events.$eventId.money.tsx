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
import { ViewTabs } from '../components/view-tabs';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';
import { ScrollableTable } from '../components/scrollable-table';
import { formatCents } from '../lib/format-cents';

// ---- Types ----------------------------------------------------------------

type Ledger = {
  matrix: Record<string, Record<string, number>>;
  totals: Record<string, number>;
};

type MoneyMatrixResponse = {
  players: Array<{ id: string; name: string }>;
  matrix: Record<string, Record<string, number>>;
  totals: Record<string, number>;
  teamLedger: Ledger;
  individualLedger: Ledger;
  actionLedger: Ledger;
  computedAt: string;
  visibilityMode: 'open' | 'participant' | 'self_only';
  /** F1 (Story 1.4): present only for F1 events. */
  f1?: {
    isF1: true;
    lockState: 'locked' | 'unlocked';
    exposed: boolean;
    unsettleable: Array<{ foursomeNumber: number; reason: string; detail: string }>;
  };
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

// ---- Matrix table (reused per ledger) -------------------------------------

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
function cellColor(cents: number): string | undefined {
  if (cents > 0) return 'var(--color-money-pos)';
  if (cents < 0) return 'var(--color-money-neg)';
  return 'var(--color-text-muted)';
}

function LedgerMatrix({
  label,
  players,
  ledger,
  viewerId,
}: {
  label: string;
  players: Array<{ id: string; name: string }>;
  ledger: Ledger;
  viewerId: string | undefined;
}) {
  const { matrix, totals } = ledger;
  return (
    <section style={{ marginBottom: 'var(--space-5)' }} aria-label={label}>
      <h2 style={{ fontSize: 'var(--font-md)', marginBottom: 'var(--space-2)' }}>{label}</h2>
      <ScrollableTable label={label}>
        <table>
          <thead>
            <tr>
              <th></th>
              {players.map((p) => (
                <th key={p.id} style={{ textAlign: 'right' }}>{firstName(p.name)}</th>
              ))}
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {players.map((rowPlayer) => {
              const isViewer = viewerId === rowPlayer.id;
              return (
                <tr key={rowPlayer.id} style={isViewer ? { backgroundColor: 'var(--color-brand-tint)' } : undefined}>
                  <th style={{ whiteSpace: 'nowrap' }}>{firstName(rowPlayer.name)}</th>
                  {players.map((colPlayer) => {
                    if (rowPlayer.id === colPlayer.id) return <td key={colPlayer.id} style={{ textAlign: 'right', color: 'var(--color-border)' }}>—</td>;
                    const cents = matrix[rowPlayer.id]?.[colPlayer.id] ?? 0;
                    return <td key={colPlayer.id} style={{ textAlign: 'right', color: cellColor(cents) }}>{cents === 0 ? '—' : formatCents(cents)}</td>;
                  })}
                  <td style={{ textAlign: 'right' }}>
                    <strong style={{ color: cellColor(totals[rowPlayer.id] ?? 0) }}>{formatCents(totals[rowPlayer.id] ?? 0)}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollableTable>
    </section>
  );
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

  const { players, totals, teamLedger, individualLedger, actionLedger, f1 } = outcome.data;
  // Only surface "The Action" ledger when there's actually action money to show
  // (keeps the board clean for events with no bets).
  const hasAction = Object.values(actionLedger?.totals ?? {}).some((v) => v !== 0);
  if (players.length === 0) {
    return (
      <PageShell title="Money">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <EmptyState icon="💰" title="No participants yet." />
      </PageShell>
    );
  }

  // F1 (Story 1.4, AC10): money is dark-launched until the exposure flag is on.
  // Render an EXPLICIT "not yet enabled" state — never a silent-zero ledger that
  // could read as "everyone's even".
  if (f1 && !f1.exposed) {
    return (
      <PageShell title="Money">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <EmptyState
          icon="🔒"
          title="Money not yet enabled."
          // The game is configured; dollars are turned on once the round runs.
        />
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)', marginTop: 'var(--space-3)' }}>
          This event's game is set up, but money isn't enabled yet. Scores still
          count — the board will show dollars once money is turned on.
        </p>
      </PageShell>
    );
  }

  const standings = [...players].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0));

  return (
    <PageShell title="Money">
      <BackLink to="/events/$eventId" params={{ eventId }} />
      <ViewTabs set="money" active="money" eventId={eventId} />

      {/* F1 unlocked-mode note: the matrix is redacted to your own money. */}
      {f1 && f1.lockState === 'unlocked' ? (
        <div
          data-testid="f1-unlocked-note"
          style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-sm)', backgroundColor: 'var(--color-surface-sunken)', color: 'var(--color-text-secondary)' }}
        >
          This event is unlocked — money is private. You only see your own figures here.
        </div>
      ) : null}

      {/* F1 fail-closed surface (AC11): foursomes that couldn't settle, isolated. */}
      {f1 && f1.unsettleable.length > 0 ? (
        <div
          data-testid="f1-unsettleable"
          style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-sm)', backgroundColor: 'var(--color-surface-sunken)', color: 'var(--color-money-neg)' }}
        >
          {f1.unsettleable.map((u) => (
            <div key={u.foursomeNumber}>
              Foursome {u.foursomeNumber}: Calculation paused — unsettleable: {u.detail}.
            </div>
          ))}
        </div>
      ) : null}

      {/* Headline: where everyone stands overall (what settles). */}
      <section aria-label="Combined total" style={{ marginBottom: 'var(--space-5)' }}>
        <h2 style={{ fontSize: 'var(--font-md)', marginBottom: 'var(--space-2)' }}>Standings</h2>
        <div className="card" style={{ padding: 'var(--space-2) var(--space-4)' }}>
          {standings.map((p, i) => {
            const t = totals[p.id] ?? 0;
            return (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0', borderBottom: i < standings.length - 1 ? '1px solid var(--color-border-subtle)' : 'none', fontWeight: viewerId === p.id ? 700 : 400 }}>
                <span>{p.name}{viewerId === p.id ? ' (you)' : ''}</span>
                <strong style={{ color: cellColor(t), fontVariantNumeric: 'tabular-nums' }}>{formatCents(t)}</strong>
              </div>
            );
          })}
        </div>
      </section>

      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)', marginBottom: 'var(--space-3)' }}>
        Team, individual{hasAction ? ', and The Action' : ''} money are kept separate below; each cell is what the row player is up on the column player.
      </p>

      <LedgerMatrix label="Team / Ball money" players={players} ledger={teamLedger} viewerId={viewerId} />
      <LedgerMatrix label="Individual bets" players={players} ledger={individualLedger} viewerId={viewerId} />
      {hasAction ? (
        <LedgerMatrix label="The Action" players={players} ledger={actionLedger} viewerId={viewerId} />
      ) : null}
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
