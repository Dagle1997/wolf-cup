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

// Whole-dollar display for the "Your take" P&L (no trailing cents).
const fmtWholeDollar = (cents: number): string => `$${Math.round(cents / 100)}`;
const fmtSignedWholeDollar = (cents: number): string =>
  cents > 0 ? `+$${Math.round(cents / 100)}` : cents < 0 ? `−$${Math.round(Math.abs(cents) / 100)}` : '$0';

const errorMessageFor = (code: string): string => {
  switch (code) {
    case 'betting_closed_scores_exist':
      return 'Scoring has started — too late to cancel.';
    case 'creator_not_a_stakeholder':
      return 'You can only post a bet that you back.';
    case 'players_not_in_event':
      return 'Both players must be on the event roster.';
    case 'same_stakeholder_both_sides':
      return 'Pick an opponent other than yourself.';
    case 'non_whole_dollar_stake':
      return 'Stakes must be whole dollars (no cents).';
    case 'stake_exceeds_self_serve_cap':
      return 'Stakes are capped at $1,000.';
    case 'not_a_stakeholder':
      return "You can't cancel this bet.";
    case 'cannot_cancel_terminal':
      return 'This bet is already settled or cancelled.';
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
  // The opponent — the subject of side B. By default the opponent ALSO backs
  // their own side (a clean me-vs-them bet); open-book lets someone else cover.
  const [opponentId, setOpponentId] = useState('');
  // Open book: when on, a third party covers the opponent's side.
  const [openBook, setOpenBook] = useState(false);
  const [sideBBacker, setSideBBacker] = useState('');
  const [visibility, setVisibility] = useState<'event_wide' | 'stakeholders_only'>('event_wide');
  // Cleared on the next post attempt; shown after a successful post.
  const [posted, setPosted] = useState(false);

  // "You back" defaults to the viewer themselves once we know who that is.
  const effectiveSubjectA = subjectA || viewerId;
  // Side B's stakeholder = the chosen backer in open-book mode, else the
  // opponent backs themselves.
  const effectiveSideBBacker = openBook ? sideBBacker : opponentId;

  const resetForm = () => {
    setSubjectA('');
    setOpponentId('');
    setStakeDollars('20');
    setOpenBook(false);
    setSideBBacker('');
  };

  const buildBody = () => ({
    eventRoundId,
    betType: 'h2h' as const,
    basis,
    holeScope,
    stakeCents: Number(stakeDollars) * 100,
    sideA: { stakeholderPlayerId: viewerId, subjectPlayerId: effectiveSubjectA },
    sideB: { stakeholderPlayerId: effectiveSideBBacker, subjectPlayerId: opponentId },
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
      setPosted(true);
    },
  });

  // Cancel one of the viewer's OWN live bets.
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const cancelBet = useMutation<unknown, Error, string>({
    mutationFn: async (betId: string) => {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/action-bets/${encodeURIComponent(betId)}/cancel`,
        { method: 'POST', credentials: 'same-origin' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        throw new Error(body.code ?? `http_${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      setConfirmCancelId(null);
      qc.invalidateQueries({ queryKey: ['action-board', eventId] });
    },
  });
  const armCancel = (betId: string) => {
    cancelBet.reset();
    setConfirmCancelId(betId);
  };
  const dismissCancel = () => {
    cancelBet.reset();
    setConfirmCancelId(null);
  };

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
  // Open-book backer must be picked (and ≠ the opponent's subject, who'd just
  // be backing themselves anyway) when open book is on.
  const backerValid = !openBook || (sideBBacker !== '' && sideBBacker !== effectiveSubjectA);
  const formValid =
    eventRoundId !== '' &&
    opponentId !== '' &&
    opponentId !== effectiveSubjectA &&
    stakeValid &&
    backerValid;

  const createError = create.isError ? create.error.message : null;
  const youName = nameById.get(viewerId) ?? 'You';

  // Live placement summary (uses the chosen names + stake + holes).
  const subjectAName = nameById.get(effectiveSubjectA) ?? (effectiveSubjectA === viewerId ? youName : '—');
  const opponentName = opponentId !== '' ? nameById.get(opponentId) ?? '—' : null;
  const backerName =
    openBook && sideBBacker !== '' ? nameById.get(sideBBacker) ?? '—' : null;

  // Cancelled (void) bets shouldn't clutter the board.
  const visibleBets = (board.data?.bets ?? []).filter((b) => b.state !== 'void');

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

          {/* ---- Open book: someone else can cover the opponent's side ---- */}
          <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
            <label
              className="form-field"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-2)' }}
            >
              <input
                type="checkbox"
                data-testid="open-book-toggle"
                checked={openBook}
                onChange={(e) => {
                  setOpenBook(e.target.checked);
                  if (!e.target.checked) setSideBBacker('');
                }}
              />
              <span className="form-field__label" style={{ margin: 0 }}>
                Someone else covers {opponentName ?? 'the opponent'}&rsquo;s side?
              </span>
            </label>

            {openBook ? (
              <FormField label="Backer (covers the opponent)">
                <select
                  data-testid="side-b-backer-select"
                  value={sideBBacker}
                  onChange={(e) => setSideBBacker(e.target.value)}
                >
                  <option value="">Select…</option>
                  {roster
                    .filter((p) => p.playerId !== effectiveSubjectA)
                    .map((p) => (
                      <option key={p.playerId} value={p.playerId}>
                        {p.playerId === viewerId ? `${p.name ?? '—'} (You)` : p.name ?? '—'}
                      </option>
                    ))}
                </select>
              </FormField>
            ) : null}
          </div>

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

          {/* ---- Plain-English placement summary (updates live) ---- */}
          <p
            data-testid="placement-summary"
            style={{
              flexBasis: '100%',
              margin: 0,
              color: 'var(--color-text-muted)',
              fontSize: 'var(--font-sm)',
            }}
          >
            {opponentName && stakeValid ? (
              <>
                You&rsquo;re betting {fmtWholeDollar(Number(stakeDollars) * 100)} ({basis}) that{' '}
                <strong>{subjectAName}</strong> beats <strong>{opponentName}</strong> over{' '}
                {holeScopeLabel(holeScope)}.
                {backerName ? (
                  <>
                    {' '}
                    — <strong>{backerName}</strong> covers {opponentName}&rsquo;s side.
                  </>
                ) : null}
              </>
            ) : (
              'Pick an opponent and a stake to set up your bet.'
            )}
          </p>

          <Button
            data-testid="post-bet-btn"
            disabled={!formValid || create.isPending}
            onClick={() => {
              setPosted(false);
              create.mutate();
            }}
          >
            {create.isPending ? 'Posting…' : 'Post bet'}
          </Button>

          {createError ? (
            <p role="alert" style={{ flexBasis: '100%', margin: 0, color: 'var(--color-danger)' }}>
              {errorMessageFor(createError) || `Couldn't post the bet (${createError}).`}
            </p>
          ) : posted ? (
            <p
              role="status"
              data-testid="post-success"
              style={{ flexBasis: '100%', margin: 0, color: 'var(--color-money-pos)', fontWeight: 600 }}
            >
              ✓ Bet posted — it&rsquo;s on the board below.
            </p>
          ) : null}
        </Card>
      )}

      {/* ---- The board ---- */}
      <h2 style={{ fontSize: 'var(--font-md)', marginTop: 'var(--space-5)' }}>The board</h2>
      {cancelBet.isError ? (
        <p role="alert" style={{ color: 'var(--color-danger)', marginTop: 'var(--space-3)' }}>
          {errorMessageFor(cancelBet.error.message) || `Couldn't cancel the bet (${cancelBet.error.message}).`}
        </p>
      ) : null}
      {board.isError ? (
        <ErrorCard title="Couldn't load the board." error={board.error} onRetry={board.refetch} />
      ) : visibleBets.length === 0 ? (
        <EmptyState icon="🎲" title="No bets yet" body="No bets yet — post one above." />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          {visibleBets.map((b) => {
            const a = b.sides.find((s) => s.side === 'A');
            const bb = b.sides.find((s) => s.side === 'B');
            const matchup = `${a?.subjectName ?? '—'} vs ${bb?.subjectName ?? '—'}`;
            const winnerName =
              b.winnerSubjectId != null
                ? b.sides.find((s) => s.subjectPlayerId === b.winnerSubjectId)?.subjectName ??
                  nameById.get(b.winnerSubjectId) ??
                  null
                : null;

            // The viewer's signed P&L on this bet (h2h = winner takes stake).
            const mySide = b.sides.find((s) => s.stakeholderPlayerId === viewerId);
            const isStakeholder = mySide != null;
            let take: { text: string; color: string } = {
              text: '—',
              color: 'var(--color-text-muted)',
            };
            if (isStakeholder) {
              if (b.state === 'push') {
                take = { text: '$0', color: 'var(--color-text-muted)' };
              } else if (b.state === 'settled' || b.state === 'finalized') {
                if (b.winnerSubjectId == null) {
                  take = { text: '$0', color: 'var(--color-text-muted)' };
                } else if (mySide.subjectPlayerId === b.winnerSubjectId) {
                  take = { text: fmtSignedWholeDollar(b.stakeCents), color: 'var(--color-money-pos)' };
                } else {
                  take = { text: fmtSignedWholeDollar(-b.stakeCents), color: 'var(--color-money-neg)' };
                }
              } else if (b.state === 'live' || b.state === 'provisional') {
                take = { text: 'pending', color: 'var(--color-text-muted)' };
              } else {
                take = { text: '—', color: 'var(--color-text-muted)' };
              }
            }

            const canCancel = isStakeholder && b.state === 'live';

            // One stacked CARD per bet — readable on a phone, no sideways scroll.
            return (
              <div
                key={b.betId}
                data-testid={`action-row-${b.betId}`}
                className="card"
                style={{ padding: 'var(--space-3) var(--space-4)' }}
              >
                {/* Matchup + stake */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                  <strong style={{ fontSize: 'var(--font-md)', wordBreak: 'break-word' }}>{matchup}</strong>
                  <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtUsd(b.stakeCents)}</span>
                </div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-xs)', marginTop: 'var(--space-1)' }}>
                  {b.basis} · {holeScopeLabel(b.holeScope)}
                </div>

                {/* Your take (prominent) + status + visibility badge */}
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                  {isStakeholder ? (
                    <span
                      data-testid={`action-take-${b.betId}`}
                      style={{ color: take.color, fontWeight: take.text === '—' || take.text === 'pending' ? 400 : 800, fontSize: 'var(--font-lg)' }}
                    >
                      {take.text}
                    </span>
                  ) : (
                    <span data-testid={`action-take-${b.betId}`} style={{ color: 'var(--color-text-muted)' }}>—</span>
                  )}
                  <span data-testid={`action-state-${b.betId}`} style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)' }}>
                    {STATE_LABEL[b.state] ?? b.state}
                    {b.state === 'settled' && winnerName ? (
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-xs)' }}> · {winnerName} by {b.marginNet}</span>
                    ) : null}
                  </span>
                  <span
                    data-testid={`action-visibility-${b.betId}`}
                    style={{
                      marginLeft: 'auto',
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
                </div>

                {/* Cancel (only your own live bet) */}
                {canCancel ? (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    {confirmCancelId === b.betId ? (
                      <span className="actions-row" style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <Button
                          variant="danger"
                          data-testid={`confirm-cancel-${b.betId}`}
                          aria-label={`Confirm cancel of bet: ${matchup}`}
                          disabled={cancelBet.isPending}
                          onClick={() => cancelBet.mutate(b.betId)}
                        >
                          {cancelBet.isPending ? 'Cancelling…' : 'Confirm cancel'}
                        </Button>
                        <Button variant="secondary" data-testid={`dismiss-cancel-${b.betId}`} onClick={dismissCancel}>
                          Keep
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="secondary"
                        data-testid={`cancel-${b.betId}`}
                        aria-label={`Cancel bet: ${matchup}`}
                        onClick={() => armCancel(b.betId)}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
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
