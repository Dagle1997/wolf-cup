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
import { ViewTabs } from '../components/view-tabs';
import { ScorecardGrid } from '../components/scorecard-grid';
import type { ScorecardHole } from '../types/scorecard';

// ---- Types ----------------------------------------------------------------

type LeaderboardRow = {
  playerId: string;
  playerName: string;
  handicapIndex: number | null;
  /** F1 (Story 1.4): pinned course handicap for an F1 round-scope read. */
  courseHandicap?: number | null;
  grossThroughHole: number | null;
  netThroughHole: number | null;
  /** Story 3-4a: net-to-par over scored holes (the Wolf "To Par"). Null if N/A. */
  netToPar: number | null;
  throughHole: number;
  rank: number;
  tiedWith: number;
  /** T6-14: skins pot share across finalized rounds. Null until any finalize. */
  skinsCents: number | null;
  /** Story 3-4a: player's F1 money for the scope in CENTS; null when not exposed. */
  moneyCents: number | null;
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

/**
 * Event-level handicap-lock metadata for the participant-facing
 * "Handicaps locked as of {date} at {pct}%" header. Optional: the backend
 * populates it; when absent the header simply isn't shown.
 *
 * - `handicapsLockedAt`: unix-ms cutoff (null/absent when not locked).
 * - `handicapAllowancePct`: integer percent of full course handicap
 *   (e.g. 80, 90, 100). Null/absent → omit the "at N%" clause (never
 *   render "at undefined%").
 */
type EventHandicapMeta = {
  handicapsLockedAt?: number | null;
  handicapAllowancePct?: number | null;
};

type LeaderboardResponse = {
  rows: LeaderboardRow[];
  round: RoundSummary | null;
  scope: 'round' | 'event';
  computedAt: string;
  f1?: F1Mode;
  /** Story (handicap allowance UI): event-level lock metadata, API-populated. */
  event?: EventHandicapMeta;
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

/** Wolf-style net-to-par: E at even, signed otherwise. Null → "—". */
function formatNetToPar(n: number | null): string {
  if (n === null) return '—';
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Per-row F1 money (CENTS → whole dollars). Null → "—" (not exposed). F1 Guyan
 * money is whole-dollar (pv=$5, pts*pv is a multiple of 100), so the /100 is
 * exact; `trunc` only matters for a hypothetical non-whole-dollar config, which
 * the engine doesn't produce for Guyan.
 */
function formatMoneyCents(cents: number | null): string {
  if (cents === null) return '—';
  const dollars = Math.trunc(cents / 100);
  if (dollars === 0) return '$0';
  return dollars > 0 ? `+$${dollars}` : `-$${Math.abs(dollars)}`;
}

/**
 * Participant-facing handicap-lock line for the leaderboard header. Returns null
 * when not locked (no banner). Mirrors the lock-handicaps page: unix-ms → YYYY-MM-DD
 * (UTC, matching how the cutoff is stored), and omits the "at N%" clause when the
 * allowance is null/undefined — never "at undefined%".
 */
function handicapLockLine(meta: EventHandicapMeta | undefined): string | null {
  const ms = meta?.handicapsLockedAt;
  if (ms == null) return null;
  const date = new Date(ms).toISOString().slice(0, 10);
  const pct = meta?.handicapAllowancePct;
  const base = `Handicaps locked as of ${date}`;
  return pct == null ? `${base}.` : `${base} at ${pct}%.`;
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

// ---- Per-player expandable scorecard (Story 3-4) --------------------------

/**
 * The scorecard API (3-2 + 3-3) hole shape. NOTE: `moneyNet` is in INTEGER
 * CENTS (player-signed; null when money not exposed or the hole is unsettled;
 * 0 on a settled push). The ScorecardGrid component expects WHOLE DOLLARS, so
 * the adapter below divides by 100 (exact for whole-dollar F1 Guyan money).
 */
type ApiScorecardHole = {
  holeNumber: number;
  par: number;
  grossScore: number | null;
  netScore: number | null;
  relativeStrokes: number;
  hasGreenie: boolean;
  hasPolie: boolean;
  hasSandie: boolean;
  /** INTEGER CENTS (player-signed). null = not exposed/unsettled; 0 = settled push. */
  moneyNet: number | null;
};

/** Adapt one API hole (moneyNet CENTS) to a grid hole (moneyNet DOLLARS). */
function toGridHole(api: ApiScorecardHole): ScorecardHole {
  return {
    holeNumber: api.holeNumber,
    par: api.par,
    grossScore: api.grossScore,
    netScore: api.netScore,
    // cents → whole dollars; null-preserving. F1 Guyan money is whole-dollar
    // (pv=$5, pts*pv is a multiple of 100), so /100 is an exact integer.
    moneyNet: api.moneyNet === null ? null : api.moneyNet / 100,
    hasGreenie: api.hasGreenie,
    hasPolie: api.hasPolie,
    hasSandie: api.hasSandie,
    relativeStrokes: api.relativeStrokes,
  };
}

type ScorecardOutcome = { kind: 'ok'; holes: ScorecardHole[] } | { kind: 'unavailable' };

/**
 * Lazy per-player scorecard panel: fetches GET /api/rounds/:roundId/players/
 * :playerId/scorecard ONLY while mounted (the parent mounts it only when the row
 * is expanded), stays fresh with a 15s refetch matching the leaderboard poll, and
 * renders the ported ScorecardGrid. Inline loading/error/unavailable — never
 * breaks the rest of the board. `roundId` is the runtime rounds.id (round.id).
 */
function RowScorecard({
  roundId,
  playerId,
  showMoney,
}: {
  roundId: string;
  playerId: string;
  showMoney: boolean;
}) {
  const q = useQuery<ScorecardOutcome>({
    queryKey: ['scorecard', roundId, playerId],
    queryFn: async () => {
      const res = await fetch(`/api/rounds/${roundId}/players/${playerId}/scorecard`, {
        credentials: 'same-origin',
      });
      if (res.status === 403 || res.status === 404) return { kind: 'unavailable' };
      if (!res.ok) throw new Error(`scorecard_fetch_failed_${res.status}`);
      const body = (await res.json()) as { holes: ApiScorecardHole[] };
      return { kind: 'ok', holes: body.holes.map(toGridHole) };
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  if (q.isPending) {
    return (
      <div data-testid="scorecard-loading" style={{ padding: 'var(--space-3)', color: 'var(--color-text-muted)' }}>
        Loading scorecard…
      </div>
    );
  }
  if (q.isError) {
    return (
      <div style={{ padding: 'var(--space-2)' }}>
        <ErrorCard title="Couldn't load scorecard." error={q.error} onRetry={q.refetch} />
      </div>
    );
  }
  if (q.data.kind === 'unavailable') {
    return (
      <div data-testid="scorecard-unavailable" style={{ padding: 'var(--space-3)', color: 'var(--color-text-muted)' }}>
        Scorecard unavailable.
      </div>
    );
  }
  return <ScorecardGrid holes={q.data.holes} showMoney={showMoney} />;
}

// ---- Component ------------------------------------------------------------

export type LeaderboardPageProps = { eventId: string; viewerId?: string };

import { Fragment, useState } from 'react';

export function LeaderboardPage({ eventId, viewerId }: LeaderboardPageProps) {
  const [scope, setScope] = useState<ScopeMode>('current');
  // Story 3-4 / 3-4a: MULTI-open expandable per-player scorecards (round scope
  // only) — matches Wolf (a card stays open until you close it).
  const [expandedPlayerIds, setExpandedPlayerIds] = useState<Set<string>>(new Set());

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
  const f1 = data.f1;

  // Story 3-4 / 3-4a: Wolf-style lean row. Columns: # | Player (HCP · thru) |
  // To Par | $ (4). Expansion: round scope only (a single runtime round.id the
  // scorecard endpoint needs); the grid's $ row shows in money mode (3-3 gate).
  const roundId = data.round?.id ?? null;
  const showMoney = f1?.mode === 'money' && f1.moneyEnabled === true;
  const colSpan = 4;
  const lockLine = handicapLockLine(data.event);

  return (
    <PageShell title="Leaderboard">
      <BackLink to="/events/$eventId" params={{ eventId }} />

      <ViewTabs set="standings" active="leaderboard" eventId={eventId} />

      {/* Participant-facing handicap-lock note (only when the event is locked). */}
      {lockLine !== null ? (
        <p
          data-testid="handicap-lock-line"
          style={{
            margin: '0 0 var(--space-3)',
            fontSize: 'var(--font-sm)',
            color: 'var(--color-text-muted)',
          }}
        >
          {lockLine}
        </p>
      ) : null}

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
              onClick={() => {
                setScope(val);
                // Clear open scorecards so switching scope doesn't auto-reopen
                // (and refetch) previously-expanded rows on return.
                setExpandedPlayerIds(new Set());
              }}
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

      {/* Status note — only shown when there's something NOT obvious from the
          board itself. When money is live, the $ totals speak for themselves, so
          no banner. We only signpost the non-obvious states: money configured but
          not switched on yet (so $ is hidden), or a scores-only/private event. */}
      {f1 && !(f1.mode === 'money' && f1.moneyEnabled) ? (
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
              <strong>Money not switched on yet</strong> — the <strong>$</strong> column is
              hidden until the organizer enables it.
            </>
          ) : (
            <>
              <strong>Scores only</strong> — money for this event stays private. See{' '}
              <Link to="/events/$eventId/my-money" params={{ eventId }}>your own money</Link>.
            </>
          )}
        </div>
      ) : null}

      {/* Round header: name + status pill + foursome-results link. */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        {data.round !== null ? (
          <>
            {/* Round name + status: their own line so the action links below
                always have full width and never get crushed on a phone. */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              <strong style={{ fontSize: 'var(--font-md)', wordBreak: 'break-word' }}>{data.round.name}</strong>
              <StatusPill status={data.round.status} />
            </div>
            {/* Action links wrap as needed; each stays on its own word
                (whiteSpace:nowrap) with a ≥44px tap target. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2) var(--space-4)', marginTop: 'var(--space-2)' }}>
              {/* One-tap back to scoring when the round is live (the return half
                  of the scoring ⇄ leaderboard round trip Josh asked for). */}
              {data.round.status === 'in_progress' ? (
                <Link
                  data-testid="leaderboard-score-link"
                  to="/rounds/$roundId/score-entry"
                  params={{ roundId: data.round.id }}
                  style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, fontSize: 'var(--font-sm)', fontWeight: 800, color: 'var(--color-brand-primary)', whiteSpace: 'nowrap' }}
                >
                  Score →
                </Link>
              ) : null}
              {data.round.eventRoundId !== null ? (
                <Link
                  data-testid="foursome-results-link"
                  to="/events/$eventId/event-rounds/$eventRoundId/foursome-results"
                  params={{ eventId, eventRoundId: data.round.eventRoundId }}
                  style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, fontSize: 'var(--font-sm)', whiteSpace: 'nowrap' }}
                >
                  Foursome results →
                </Link>
              ) : null}
            </div>
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
        // backlog #8: table-layout:fixed so an expanded row's wide hole-by-hole
        // scorecard (a min-w-max grid in a colSpan cell) can't widen the table and
        // push the collapsed To-Par/$ columns off the right edge. With fixed layout
        // the colspan cell's content overflows INTO its own nested ScrollableTable
        // scroll region instead of dictating the outer table width. Column widths
        // come from the header row (#=36, To Par=64, $=64, Player=remaining).
        <ScrollableTable label="Leaderboard"><table style={{ width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)' }}>
              <th scope="col" style={{ textAlign: 'center', width: 36 }}>#</th>
              <th scope="col" style={{ textAlign: 'left' }}>Player</th>
              <th scope="col" style={{ textAlign: 'center', width: 64 }}>To Par</th>
              <th scope="col" style={{ textAlign: 'center', width: 64 }}>$</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const isViewer = viewerId === row.playerId;
              // Round scope only: gate on BOTH a runtime round.id AND scope==='round'
              // (defensive — don't rely solely on the API returning round=null in
              // event scope; an event-aggregated view must never open a round card).
              const expandable = roundId !== null && data.scope === 'round';
              const isOpen = expandedPlayerIds.has(row.playerId);
              const panelId = `scorecard-panel-${row.playerId}`;
              const toParColor =
                row.netToPar === null
                  ? 'var(--color-text-muted)'
                  : row.netToPar < 0
                    ? 'var(--color-money-pos)'
                    : row.netToPar > 0
                      ? 'var(--color-money-neg)'
                      : 'var(--color-text-primary)';
              const moneyColor =
                row.moneyCents === null || row.moneyCents === 0
                  ? 'var(--color-text-muted)'
                  : row.moneyCents > 0
                    ? 'var(--color-money-pos)'
                    : 'var(--color-money-neg)';
              // Player name + the "HI X · CH Y · Thru Z" sub-line under it. CH (the
              // pinned course handicap) is shown when available — same as the
              // scoring screen — and omitted on event-scope reads where it's null.
              const chPart = row.courseHandicap != null ? ` · CH ${row.courseHandicap}` : '';
              const subline = `HI ${formatHandicap(row.handicapIndex)}${chPart} · ${row.throughHole === 0 ? 'not started' : `Thru ${row.throughHole}`}`;
              const nameBlock = (
                <span style={{ display: 'block', minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, lineHeight: 1.15, wordBreak: 'break-word' }}>
                    {row.playerName}{isViewer ? ' (you)' : ''}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', marginTop: 1, wordBreak: 'break-word' }}>
                    {subline}
                  </span>
                </span>
              );
              return (
                <Fragment key={row.playerId}>
                  <tr
                    style={isViewer ? { backgroundColor: 'var(--color-brand-tint)' } : undefined}
                  >
                    <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{rankBadge(row)}</td>
                    <td>
                      {expandable ? (
                        <button
                          type="button"
                          data-testid={`expand-${row.playerId}`}
                          aria-expanded={isOpen}
                          aria-controls={panelId}
                          onClick={() =>
                            setExpandedPlayerIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.playerId)) next.delete(row.playerId);
                              else next.add(row.playerId);
                              return next;
                            })
                          }
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            width: '100%',
                            minHeight: 'var(--control-height)',
                            padding: 0,
                            background: 'none',
                            border: 'none',
                            font: 'inherit',
                            color: 'inherit',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          <span aria-hidden style={{ color: 'var(--color-text-muted)', width: '0.8em', flex: '0 0 auto' }}>
                            {isOpen ? '▾' : '▸'}
                          </span>
                          {nameBlock}
                        </button>
                      ) : (
                        nameBlock
                      )}
                    </td>
                    <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: toParColor }}>
                      {formatNetToPar(row.netToPar)}
                    </td>
                    <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: moneyColor }}>
                      {formatMoneyCents(row.moneyCents)}
                    </td>
                  </tr>
                  {expandable && isOpen ? (
                    <tr>
                      <td colSpan={colSpan} style={{ padding: 0, background: 'var(--color-surface-sunken)' }}>
                        {/* The disclosure region the row's aria-controls points at
                            (a <tr> is not an appropriate aria-controls target). */}
                        <div id={panelId} role="region" aria-label={`${row.playerName} scorecard`}>
                          <RowScorecard roundId={roundId} playerId={row.playerId} showMoney={showMoney} />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
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
