/**
 * T5-5 cross-group stroke-play leaderboard page.
 *
 * Route: /events/:eventId/leaderboard
 *
 * Polls `GET /api/events/:eventId/leaderboard?round=<value>` every 15s via
 * TanStack Query (NFR-P2 30s propagation envelope, halved to land within
 * one poll). Auth guard mirrors /me + /admin/* loader pattern: anonymous
 * → window.location.assign('/api/auth/google'); 403 (non-participant) is
 * caught at fetch level and rendered as inline forbidden.
 *
 * AC-5 round selector: v1 ships a TWO-option toggle (Current round /
 * All rounds (event)) rather than a full per-round dropdown. A
 * per-round dropdown requires an `event-rounds list` endpoint that does
 * not yet exist; building it is explicitly out of scope (followup
 * T5-5d). When that endpoint lands, the toggle becomes a select.
 *
 * Dual-export: `Route` for TanStack file-route registration AND
 * `LeaderboardPage` for direct test rendering.
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';
import { ScrollableTable } from '../components/scrollable-table';

// ---- Types ----------------------------------------------------------------

type LeaderboardRow = {
  playerId: string;
  playerName: string;
  handicapIndex: number | null;
  /** F1 (Story 1.4): pinned course handicap for an F1 round-scope read. */
  courseHandicap?: number | null;
  grossThroughHole: number | null;
  netThroughHole: number | null;
  throughHole: number;
  rank: number;
  tiedWith: number;
  /** T6-14: skins pot share across finalized rounds. Null until any finalize. */
  skinsCents: number | null;
};

/** F1 leaderboard money mode (Story 1.4, AC8). */
type F1Mode = {
  lockState: 'locked' | 'unlocked';
  mode: 'money' | 'scores_only';
  moneyEnabled: boolean;
};

type RoundSummary = {
  id: string;
  eventRoundId: string | null;
  name: string;
  status: string | null;
};

type LeaderboardResponse = {
  rows: LeaderboardRow[];
  round: RoundSummary | null;
  scope: 'round' | 'event';
  computedAt: string;
  f1?: F1Mode;
};

type FetchOutcome =
  | { kind: 'ok'; data: LeaderboardResponse }
  | { kind: 'forbidden' }
  | { kind: 'unknown_event' };

type ScopeMode = 'current' | 'event';

// ---- Auth-status loader (mirror /me) --------------------------------------


// ---- Leaderboard fetcher --------------------------------------------------

async function fetchLeaderboard(
  eventId: string,
  scope: ScopeMode,
): Promise<FetchOutcome> {
  const url =
    scope === 'event'
      ? `/api/events/${eventId}/leaderboard`
      : `/api/events/${eventId}/leaderboard?round=current`;
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 403) return { kind: 'forbidden' };
  if (res.status === 404) return { kind: 'unknown_event' };
  if (!res.ok) {
    throw new Error(`leaderboard_fetch_failed_${res.status}`);
  }
  const body = (await res.json()) as LeaderboardResponse;
  return { kind: 'ok', data: body };
}

// ---- Helpers --------------------------------------------------------------

function rankCell(row: LeaderboardRow): string {
  if (row.tiedWith > 1) return `T-${row.rank}`;
  return String(row.rank);
}

function formatHandicap(hi: number | null): string {
  if (hi === null) return '—';
  return hi.toFixed(1);
}

function formatScore(value: number | null): string {
  if (value === null) return '—';
  return String(value);
}

/**
 * T6-14: format skinsCents for display. Null → `—` (with tooltip semantics
 * via the parent <td title="…">). Integer cents → formatCents.
 */
function formatSkins(cents: number | null): string {
  if (cents === null) return '—';
  // Use a small inline formatter to avoid cross-package import; mirrors
  // tournament-web/lib/format-cents.ts. Positive only (skins is winnings,
  // not signed money).
  if (!Number.isFinite(cents)) return '—';
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `$${dollars}.${remainder.toString().padStart(2, '0')}`;
}

/** A medallion for the top three, plain numerals otherwise. */
function rankBadge(row: LeaderboardRow): string {
  if (row.tiedWith === 1 && row.rank <= 3) {
    return ['🥇', '🥈', '🥉'][row.rank - 1]!;
  }
  return rankCell(row);
}

/** Map a round state to a player-facing status pill. Null → no pill. */
function statusPill(
  status: string | null,
): { label: string; live: boolean } | null {
  switch (status) {
    case 'in_progress':
      return { label: 'Live', live: true };
    case 'finalized':
      return { label: 'Final', live: false };
    case 'complete_editable':
      return { label: 'Complete', live: false };
    case 'cancelled':
      return { label: 'Cancelled', live: false };
    case 'not_started':
      return { label: 'Not started', live: false };
    default:
      return null;
  }
}

function StatusPill({ status }: { status: string | null }) {
  const pill = statusPill(status);
  if (!pill) return null;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 'var(--font-xs)',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        color: pill.live ? 'var(--color-brand-strong)' : 'var(--color-text-muted)',
        backgroundColor: pill.live ? 'var(--color-brand-tint)' : 'var(--color-surface-sunken)',
      }}
    >
      {pill.live ? <span aria-hidden style={{ color: 'var(--color-money-pos)' }}>●</span> : null}
      {pill.label}
    </span>
  );
}

// ---- Component ------------------------------------------------------------

export type LeaderboardPageProps = { eventId: string; viewerId?: string };

import { useState } from 'react';

