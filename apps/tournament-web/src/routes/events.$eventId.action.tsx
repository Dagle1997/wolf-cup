/**
 * "The Action" — the player-facing betting board.
 *
 * Route: /events/:eventId/action
 *
 * A player posts a clean me-vs-opponent head-to-head bet (the viewer is always
 * the stakeholder of side A, so the server's creator-is-a-stakeholder rule is
 * always satisfied) and sees the audience-bounded action board below. The board
 * is already scoped server-side to the bets this viewer may see.
 *
 * Backend (do NOT change):
 *   GET  /api/events/:eventId/bet-options  → { roster, rounds }
 *   GET  /api/events/:eventId/action-board → { bets, viewerId }
 *   POST /api/events/:eventId/action-bets  → create a h2h bet
 *
 * Built on the shared primitives (PageShell, Card, Button, FormField,
 * ScrollableTable, LoadingCard, ErrorCard, EmptyState) + the ViewTabs nav, to
 * match the admin bet form and the rest of tournament-web.
 *
 * Dual-export: `Route` for TanStack file-route registration AND
 * `ActionBoardPage` for direct test rendering.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { ViewTabs } from '../components/view-tabs';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';
import { Card } from '../components/card';
import { Button } from '../components/button';
import { FormField } from '../components/form-field';
import { ScrollableTable } from '../components/scrollable-table';

// ---- Types ----------------------------------------------------------------

type RosterEntry = { playerId: string; name: string | null };
type RoundEntry = { eventRoundId: string; roundNumber: number };
type BetOptionsResponse = { roster: RosterEntry[]; rounds: RoundEntry[] };

type BetViewSide = {
  side: 'A' | 'B';
  stakeholderPlayerId: string;
  stakeholderName: string | null;
  subjectPlayerId: string;
  subjectName: string | null;
  subjectNetTotal: number | null;
};
type BetView = {
  betId: string;
  eventRoundId: string;
  betType: string;
  basis: string;
  holeScope: string;
  stakeCents: number;
  state: string;
  visibility: 'event_wide' | 'stakeholders_only';
  winnerSubjectId: string | null;
  marginNet: number;
  sides: BetViewSide[];
};
type ActionBoardResponse = { bets: BetView[]; viewerId: string };

const HOLE_SCOPES = ['full18', 'front', 'back', 'total'] as const;
type HoleScope = (typeof HOLE_SCOPES)[number];

const STATE_LABEL: Record<string, string> = {
  live: 'Live',
  provisional: 'Provisional',
  settled: 'Settled',
  push: 'Push',
  void: 'Void',
  unsettleable: 'Needs review',
  finalized: 'Final',
};

const holeScopeLabel = (s: string): string =>
  s === 'full18' ? 'Full 18' : s === 'front' ? 'Front 9' : s === 'back' ? 'Back 9' : s === 'total' ? 'Total' : s;

const fmtUsd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const errorMessageFor = (code: string): string => {
  switch (code) {
    case 'betting_closed_scores_exist':
      return 'Scoring has started on those holes — betting is closed for this segment.';
    case 'creator_not_a_stakeholder':
      return 'You can only post a bet that you back.';
    case 'players_not_in_event':
      return 'Both players must be on the event roster.';
    case 'same_stakeholder_both_sides':
      return 'Pick an opponent other than yourself.';
    case 'non_whole_dollar_stake':
      return 'Stakes must be whole dollars (no cents).';
    default:
      return '';
  }
};

// ---- Fetchers -------------------------------------------------------------

async function fetchBetOptions(eventId: string): Promise<BetOptionsResponse> {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/bet-options`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as BetOptionsResponse;
}

async function fetchActionBoard(eventId: string): Promise<ActionBoardResponse> {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/action-board`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as ActionBoardResponse;
}

// ---- Component ------------------------------------------------------------

export function ActionBoardPage({ eventId }: { eventId: string }) {
  const qc = useQueryClient();

  const options = useQuery<BetOptionsResponse, Error>({
    queryKey: ['bet-options', eventId],
    queryFn: () => fetchBetOptions(eventId),
    retry: false,
  });
  const board = useQuery<ActionBoardResponse, Error>({
    queryKey: ['action-board', eventId],
    queryFn: () => fetchActionBoard(eventId),
    retry: false,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  // The viewer is always side A's stakeholder. The board response carries it.
  const viewerId = board.data?.viewerId ?? '';

  const roster = options.data?.roster ?? [];
  const rounds = options.data?.rounds ?? [];
  const nameById = useMemo(() => new Map(roster.map((r) => [r.playerId, r.name])), [roster]);

  // Roster minus the viewer — the choosable opponents.
  const opponents = useMemo(
    () => roster.filter((r) => r.playerId !== viewerId),
    [roster, viewerId],
  );

  const [eventRoundId, setEventRoundId] = useState('');
  const [basis, setBasis] = useState<'net' | 'gross'>('net');
  const [holeScope, setHoleScope] = useState<HoleScope>('full18');
  const [stakeDollars, setStakeDollars] = useState('20');
  // "You back" — the subject for the viewer's side. Defaults to the viewer.
  const [subjectA, setSubjectA] = useState('');
  // The opponent — both the subject AND the stakeholder of side B (they back
  // themselves), keeping it a clean me-vs-them bet.
  const [opponentId, setOpponentId] = useState('');
  const [visibility, setVisibility] = useState<'event_wide' | 'stakeholders_only'>('event_wide');

  // "You back" defaults to the viewer themselves once we know who that is.
  const effectiveSubjectA = subjectA || viewerId;

  const resetForm = () => {
    setSubjectA('');
    setOpponentId('');
    setStakeDollars('20');
  };

  const buildBody = () => ({
    eventRoundId,
    betType: 'h2h' as const,
    basis,
    holeScope,
    stakeCents: Number(stakeDollars) * 100,
    sideA: { stakeholderPlayerId: viewerId, subjectPlayerId: effectiveSubjectA },
    sideB: { stakeholderPlayerId: opponentId, subjectPlayerId: opponentId },
    visibility,
  });

  const create = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/action-bets`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        throw new Error(body.code ?? `http_${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['action-board', eventId] });
      resetForm();
    },
  });

  // ---- Loading / error gates (options drive the form) ----
  if (options.isPending || board.isPending) {
    return (
      <PageShell title="The Action">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <LoadingCard />
      </PageShell>
    );
  }
  if (options.isError) {
    return (
      <PageShell title="The Action">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard title="Couldn't load betting options." error={options.error} onRetry={options.refetch} />
      </PageShell>
    );
  }

  // Whole-dollar stakes only (no cents) — keeps the stakeCents conversion exact.
  const stakeValid = /^\d+$/.test(stakeDollars.trim()) && Number(stakeDollars) >= 1;
  const formValid = eventRoundId !== '' && opponentId !== '' && opponentId !== viewerId && stakeValid;

  const createError = create.isError ? create.error.message : null;
  const youName = nameById.get(viewerId) ?? 'You';

  return (
    <PageShell title="The Action">
      <BackLink to="/events/$eventId" params={{ eventId }} />
      <ViewTabs set="money" active="action" eventId={eventId} />

      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)' }}>
        Post a head-to-head bet against someone else in the event. You back your side; the lower score
        over the chosen holes wins. It settles automatically from recorded scores.
      </p>

      {/* ---- Post a bet ---- */}
      {opponents.length < 1 ? (
        <EmptyState
          icon="🎲"
          title="No one to bet yet"
          body="Once more players join the event you can post a bet here."
        />
      ) : (
        <Card
          data-testid="action-form"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
            alignItems: 'flex-end',
            marginTop: 'var(--space-4)',
          }}
        >
          <FormField label="Round">
            <select
              data-testid="round-select"
              value={eventRoundId}
              onChange={(e) => setEventRoundId(e.target.value)}
            >
              <option value="">Select…</option>
              {rounds.map((r) => (
                <option key={r.eventRoundId} value={r.eventRoundId}>
                  Round {r.roundNumber}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Scoring">
            <div
              role="tablist"
              aria-label="Scoring"
              style={{ display: 'flex', gap: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-border)' }}
            >
              {([['net', 'Net'], ['gross', 'Gross']] as const).map(([val, label]) => {
                const active = basis === val;
                return (
                  <button
                    key={val}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-testid={`basis-${val}`}
                    onClick={() => setBasis(val)}
                    style={{
                      flex: 1,
                      border: 'none',
                      borderRadius: 0,
                      minHeight: 'var(--control-height)',
                      padding: '0 var(--space-4)',
                      fontWeight: 600,
                      fontSize: 'var(--font-sm)',
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
          </FormField>

          <FormField label="Holes">
            <select
              data-testid="scope-select"
              value={holeScope}
              onChange={(e) => setHoleScope(e.target.value as HoleScope)}
            >
              {HOLE_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {holeScopeLabel(s)}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Stake ($, whole dollars)">
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              data-testid="stake-input"
              value={stakeDollars}
              onChange={(e) => setStakeDollars(e.target.value)}
            />
          </FormField>

          <FormField label="You back">
            <select
              data-testid="subject-a-select"
              value={effectiveSubjectA}
              onChange={(e) => setSubjectA(e.target.value)}
            >
              <option value={viewerId}>{youName} (You)</option>
              {opponents.map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {p.name ?? '—'}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Opponent">
            <select
              data-testid="opponent-select"
              value={opponentId}
              onChange={(e) => setOpponentId(e.target.value)}
            >
              <option value="">Select…</option>
              {opponents.map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {p.name ?? '—'}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Who can see this bet">
            <div
              role="tablist"
              aria-label="Who can see this bet"
              style={{ display: 'flex', gap: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-border)' }}
            >
              {([['event_wide', 'Entire event'], ['stakeholders_only', 'Just stakeholders']] as const).map(
                ([val, label]) => {
                  const active = visibility === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      data-testid={`visibility-${val}`}
                      onClick={() => setVisibility(val)}
                      style={{
                        flex: 1,
                        border: 'none',
                        borderRadius: 0,
                        minHeight: 'var(--control-height)',
                        padding: '0 var(--space-3)',
                        fontWeight: 600,
                        fontSize: 'var(--font-sm)',
                        cursor: 'pointer',
                        color: active ? '#fff' : 'var(--color-text-secondary)',
                        backgroundColor: active ? 'var(--color-brand-primary)' : 'var(--color-surface)',
                      }}
                    >
                      {label}
                    </button>
                  );
                },
              )}
            </div>
          </FormField>

          <Button
            data-testid="post-bet-btn"
            disabled={!formValid || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Posting…' : 'Post bet'}
          </Button>

          {createError ? (
            <p role="alert" style={{ flexBasis: '100%', margin: 0, color: 'var(--color-danger)' }}>
              {errorMessageFor(createError) || `Couldn't post the bet (${createError}).`}
            </p>
          ) : null}
        </Card>
      )}

      {/* ---- The board ---- */}
      <h2 style={{ fontSize: 'var(--font-md)', marginTop: 'var(--space-5)' }}>The board</h2>
      {board.isError ? (
        <ErrorCard title="Couldn't load the board." error={board.error} onRetry={board.refetch} />
      ) : (board.data?.bets.length ?? 0) === 0 ? (
        <EmptyState icon="🎲" title="No bets yet" body="No bets yet — post one above." />
      ) : (
        <ScrollableTable label="The Action board">
          <table>
            <thead>
              <tr>
                <th>Matchup</th>
                <th>Stake</th>
                <th>Status</th>
                <th>Who can see</th>
              </tr>
            </thead>
            <tbody>
              {board.data!.bets.map((b) => {
                const a = b.sides.find((s) => s.side === 'A');
                const bb = b.sides.find((s) => s.side === 'B');
                const matchup = `${a?.subjectName ?? '—'} vs ${bb?.subjectName ?? '—'}`;
                const winnerName =
                  b.winnerSubjectId != null
                    ? b.sides.find((s) => s.subjectPlayerId === b.winnerSubjectId)?.subjectName ??
                      nameById.get(b.winnerSubjectId) ??
                      null
                    : null;
                return (
                  <tr key={b.betId} data-testid={`action-row-${b.betId}`}>
                    <td>
                      {matchup}
                      <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-xs)', marginTop: 'var(--space-1)' }}>
                        {b.basis} · {holeScopeLabel(b.holeScope)}
                      </div>
                    </td>
                    <td>{fmtUsd(b.stakeCents)}</td>
                    <td data-testid={`action-state-${b.betId}`}>
                      {STATE_LABEL[b.state] ?? b.state}
                      {b.state === 'settled' && winnerName ? (
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-xs)', marginTop: 'var(--space-1)' }}>
                          {winnerName} by {b.marginNet}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span
                        data-testid={`action-visibility-${b.betId}`}
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-sm, 4px)',
                          fontSize: 'var(--font-xs)',
                          fontWeight: 600,
                          color: 'var(--color-text-secondary)',
                          border: '1px solid var(--color-border)',
                          backgroundColor: 'var(--color-surface)',
                        }}
                      >
                        {b.visibility === 'event_wide' ? 'Public' : 'Private'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollableTable>
      )}
    </PageShell>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/events/$eventId/action')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <ActionBoardPage eventId={eventId} />;
}
