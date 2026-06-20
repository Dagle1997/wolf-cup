/**
 * "The Action" admin betting page (Story 1.1 walking skeleton).
 *
 * Route: /admin/events/:eventId/bets
 *
 * The organizer enters a head-to-head NET bet between two roster members and
 * it auto-settles from recorded scores into the pairwise settle-up. Subjects
 * (whose play decides the bet) default to being their own stakeholder (who
 * holds the money); "Open book" reveals separate stakeholder pickers so a
 * non-playing member can back a side (FR8/FR10).
 *
 * Roster + rounds come from the existing pairings endpoint (no GHIN call).
 * v1 fixes betType=h2h / basis=net; later stories add types/bases.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';

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
  state: string;
  winnerSubjectId: string | null;
  marginNet: number;
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

const cellStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--color-border)',
  textAlign: 'left',
  verticalAlign: 'top',
};
const fieldStyle: React.CSSProperties = { fontSize: 'var(--font-sm)', minWidth: 140 };
const inputStyle: React.CSSProperties = { minHeight: 44, width: '100%' };

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
  const [betType, setBetType] = useState<'h2h' | 'per_hole_match'>('h2h');
  const [basis, setBasis] = useState<'net' | 'gross'>('net');
  const [holeScope, setHoleScope] = useState<(typeof HOLE_SCOPES)[number]>('full18');
  const [stakeDollars, setStakeDollars] = useState('20');
  const [subjectA, setSubjectA] = useState('');
  const [subjectB, setSubjectB] = useState('');
  const [openBook, setOpenBook] = useState(false);
  const [stakeholderA, setStakeholderA] = useState('');
  const [stakeholderB, setStakeholderB] = useState('');
  const [confirmVoidId, setConfirmVoidId] = useState<string | null>(null);
  // Story 1.4 edit-in-form mode: which bet is being edited + the confirm gate.
  const [editingBetId, setEditingBetId] = useState<string | null>(null);
  const [confirmEditing, setConfirmEditing] = useState(false);

  const roster = pairings.data?.roster ?? [];
  const rounds: RoundEntry[] = useMemo(
    () => (pairings.data?.rounds ?? []).map((r) => ({ eventRoundId: r.eventRoundId, roundNumber: r.roundNumber })),
    [pairings.data],
  );
  const nameById = useMemo(() => new Map(roster.map((r) => [r.playerId, r.name])), [roster]);

  // Build the request payload from the current form state. Stakes are WHOLE
  // DOLLARS (no cents) — we multiply whole dollars by 100 for the cents wire.
  const buildBody = () => {
    const stakeCents = Math.round(Number(stakeDollars)) * 100;
    const stA = openBook ? stakeholderA : subjectA;
    const stB = openBook ? stakeholderB : subjectB;
    return {
      eventRoundId,
      betType,
      basis,
      holeScope,
      stakeCents,
      sideA: { stakeholderPlayerId: stA, subjectPlayerId: subjectA },
      sideB: { stakeholderPlayerId: stB, subjectPlayerId: subjectB },
    };
  };

  const clearPlayers = () => {
    setSubjectA('');
    setSubjectB('');
    setStakeholderA('');
    setStakeholderB('');
  };
  const exitEdit = () => {
    setEditingBetId(null);
    setConfirmEditing(false);
    setOpenBook(false);
    clearPlayers();
  };

  // Load an existing bet into the form for editing (admin may correct anytime).
  const loadForEdit = (b: BetView) => {
    const a = b.sides.find((s) => s.side === 'A');
    const bb = b.sides.find((s) => s.side === 'B');
    setEditingBetId(b.betId);
    setConfirmEditing(false);
    setEventRoundId(b.eventRoundId);
    setBetType(b.betType === 'per_hole_match' ? 'per_hole_match' : 'h2h');
    setBasis(b.basis === 'gross' ? 'gross' : 'net');
    setHoleScope(
      (HOLE_SCOPES as readonly string[]).includes(b.holeScope)
        ? (b.holeScope as (typeof HOLE_SCOPES)[number])
        : 'full18',
    );
    setStakeDollars(String(Math.round(b.stakeCents / 100)));
    setSubjectA(a?.subjectPlayerId ?? '');
    setSubjectB(bb?.subjectPlayerId ?? '');
    const ob =
      !!a &&
      !!bb &&
      (a.stakeholderPlayerId !== a.subjectPlayerId || bb.stakeholderPlayerId !== bb.subjectPlayerId);
    setOpenBook(ob);
    setStakeholderA(a?.stakeholderPlayerId ?? '');
    setStakeholderB(bb?.stakeholderPlayerId ?? '');
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

  // Whole-dollar stakes only (no cents) — error-proofing the most-missed field.
  const stakeDollarsNum = Number(stakeDollars);
  const stakeValid = Number.isInteger(stakeDollarsNum) && stakeDollarsNum >= 1;
  const formValid =
    eventRoundId !== '' &&
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

  return (
    <PageShell title="The Action">
      <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)' }}>
        Enter a head-to-head <strong>net</strong> bet between two roster members. Lower net total
        over the chosen holes wins; the loser&apos;s side pays the winner&apos;s side the stake.
        It settles automatically from recorded scores into the pairwise settle-up.
      </p>

      {editingBetId ? (
        <p
          data-testid="editing-banner"
          role="status"
          style={{ color: 'var(--color-text)', fontSize: 'var(--font-sm)', fontWeight: 600, margin: '8px 0 0' }}
        >
          Editing an existing bet — change any field, then Save.
        </p>
      ) : null}

      {roster.length < 2 ? (
        <p data-testid="empty-roster">Add at least two players to the roster first.</p>
      ) : (
        <div
          data-testid="bet-form"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', margin: '12px 0' }}
        >
          <label style={fieldStyle}>
            <div style={{ marginBottom: 4 }}>Round</div>
            <select
              data-testid="round-select"
              style={inputStyle}
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
          </label>

          <label style={fieldStyle}>
            <div style={{ marginBottom: 4 }}>Type</div>
            <select
              data-testid="type-select"
              style={inputStyle}
              value={betType}
              onChange={(e) => setBetType(e.target.value as 'h2h' | 'per_hole_match')}
            >
              <option value="h2h">Head-to-head (total)</option>
              <option value="per_hole_match">Match play (per hole)</option>
            </select>
          </label>

          <label style={fieldStyle}>
            <div style={{ marginBottom: 4 }}>Scoring</div>
            <select
              data-testid="basis-select"
              style={inputStyle}
              value={basis}
              onChange={(e) => setBasis(e.target.value as 'net' | 'gross')}
            >
              <option value="net">Net</option>
              <option value="gross">Gross</option>
            </select>
          </label>

          <label style={fieldStyle}>
            <div style={{ marginBottom: 4 }}>Holes</div>
            <select
              data-testid="scope-select"
              style={inputStyle}
              value={holeScope}
              onChange={(e) => setHoleScope(e.target.value as (typeof HOLE_SCOPES)[number])}
            >
              {HOLE_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s === 'full18' ? 'Full 18' : s === 'front' ? 'Front 9' : s === 'back' ? 'Back 9' : 'Total'}
                </option>
              ))}
            </select>
          </label>

          <label style={fieldStyle}>
            <div style={{ marginBottom: 4 }}>Stake ($, whole dollars)</div>
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              data-testid="stake-input"
              style={inputStyle}
              value={stakeDollars}
              onChange={(e) => setStakeDollars(e.target.value)}
            />
          </label>

          <label style={fieldStyle}>
            <div style={{ marginBottom: 4 }}>Player A</div>
            <select
              data-testid="subject-a-select"
              style={inputStyle}
              value={subjectA}
              onChange={(e) => setSubjectA(e.target.value)}
            >
              <option value="">Select…</option>
              {roster.map(playerOption)}
            </select>
          </label>

          <label style={fieldStyle}>
            <div style={{ marginBottom: 4 }}>Player B</div>
            <select
              data-testid="subject-b-select"
              style={inputStyle}
              value={subjectB}
              onChange={(e) => setSubjectB(e.target.value)}
            >
              <option value="">Select…</option>
              {roster.map(playerOption)}
            </select>
          </label>

          <label style={{ ...fieldStyle, minWidth: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              data-testid="open-book-toggle"
              checked={openBook}
              onChange={(e) => setOpenBook(e.target.checked)}
            />
            Open book (different backer)
          </label>

          {openBook ? (
            <>
              <label style={fieldStyle}>
                <div style={{ marginBottom: 4 }}>Backs Player A</div>
                <select
                  data-testid="stakeholder-a-select"
                  style={inputStyle}
                  value={stakeholderA}
                  onChange={(e) => setStakeholderA(e.target.value)}
                >
                  <option value="">Select…</option>
                  {roster.map(playerOption)}
                </select>
              </label>
              <label style={fieldStyle}>
                <div style={{ marginBottom: 4 }}>Backs Player B</div>
                <select
                  data-testid="stakeholder-b-select"
                  style={inputStyle}
                  value={stakeholderB}
                  onChange={(e) => setStakeholderB(e.target.value)}
                >
                  <option value="">Select…</option>
                  {roster.map(playerOption)}
                </select>
              </label>
            </>
          ) : null}

          {editingBetId ? (
            confirmEditing ? (
              <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  data-testid="confirm-edit-btn"
                  disabled={!formValid || edit.isPending}
                  style={{ minHeight: 44, color: 'var(--color-danger)' }}
                  onClick={() => edit.mutate(editingBetId)}
                >
                  {edit.isPending ? 'Saving…' : 'Confirm change'}
                </button>
                <button
                  type="button"
                  data-testid="cancel-edit-confirm-btn"
                  style={{ minHeight: 44 }}
                  onClick={() => setConfirmEditing(false)}
                >
                  Back
                </button>
              </span>
            ) : (
              <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  data-testid="save-edit-btn"
                  disabled={!formValid}
                  style={{ minHeight: 44 }}
                  onClick={() => setConfirmEditing(true)}
                >
                  Save changes
                </button>
                <button type="button" data-testid="cancel-edit-btn" style={{ minHeight: 44 }} onClick={exitEdit}>
                  Cancel
                </button>
              </span>
            )
          ) : (
            <button
              type="button"
              data-testid="create-bet-btn"
              disabled={!formValid || create.isPending}
              style={{ minHeight: 44 }}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Adding…' : 'Add bet'}
            </button>
          )}
        </div>
      )}

      {editingBetId && confirmEditing ? (
        <p role="alert" data-testid="edit-warning" style={{ color: 'var(--color-danger)', fontSize: 'var(--font-sm)' }}>
          This changes the bet and recomputes the money for everyone. The change is recorded in the audit log.
          Confirm to apply.
        </p>
      ) : null}

      {create.isError ? (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          {create.error.message === 'betting_closed_scores_exist'
            ? 'Too late — a score already exists on one of these holes.'
            : create.error.message === 'players_not_in_event'
              ? 'All players must be on the event roster.'
              : create.error.message === 'same_stakeholder_both_sides'
                ? 'The two backers must be different people.'
                : create.error.message === 'non_whole_dollar_stake'
                  ? 'Stakes must be whole dollars (no cents).'
                  : `Couldn't add the bet (${create.error.message}).`}
        </p>
      ) : null}

      {edit.isError ? (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          {edit.error.message === 'non_whole_dollar_stake'
            ? 'Stakes must be whole dollars (no cents).'
            : edit.error.message === 'same_stakeholder_both_sides'
              ? 'The two backers must be different people.'
              : edit.error.message === 'cannot_edit_terminal'
                ? 'That bet is voided or final and can no longer be changed.'
                : `Couldn't save the change (${edit.error.message}).`}
        </p>
      ) : null}

      {voidBet.isError ? (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          {voidBet.error.message === 'cannot_void_terminal'
            ? 'That bet is already voided or final.'
            : `Couldn't void the bet (${voidBet.error.message}).`}
        </p>
      ) : null}

      <h2 style={{ fontSize: 'var(--font-md)', marginTop: 20 }}>Bets</h2>
      {betsQuery.isPending ? (
        <LoadingCard />
      ) : betsQuery.isError ? (
        <ErrorCard error="Couldn't load bets." onRetry={betsQuery.refetch} />
      ) : (betsQuery.data?.bets.length ?? 0) === 0 ? (
        <p data-testid="no-bets">No bets yet.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 'var(--font-sm)' }}>
          <thead>
            <tr>
              <th style={cellStyle}>Matchup</th>
              <th style={cellStyle}>Stake</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}>Actions</th>
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
              const winnerName =
                b.winnerSubjectId != null ? nameById.get(b.winnerSubjectId) ?? null : null;
              return (
                <tr key={b.betId} data-testid={`bet-row-${b.betId}`}>
                  <td style={cellStyle}>
                    {sideLabel(a)} <span style={{ color: 'var(--color-text-muted)' }}>vs</span> {sideLabel(bb)}
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85em' }}>
                      {b.betType === 'per_hole_match' ? 'Match play' : 'Head-to-head'} · {b.basis} · {b.holeScope}
                    </div>
                  </td>
                  <td style={cellStyle}>{fmtUsd(b.stakeCents)}</td>
                  <td style={cellStyle} data-testid={`bet-state-${b.betId}`}>
                    {STATE_LABEL[b.state] ?? b.state}
                    {b.state === 'settled' && winnerName ? (
                      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85em' }}>
                        {winnerName} by {b.marginNet}
                      </div>
                    ) : null}
                  </td>
                  <td style={cellStyle}>
                    {b.state === 'void' || b.state === 'finalized' || b.state === 'unsettleable' ? (
                      <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                    ) : confirmVoidId === b.betId ? (
                      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          data-testid={`confirm-void-${b.betId}`}
                          style={{ minHeight: 44, color: 'var(--color-danger)' }}
                          disabled={voidBet.isPending}
                          onClick={() => voidBet.mutate(b.betId)}
                        >
                          {voidBet.isPending ? 'Voiding…' : 'Confirm void'}
                        </button>
                        <button
                          type="button"
                          data-testid={`cancel-void-${b.betId}`}
                          style={{ minHeight: 44 }}
                          onClick={() => setConfirmVoidId(null)}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          data-testid={`edit-${b.betId}`}
                          style={{ minHeight: 44 }}
                          onClick={() => {
                            setConfirmVoidId(null);
                            loadForEdit(b);
                          }}
                        >
                          {editingBetId === b.betId ? 'Editing…' : 'Edit'}
                        </button>
                        <button
                          type="button"
                          data-testid={`void-${b.betId}`}
                          style={{ minHeight: 44 }}
                          onClick={() => setConfirmVoidId(b.betId)}
                        >
                          Void
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