export function LeaderboardPage({ eventId, viewerId }: LeaderboardPageProps) {
  const [scope, setScope] = useState<ScopeMode>('current');

  const query = useQuery<FetchOutcome>({
    queryKey: ['eventLeaderboard', eventId, scope],
    queryFn: () => fetchLeaderboard(eventId, scope),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  if (query.isPending) {
    return (
      <PageShell title="Leaderboard">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <LoadingCard />
      </PageShell>
    );
  }

  if (query.isError) {
    return (
      <PageShell title="Leaderboard">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard
          title="Couldn't load the leaderboard."
          error={query.error}
          onRetry={query.refetch}
        />
      </PageShell>
    );
  }

  const outcome = query.data!;

  if (outcome.kind === 'forbidden') {
    return (
      <PageShell title="Leaderboard">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard
          title="Not a participant"
          error="You aren't a participant in this event."
        />
      </PageShell>
    );
  }

  if (outcome.kind === 'unknown_event') {
    return (
      <PageShell title="Leaderboard">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard title="Event not found" error="Event not found." />
      </PageShell>
    );
  }

  const data = outcome.data;
  const allUnscored = data.rows.every((r) => r.grossThroughHole === null);
  // Hide the Skins column entirely until a round finalizes and a share exists —
  // an all-dashes column is noise during live play.
  const showSkins = data.rows.some((r) => r.skinsCents !== null);
  // F1 (Story 1.4): show the pinned Course-handicap column only when present
  // (an F1 round-scope read). Mode signpost from the F1 metadata (AC8).
  const showCH = data.rows.some((r) => r.courseHandicap != null);
  const f1 = data.f1;

  return (
    <PageShell title="Leaderboard">
      <BackLink to="/events/$eventId" params={{ eventId }} />

      {/* Scope: a two-option segmented control (bigger tap target than a select). */}
      <div
        role="tablist"
        aria-label="Leaderboard scope"
        style={{ display: 'flex', gap: 0, marginBottom: 'var(--space-3)', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-border)' }}
      >
        {([['current', 'Current round'], ['event', 'All rounds']] as const).map(([val, label]) => {
          const active = scope === val;
          return (
            <button
              key={val}
              role="tab"
              aria-selected={active}
              data-testid={`scope-${val}`}
              onClick={() => setScope(val)}
              style={{
                flex: 1,
                border: 'none',
                borderRadius: 0,
                minHeight: 'var(--control-height)',
                fontWeight: 600,
                cursor: 'pointer',
                color: active ? '#fff' : 'var(--color-text-secondary)',
                backgroundColor: active ? 'var(--color-brand-primary)' : 'var(--color-surface)',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* F1 money-mode signpost (Story 1.4, AC8). A locked event is money/P&L
          mode; an unlocked event is scores-only + private My Money. While F1
          money is dark-launched (flag off), say so explicitly. */}
      {f1 ? (
        <div
          data-testid="f1-mode-signpost"
          style={{
            marginBottom: 'var(--space-3)',
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-sm)',
            backgroundColor: 'var(--color-surface-sunken)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {f1.mode === 'money' ? (
            <>
              <strong>Money mode</strong> — standings show real money. See{' '}
              <Link to="/events/$eventId/money" params={{ eventId }}>the money board</Link>
              {f1.moneyEnabled ? null : ' (money not yet enabled for this event).'}
            </>
          ) : (
            <>
              <strong>Scores only</strong> — this event is unlocked; money is private. See{' '}
              <Link to="/events/$eventId/my-money" params={{ eventId }}>your own money</Link>.
            </>
          )}
        </div>
      ) : null}

      {/* Round header: name + status pill + foursome-results link. */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        {data.round !== null ? (
          <>
            <strong style={{ fontSize: 'var(--font-md)' }}>{data.round.name}</strong>
            <StatusPill status={data.round.status} />
            {data.round.eventRoundId !== null ? (
              <Link
                data-testid="foursome-results-link"
                to="/events/$eventId/event-rounds/$eventRoundId/foursome-results"
                params={{ eventId, eventRoundId: data.round.eventRoundId }}
                style={{ marginLeft: 'auto', fontSize: 'var(--font-sm)' }}
              >
                Foursome results →
              </Link>
            ) : null}
          </>
        ) : data.scope === 'event' ? (
          <span style={{ color: 'var(--color-text-muted)' }}>All rounds aggregated.</span>
        ) : (
          <span style={{ color: 'var(--color-text-muted)' }}>No rounds yet.</span>
        )}
      </div>

      {data.rows.length === 0 ? (
        <EmptyState title="No participants yet." />
      ) : allUnscored ? (
        <EmptyState title="No scores yet." />
      ) : (
        <ScrollableTable label="Leaderboard"><table>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Player</th>
              <th scope="col">HCP</th>
              {showCH ? <th scope="col">CH</th> : null}
              <th scope="col">Thru</th>
              <th scope="col">Gross</th>
              <th scope="col">Net</th>
              {showSkins ? <th scope="col">Skins</th> : null}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const isViewer = viewerId === row.playerId;
              return (
                <tr
                  key={row.playerId}
                  style={isViewer ? { backgroundColor: 'var(--color-brand-tint)', fontWeight: 700 } : undefined}
                >
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{rankBadge(row)}</td>
                  <td>{row.playerName}{isViewer ? ' (you)' : ''}</td>
                  <td>{formatHandicap(row.handicapIndex)}</td>
                  {showCH ? <td>{row.courseHandicap != null ? String(row.courseHandicap) : '—'}</td> : null}
                  <td>{row.throughHole}</td>
                  <td>{formatScore(row.grossThroughHole)}</td>
                  <td>{formatScore(row.netThroughHole)}</td>
                  {showSkins ? <td>{formatSkins(row.skinsCents)}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table></ScrollableTable>
      )}
    </PageShell>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/events/$eventId/leaderboard')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  const ctx = Route.useRouteContext();
  return <LeaderboardPage eventId={eventId} viewerId={ctx.player.id} />;
}
