/**
 * "The Action" admin betting page.
 *
 * Route: /admin/events/:eventId/bets
 *
 * The organizer enters a head-to-head/match-play bet between two roster members
 * and it auto-settles from recorded scores into the pairwise settle-up. Subjects
 * (whose play decides the bet) default to being their own stakeholder (who holds
 * the money); "Open book" reveals separate stakeholder pickers so a non-playing
 * member can back a side (FR8/FR10).
 *
 * Story 1.4: per-row Edit (loads the bet into the form → Save → confirm) and
 * Void (two-step confirm). The admin may correct any bet anytime; the safety net
 * is the confirmation + the audit log. Stakes are WHOLE DOLLARS only.
 *
 * Built on the shared primitives — PageShell, Card, Button, FormField,
 * ScrollableTable — and design tokens (no per-page inline style objects).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';
import { Card } from '../components/card';
import { Button } from '../components/button';
import { FormField } from '../components/form-field';
import { ScrollableTable } from '../components/scrollable-table';

type RosterEntry = { playerId: string; name: string };
type RoundEntry = { eventRoundId: string; roundNumber: number };
type PairingsResponse = {
  rounds: Array<{ eventRoundId: string; roundNumber: number }>;
  roster: RosterEntry[];
};

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
  line: number | null;
  state: string;
  winnerSubjectId: string | null;
  marginNet: number;
  visibility: 'event_wide' | 'stakeholders_only';
  sides: BetViewSide[];
};

const HOLE_SCOPES = ['full18', 'front', 'back', 'total'] as const;

async function fetchPairings(eventId: string): Promise<PairingsResponse> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/pairings`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as PairingsResponse;
}

async function fetchBets(eventId: string): Promise<{ bets: BetView[] }> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/bets`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as { bets: BetView[] };
}

const fmtUsd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const STATE_LABEL: Record<string, string> = {
  live: 'Live',
  provisional: 'In progress',
  settled: 'Settled',
  push: 'Push',
  void: 'Void',
  unsettleable: 'Needs review',
  finalized: 'Final',
};

const subTextStyle: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  fontSize: 'var(--font-xs)',
  marginTop: 'var(--space-1)',
};

const errorMessageFor = (code: string): string => {
  switch (code) {
    case 'betting_closed_scores_exist':
      return 'Too late — a score already exists on one of these holes.';
    case 'players_not_in_event':
      return 'All players must be on the event roster.';
    case 'same_stakeholder_both_sides':
      return 'The two backers must be different people.';
    case 'non_whole_dollar_stake':
      return 'Stakes must be whole dollars (no cents).';
    case 'over_under_needs_line':
      return 'Over/Under needs a line (a whole number, 1–200).';
    case 'over_under_single_subject':
      return 'Over/Under is one player — pick the player the line is on.';
    case 'cannot_edit_terminal':
      return 'That bet is voided or final and can no longer be changed.';
    case 'cannot_void_terminal':
      return 'That bet is already voided or final.';
    default:
      return '';
  }
};

export function AdminBetsPage({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const pairings = useQuery<PairingsResponse, Error>({
    queryKey: ['admin-bets-pairings', eventId],
    queryFn: () => fetchPairings(eventId),
    retry: false,
  });
  const betsQuery = useQuery<{ bets: BetView[] }, Error>({
    queryKey: ['admin-bets', eventId],
    queryFn: () => fetchBets(eventId),
    retry: false,
  });

  const [eventRoundId, setEventRoundId] = useState('');
  const [betType, setBetType] = useState<'h2h' | 'per_hole_match' | 'over_under'>('h2h');
  const [basis, setBasis] = useState<'net' | 'gross'>('net');
  const [holeScope, setHoleScope] = useState<(typeof HOLE_SCOPES)[number]>('full18');
  const [stakeDollars, setStakeDollars] = useState('20');
  // over_under ONLY: the strokes line the subject's total is graded against.
  const [line, setLine] = useState('');
  const [subjectA, setSubjectA] = useState('');
  const [subjectB, setSubjectB] = useState('');
  const [openBook, setOpenBook] = useState(false);
  const [stakeholderA, setStakeholderA] = useState('');
  const [stakeholderB, setStakeholderB] = useState('');
  const [visibility, setVisibility] = useState<'event_wide' | 'stakeholders_only'>('event_wide');
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null);
  // Story 1.4 edit-in-form mode: which bet is being edited + the confirm gate.
  const [editingBetId, setEditingBetId] = useState<string | null>(null);
  const [confirmEditing, setConfirmEditing] = useState(false);
  const roundSelectRef = useRef<HTMLSelectElement>(null);

  const roster = pairings.data?.roster ?? [];
  const rounds: RoundEntry[] = useMemo(
    () => (pairings.data?.rounds ?? []).map((r) => ({ eventRoundId: r.eventRoundId, roundNumber: r.roundNumber })),
    [pairings.data],
  );
  const nameById = useMemo(() => new Map(roster.map((r) => [r.playerId, r.name])), [roster]);

  // Build the request payload from the current form state. Stakes are WHOLE
  // DOLLARS (no cents); the submit gate (stakeValid) guarantees an integer, so
  // the cents conversion is non-lossy — we never round a fractional entry.
  const buildBody = () => {
    if (betType === 'over_under') {
      // ONE subject (subjectA) + a line. side A backs UNDER, side B backs OVER;
      // both carry the same subject. The two stakeholders are the under/over
      // backers (reuse the open-book stakeholder fields, always shown for o/u).
      return {
        eventRoundId,
        betType,
        basis,
        holeScope,
        stakeCents: Number(stakeDollars) * 100,
        line: Number(line),
        sideA: { stakeholderPlayerId: stakeholderA, subjectPlayerId: subjectA },
        sideB: { stakeholderPlayerId: stakeholderB, subjectPlayerId: subjectA },
        visibility,
      };
    }
    const stA = openBook ? stakeholderA : subjectA;
    const stB = openBook ? stakeholderB : subjectB;
    return {
      eventRoundId,
      betType,
      basis,
      holeScope,
      stakeCents: Number(stakeDollars) * 100,
      sideA: { stakeholderPlayerId: stA, subjectPlayerId: subjectA },
      sideB: { stakeholderPlayerId: stB, subjectPlayerId: subjectB },
      visibility,
    };
  };

  const clearPlayers = () => {
    setSubjectA('');
    setSubjectB('');
    setStakeholderA('');
    setStakeholderB('');
    setLine('');
  };
  const exitEdit = () => {
    setEditingBetId(null);
    setConfirmEditing(false);
    setConfirmVoidId(null);
    setOpenBook(false);
    clearPlayers();
    edit.reset();
  };

  // Load an existing bet into the form for editing (admin may correct anytime).
  // Stale mutation banners from a prior create/void are cleared so the form
  // doesn't show an error that belongs to a different action.
  const loadForEdit = (b: BetView) => {
    create.reset();
    edit.reset();
    voidBet.reset();
    setConfirmVoidId(null);
    const a = b.sides.find((s) => s.side === 'A');
    const bb = b.sides.find((s) => s.side === 'B');
    setEditingBetId(b.betId);
    setConfirmEditing(false);
    setEventRoundId(b.eventRoundId);
    setBetType(
      b.betType === 'per_hole_match' ? 'per_hole_match' : b.betType === 'over_under' ? 'over_under' : 'h2h',
    );
    setLine(b.line != null ? String(b.line) : '');
    setBasis(b.basis === 'gross' ? 'gross' : 'net');
    setHoleScope(
      (HOLE_SCOPES as readonly string[]).includes(b.holeScope)
        ? (b.holeScope as (typeof HOLE_SCOPES)[number])
        : 'full18',
    );
    // Exact value (no rounding) — a legacy non-whole-dollar bet shows e.g. "25.5"
    // and the whole-dollar gate forces a correction rather than silently rounding.
    setStakeDollars(String(b.stakeCents / 100));
    setSubjectA(a?.subjectPlayerId ?? '');
    setSubjectB(bb?.subjectPlayerId ?? '');
    const ob =
      !!a &&
      !!bb &&
      (a.stakeholderPlayerId !== a.subjectPlayerId || bb.stakeholderPlayerId !== bb.subjectPlayerId);
    setOpenBook(ob);
    setStakeholderA(a?.stakeholderPlayerId ?? '');
    setStakeholderB(bb?.stakeholderPlayerId ?? '');
    setVisibility(b.visibility === 'stakeholders_only' ? 'stakeholders_only' : 'event_wide');
    // Bring the form into view and focus its first control so keyboard / SR users
    // know the form changed (scrollIntoView is a no-op under jsdom).
    roundSelectRef.current?.scrollIntoView?.({ block: 'center' });
    roundSelectRef.current?.focus?.();
  };

  const create = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/bets`, {
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
      qc.invalidateQueries({ queryKey: ['admin-bets', eventId] });
      clearPlayers();
    },
  });

  // Story 1.4: edit a live bet (two-step confirm). Recompute-on-read reflects
  // the new config; the change is recorded in the audit log.
  const edit = useMutation<unknown, Error, string>({
    mutationFn: async (betId: string) => {
      const res = await fetch(
        `/api/admin/events/${encodeURIComponent(eventId)}/bets/${encodeURIComponent(betId)}`,
        {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildBody()),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        throw new Error(body.code ?? `http_${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-bets', eventId] });
      exitEdit();
    },
  });

  // Story 1.4: void a bet (two-step confirm). A voided bet drops out of
  // settle-up; the durable state flips to 'void' (recompute yields no edges).
  const voidBet = useMutation<unknown, Error, string>({
    mutationFn: async (betId: string) => {
      const res = await fetch(
        `/api/admin/events/${encodeURIComponent(eventId)}/bets/${encodeURIComponent(betId)}/void`,
        { method: 'POST', credentials: 'same-origin' },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        throw new Error(body.code ?? `http_${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      setConfirmVoidId(null);
      qc.invalidateQueries({ queryKey: ['admin-bets', eventId] });
    },
  });

  const armVoid = (betId: string) => {
    voidBet.reset();
    setConfirmVoidId(betId);
  };
  const cancelVoid = () => {
    voidBet.reset();
    setConfirmVoidId(null);
  };

  if (pairings.isPending) {
    return (
      <PageShell title="The Action">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
        <LoadingCard />
      </PageShell>
    );
  }
  if (pairings.isError) {
    return (
      <PageShell title="The Action">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
        <ErrorCard error="Couldn't load the roster." onRetry={pairings.refetch} />
      </PageShell>
    );
  }

  // Whole-dollar stakes only (no cents): digits only, >= 1. Rejects '25.5',
  // '1e2', '', '-1' — so the cents conversion in buildBody is always exact.
  const stakeValid = /^\d+$/.test(stakeDollars.trim()) && Number(stakeDollars) >= 1;
  const lineNum = Number(line);
  const lineValid =
    line !== '' && Number.isInteger(lineNum) && lineNum >= 1 && lineNum <= 200;
  const formValid =
    betType === 'over_under'
      ? eventRoundId !== '' &&
        stakeValid &&
        lineValid &&
        subjectA !== '' &&
        stakeholderA !== '' &&
        stakeholderB !== '' &&
        stakeholderA !== stakeholderB
      : eventRoundId !== '' &&
        subjectA !== '' &&
        subjectB !== '' &&
        subjectA !== subjectB &&
        stakeValid &&
        (!openBook || (stakeholderA !== '' && stakeholderB !== '' && stakeholderA !== stakeholderB));

  const playerOption = (p: RosterEntry) => (
    <option key={p.playerId} value={p.playerId}>
      {p.name}
    </option>
  );

  const createError = !editingBetId && create.isError ? create.error.message : null;
  const editError = editingBetId && edit.isError ? edit.error.message : null;

  return (
    <PageShell title="The Action">
      <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)' }}>
        Enter a bet between two roster members. The lower score over the chosen holes wins; the
        loser&apos;s side pays the winner&apos;s side the stake. It settles automatically from
        recorded scores into the pairwise settle-up.
      </p>

      {roster.length < 2 ? (
        <EmptyState title="Add players first" body="Add at least two players to the roster before creating a bet." />
      ) : (
        <Card
          data-testid="bet-form"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'flex-end', marginTop: 'var(--space-4)' }}
        >
          {editingBetId ? (
            <p
              data-testid="editing-banner"
              role="status"
              style={{ flexBasis: '100%', margin: 0, fontWeight: 600, color: 'var(--color-text-primary)', fontSize: 'var(--font-sm)' }}
            >
              Editing an existing bet — change any field, then Save.
            </p>
          ) : null}

          <FormField label="Round">
            <select
              ref={roundSelectRef}
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

          <FormField label="Type">
            <select
              data-testid="type-select"
              value={betType}
              onChange={(e) => setBetType(e.target.value as 'h2h' | 'per_hole_match' | 'over_under')}
            >
              <option value="h2h">Head-to-head (total)</option>
              <option value="per_hole_match">Match play (per hole)</option>
              <option value="over_under">Over / Under</option>
            </select>
          </FormField>

          <FormField label="Scoring">
            <select data-testid="basis-select" value={basis} onChange={(e) => setBasis(e.target.value as 'net' | 'gross')}>
              <option value="net">Net</option>
              <option value="gross">Gross</option>
            </select>
          </FormField>

          <FormField label="Holes">
            <select
              data-testid="scope-select"
              value={holeScope}
              onChange={(e) => setHoleScope(e.target.value as (typeof HOLE_SCOPES)[number])}
            >
              {HOLE_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s === 'full18' ? 'Full 18' : s === 'front' ? 'Front 9' : s === 'back' ? 'Back 9' : 'Total'}
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

          {betType === 'over_under' ? (
            <>
              {/* ONE subject + a line; under-backer vs over-backer. */}
              <FormField label="Line (total strokes, e.g. 90)">
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  data-testid="line-input"
                  value={line}
                  onChange={(e) => setLine(e.target.value)}
                />
              </FormField>
              <FormField label="Player (the line is on)">
                <select data-testid="subject-a-select" value={subjectA} onChange={(e) => setSubjectA(e.target.value)}>
                  <option value="">Select…</option>
                  {roster.map(playerOption)}
                </select>
              </FormField>
              <FormField label="Backs UNDER">
                <select data-testid="stakeholder-a-select" value={stakeholderA} onChange={(e) => setStakeholderA(e.target.value)}>
                  <option value="">Select…</option>
                  {roster.map(playerOption)}
                </select>
              </FormField>
              <FormField label="Backs OVER">
                <select data-testid="stakeholder-b-select" value={stakeholderB} onChange={(e) => setStakeholderB(e.target.value)}>
                  <option value="">Select…</option>
                  {roster.map(playerOption)}
                </select>
              </FormField>
            </>
          ) : (
            <>
              <FormField label="Player A">
                <select data-testid="subject-a-select" value={subjectA} onChange={(e) => setSubjectA(e.target.value)}>
                  <option value="">Select…</option>
                  {roster.map(playerOption)}
                </select>
              </FormField>

              <FormField label="Player B">
                <select data-testid="subject-b-select" value={subjectB} onChange={(e) => setSubjectB(e.target.value)}>
                  <option value="">Select…</option>
                  {roster.map(playerOption)}
                </select>
              </FormField>

              <label
                style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)' }}
              >
                <input
                  type="checkbox"
                  data-testid="open-book-toggle"
                  style={{ width: 'auto', minHeight: 'auto', margin: 0 }}
                  checked={openBook}
                  onChange={(e) => setOpenBook(e.target.checked)}
                />
                Open book (different backer)
              </label>
            </>
          )}

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

          {betType !== 'over_under' && openBook ? (
            <>
              <FormField label="Backs Player A">
                <select data-testid="stakeholder-a-select" value={stakeholderA} onChange={(e) => setStakeholderA(e.target.value)}>
                  <option value="">Select…</option>
                  {roster.map(playerOption)}
                </select>
              </FormField>
              <FormField label="Backs Player B">
                <select data-testid="stakeholder-b-select" value={stakeholderB} onChange={(e) => setStakeholderB(e.target.value)}>
                  <option value="">Select…</option>
                  {roster.map(playerOption)}
                </select>
              </FormField>
            </>
          ) : null}

          {editingBetId ? (
            confirmEditing ? (
              <span className="actions-row">
                <Button
                  variant="danger"
                  data-testid="confirm-edit-btn"
                  aria-describedby="bet-edit-warning"
                  disabled={!formValid || edit.isPending}
                  onClick={() => edit.mutate(editingBetId)}
                >
                  {edit.isPending ? 'Saving…' : 'Confirm change'}
                </Button>
                <Button variant="secondary" data-testid="cancel-edit-confirm-btn" onClick={() => setConfirmEditing(false)}>
                  Back
                </Button>
              </span>
            ) : (
              <span className="actions-row">
                <Button data-testid="save-edit-btn" disabled={!formValid} onClick={() => setConfirmEditing(true)}>
                  Save changes
                </Button>
                <Button variant="secondary" data-testid="cancel-edit-btn" onClick={exitEdit}>
                  Cancel
                </Button>
              </span>
            )
          ) : (
            <Button data-testid="create-bet-btn" disabled={!formValid || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Adding…' : 'Add bet'}
            </Button>
          )}

          {editingBetId && confirmEditing ? (
            <p
              id="bet-edit-warning"
              role="alert"
              data-testid="edit-warning"
              style={{ flexBasis: '100%', margin: 0, color: 'var(--color-danger)', fontSize: 'var(--font-sm)' }}
            >
              This changes the bet and recomputes the money for everyone. The change is recorded in the audit log.
              Confirm to apply.
            </p>
          ) : null}

          {createError ? (
            <p role="alert" style={{ flexBasis: '100%', margin: 0, color: 'var(--color-danger)' }}>
              {errorMessageFor(createError) || `Couldn't add the bet (${createError}).`}
            </p>
          ) : null}
          {editError ? (
            <p role="alert" style={{ flexBasis: '100%', margin: 0, color: 'var(--color-danger)' }}>
              {errorMessageFor(editError) || `Couldn't save the change (${editError}).`}
            </p>
          ) : null}
        </Card>
      )}

      {voidBet.isError ? (
        <p role="alert" style={{ color: 'var(--color-danger)', marginTop: 'var(--space-3)' }}>
          {errorMessageFor(voidBet.error.message) || `Couldn't void the bet (${voidBet.error.message}).`}
        </p>
      ) : null}

      <h2 style={{ fontSize: 'var(--font-md)', marginTop: 'var(--space-5)' }}>Bets</h2>
      {betsQuery.isPending ? (
        <LoadingCard />
      ) : betsQuery.isError ? (
        <ErrorCard error="Couldn't load bets." onRetry={betsQuery.refetch} />
      ) : (betsQuery.data?.bets.length ?? 0) === 0 ? (
        <EmptyState title="No bets yet" body="Create the first bet with the form above." />
      ) : (
        <ScrollableTable label="Bets">
          <table>
            <thead>
              <tr>
                <th>Matchup</th>
                <th>Stake</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {betsQuery.data!.bets.map((b) => {
                const a = b.sides.find((s) => s.side === 'A');
                const bb = b.sides.find((s) => s.side === 'B');
                const sideLabel = (s?: BetViewSide) =>
                  s
                    ? s.stakeholderPlayerId === s.subjectPlayerId
                      ? s.subjectName ?? '—'
                      : `${s.subjectName ?? '—'} (${s.stakeholderName ?? '—'})`
                    : '—';
                const matchup =
                  b.betType === 'over_under'
                    ? `${a?.subjectName ?? '—'} O/U ${b.line ?? '—'} — ${a?.stakeholderName ?? '—'} under · ${bb?.stakeholderName ?? '—'} over`
                    : `${sideLabel(a)} vs ${sideLabel(bb)}`;
                const typeLabel =
                  b.betType === 'over_under'
                    ? 'Over/Under'
                    : b.betType === 'per_hole_match'
                      ? 'Match play'
                      : 'Head-to-head';
                const winnerName = b.winnerSubjectId != null ? nameById.get(b.winnerSubjectId) ?? null : null;
                const terminal = b.state === 'void' || b.state === 'finalized' || b.state === 'unsettleable';
                return (
                  <tr key={b.betId} data-testid={`bet-row-${b.betId}`}>
                    <td>
                      {matchup}
                      <div style={subTextStyle}>
                        {typeLabel} · {b.basis} · {b.holeScope}
                      </div>
                    </td>
                    <td>{fmtUsd(b.stakeCents)}</td>
                    <td data-testid={`bet-state-${b.betId}`}>
                      {STATE_LABEL[b.state] ?? b.state}
                      {b.state === 'settled' && winnerName ? (
                        <div style={subTextStyle}>
                          {winnerName} by {b.marginNet}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {terminal ? (
                        <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                      ) : confirmVoidId === b.betId ? (
                        <span className="actions-row">
                          <Button
                            variant="danger"
                            data-testid={`confirm-void-${b.betId}`}
                            aria-label={`Confirm void of bet: ${matchup}`}
                            disabled={voidBet.isPending}
                            onClick={() => voidBet.mutate(b.betId)}
                          >
                            {voidBet.isPending ? 'Voiding…' : 'Confirm void'}
                          </Button>
                          <Button variant="secondary" data-testid={`cancel-void-${b.betId}`} onClick={cancelVoid}>
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <span className="actions-row">
                          <Button
                            variant="secondary"
                            data-testid={`edit-${b.betId}`}
                            aria-label={`Edit bet: ${matchup}`}
                            onClick={() => loadForEdit(b)}
                          >
                            {editingBetId === b.betId ? 'Editing…' : 'Edit'}
                          </Button>
                          <Button
                            variant="secondary"
                            data-testid={`void-${b.betId}`}
                            aria-label={`Void bet: ${matchup}`}
                            onClick={() => armVoid(b.betId)}
                          >
                            Void
                          </Button>
                        </span>
                      )}
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

export const Route = createFileRoute('/admin/events/$eventId/bets')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <AdminBetsPage eventId={eventId} />;
}
