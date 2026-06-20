import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Trash2, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

type Person = { id: number; name: string };
type OddsMarket = 'stableford' | 'money' | 'perfect_day';
type Bet = {
  id: number;
  betType: 'h2h' | 'over_under' | 'per_hole' | 'odds_win';
  basis: 'net' | 'gross';
  amountDollars: number;
  line: number | null;
  oddsMarket: OddsMarket | null;
  odds: number | null;
  subjectA: Person;
  subjectB: Person | null;
  sideA: Person;
  sideB: Person | null; // null = The House (odds_win vs the book)
};
type OddsLine = { playerId: number; stableford: number | null; money: number | null; perfectDay: number | null };
type RoundOption = { id: number; scheduledDate: string; status: string; type: string };
type AdminBoard = {
  round: { id: number; status: string; scheduledDate: string } | null;
  bets: Bet[];
  roster: Person[]; // valid SUBJECTS (in the round → have scores)
  allPlayers: Person[]; // valid STAKEHOLDERS (any active league member)
  oddsLines: OddsLine[]; // current Line price per player per market
  rounds: RoundOption[]; // every round, most recent first — for the selector
};

/** "YYYY-MM-DD" → "Jun 19" (round dates are calendar dates, parse as local). */
function fmtRoundDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  if (!y || !m || !d) return dateStr;
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type BetType = 'h2h' | 'over_under' | 'per_hole' | 'odds_win';

const TYPE_LABEL: Record<BetType, string> = {
  h2h: 'Overall (lower 18 wins)',
  over_under: 'Over / Under',
  per_hole: 'Per-hole match ($/hole)',
  odds_win: 'Odds — win the day (American)',
};

const MARKET_LABEL: Record<OddsMarket, string> = {
  stableford: 'Wins Stableford #1',
  money: 'Wins money #1',
  perfect_day: 'Perfect Day (#1 in both)',
};

function AdminBetsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // null = let the server pick (active round, else most recent). Picking a round
  // from the dropdown scopes the board + roster + add-bet form to that round.
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['admin-bets', selectedRoundId ?? 'default'],
    queryFn: () => apiFetch<AdminBoard>(selectedRoundId != null ? `/admin/bets?roundId=${selectedRoundId}` : '/admin/bets'),
    retry: false,
  });

  // Bounce to login on auth failure.
  useEffect(() => {
    if (q.isError && /UNAUTHORIZED|HTTP 401/.test(String(q.error))) {
      navigate({ to: '/admin/login' });
    }
  }, [q.isError, q.error, navigate]);

  const [betType, setBetType] = useState<BetType>('h2h');
  const [basis, setBasis] = useState<'net' | 'gross'>('net');
  const [subjectA, setSubjectA] = useState('');
  const [subjectB, setSubjectB] = useState('');
  const [line, setLine] = useState('');
  const [oddsMarket, setOddsMarket] = useState<OddsMarket>('perfect_day');
  const [amount, setAmount] = useState('');
  const [sameStakeholders, setSameStakeholders] = useState(true);
  const [sideA, setSideA] = useState('');
  const [sideB, setSideB] = useState('');
  const [note, setNote] = useState('');

  // Bets can only be ADDED to an open (active/scheduled) round; a finalized round
  // is view + delete only (mirrors the server gate). Deletion stays available.
  const roundOpen =
    q.data?.round != null && (q.data.round.status === 'active' || q.data.round.status === 'scheduled');
  const roster = q.data?.roster ?? []; // subjects (in the round)
  const allPlayers = q.data?.allPlayers ?? roster; // stakeholders (any league member)
  const oddsLines = q.data?.oddsLines ?? [];
  const needsSubjectB = betType === 'h2h' || betType === 'per_hole';
  const needsLine = betType === 'over_under';
  const isOddsWin = betType === 'odds_win';

  // odds_win price comes straight from The Line for the picked player + market
  // (never typed). null = the player isn't priceable yet (gated / thin sample).
  const pulledOdds: number | null = (() => {
    if (!isOddsWin || !subjectA) return null;
    const line = oddsLines.find((l) => l.playerId === Number(subjectA));
    if (!line) return null;
    return oddsMarket === 'stableford' ? line.stableford : oddsMarket === 'money' ? line.money : line.perfectDay;
  })();

  const create = useMutation({
    mutationFn: async () => {
      // Sides are explicit (manual pickers) for odds_win, over_under (one subject
      // can't be both stakeholders), and whenever "players themselves" is off.
      // Only h2h/per_hole with sameStakeholders default the sides to the subjects.
      const useManualSides = isOddsWin || needsLine || !sameStakeholders;
      const sA = useManualSides ? sideA : subjectA;
      const sB = useManualSides ? sideB : subjectB;
      const body: Record<string, unknown> = {
        betType,
        basis,
        amountDollars: Number(amount),
        subjectAPlayerId: Number(subjectA),
        sideAPlayerId: Number(sA),
        note: note.trim() || undefined,
      };
      // Target the round currently in view (defaults to active server-side, but
      // the selector can point at a different round).
      if (q.data?.round?.id) body['roundId'] = q.data.round.id;
      // odds_win with an empty/House layer → omit sideBPlayerId (= bet vs The House).
      const layerIsHouse = isOddsWin && (sB === '' || sB === 'house');
      if (!layerIsHouse) body['sideBPlayerId'] = Number(sB);
      if (needsSubjectB) body['subjectBPlayerId'] = Number(subjectB);
      if (needsLine) body['line'] = Number(line);
      if (isOddsWin) body['oddsMarket'] = oddsMarket; // price is locked from The Line server-side
      return apiFetch<{ id: number }>('/admin/bets', { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-bets'] });
      qc.invalidateQueries({ queryKey: ['bets'] });
      setSubjectA('');
      setSubjectB('');
      setLine('');
      setAmount('');
      setSideA('');
      setSideB('');
      setNote('');
    },
  });

  // Two-step delete: the first tap on the trash icon ARMS a row (shows a
  // distinct Delete/Cancel), so a laggy double-tap can't remove a bet — and if
  // the list reorders after a delete, a stray tap only re-arms, never deletes.
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/bets/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmingId(null);
      qc.invalidateQueries({ queryKey: ['admin-bets'] });
      qc.invalidateQueries({ queryKey: ['bets'] });
    },
  });

  // For the over/under stakeholder default, side A = "under" backer, side B = "over".
  // When sameStakeholders + over_under, there's no subjectB → side B must be set manually.
  // odds_win always needs explicit stakeholders (the bettor + the layer).
  const ouNeedsManualSides = sameStakeholders && needsLine;
  const manualSides = isOddsWin || !sameStakeholders || ouNeedsManualSides;

  // odds_win is only valid once The Line has a price for the picked player + market.
  const oddsValid = !isOddsWin || pulledOdds !== null;
  const canSubmit =
    subjectA &&
    (!needsSubjectB || subjectB) &&
    (!needsLine || line) &&
    oddsValid &&
    amount &&
    Number(amount) > 0 &&
    // odds_win needs the bettor (side A); the layer is optional (empty = The House).
    (manualSides ? sideA && (isOddsWin || sideB) : true) &&
    !create.isPending;

  const nameOf = (id: number) => allPlayers.find((p) => p.id === id)?.name ?? `#${id}`;
  const fmtOdds = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  function describe(b: Bet): string {
    if (b.betType === 'odds_win')
      return `${b.subjectA.name} — ${b.oddsMarket ? MARKET_LABEL[b.oddsMarket] : 'win'} @ ${b.odds != null ? fmtOdds(b.odds) : '?'}`;
    if (b.betType === 'over_under') return `${b.subjectA.name} O/U ${b.line} · ${b.basis}`;
    if (b.betType === 'per_hole') return `${b.subjectA.name} vs ${b.subjectB?.name} · $${b.amountDollars}/hole · ${b.basis}`;
    return `${b.subjectA.name} vs ${b.subjectB?.name} · ${b.basis}`;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="mb-4">
        <Link to="/admin" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1">
          <ChevronLeft className="h-3 w-3" />
          Admin
        </Link>
        <h1 className="text-xl font-bold tracking-tight">Bets</h1>
        {q.data?.round && (
          <p className="text-xs text-muted-foreground">
            Round {q.data.round.id} · {q.data.round.scheduledDate} · {q.data.round.status}
          </p>
        )}
      </div>

      {/* Round selector — manage any round's bets (delete past/test bets even
          when nothing is active). */}
      {q.data && q.data.rounds.length > 0 && (
        <label className="mb-4 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Round</span>
          <select
            className="rounded-lg border bg-background px-3 py-2 text-sm"
            value={selectedRoundId ?? q.data.round?.id ?? q.data.rounds[0]?.id ?? ''}
            onChange={(e) => setSelectedRoundId(Number(e.target.value))}
          >
            {q.data.rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {fmtRoundDate(r.scheduledDate)} · {r.type === 'casual' ? 'Practice' : 'Official'} · {r.status}
              </option>
            ))}
          </select>
        </label>
      )}

      {q.isLoading && <div className="py-8 text-center text-muted-foreground">Loading…</div>}

      {q.data && !q.data.round && q.data.rounds.length === 0 && (
        <div className="rounded-xl border bg-card p-4 text-sm text-amber-600">
          No rounds yet — set up a round first, then add bets.
        </div>
      )}

      {q.data?.round && !roundOpen && (
        <div className="rounded-xl border bg-card p-3 mb-4 text-xs text-muted-foreground">
          This round is {q.data.round.status} — viewing &amp; deleting only. Adding new bets is disabled.
        </div>
      )}

      {q.data?.round && (
        <>
          {/* Add a bet — only on an open (active/scheduled) round */}
          {roundOpen && (
          <div className="rounded-xl border bg-card p-4 mb-6 space-y-3">
            <div className="text-sm font-bold">Add a bet</div>

            <label className="block text-xs">
              <span className="text-muted-foreground">Type</span>
              <select
                className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm"
                value={betType}
                onChange={(e) => setBetType(e.target.value as BetType)}
              >
                {(Object.keys(TYPE_LABEL) as BetType[]).map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs">
                <span className="text-muted-foreground">{needsLine || isOddsWin ? 'Player' : 'Player A'}</span>
                <select className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={subjectA} onChange={(e) => setSubjectA(e.target.value)}>
                  <option value="">—</option>
                  {roster.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              {needsSubjectB ? (
                <label className="block text-xs">
                  <span className="text-muted-foreground">Player B</span>
                  <select className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={subjectB} onChange={(e) => setSubjectB(e.target.value)}>
                    <option value="">—</option>
                    {roster.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              ) : isOddsWin ? (
                <label className="block text-xs">
                  <span className="text-muted-foreground">To win</span>
                  <select className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={oddsMarket} onChange={(e) => setOddsMarket(e.target.value as OddsMarket)}>
                    {(Object.keys(MARKET_LABEL) as OddsMarket[]).map((m) => (
                      <option key={m} value={m}>{MARKET_LABEL[m]}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="block text-xs">
                  <span className="text-muted-foreground">Line (e.g. 90)</span>
                  <input type="number" className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={line} onChange={(e) => setLine(e.target.value)} />
                </label>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {isOddsWin ? (
                <label className="block text-xs">
                  <span className="text-muted-foreground">Odds (from The Line)</span>
                  <div className="mt-1 w-full rounded-lg border bg-muted/40 px-3 py-2 text-sm tabular-nums">
                    {!subjectA ? (
                      <span className="text-muted-foreground">pick a player</span>
                    ) : pulledOdds === null ? (
                      <span className="text-amber-600">no line yet</span>
                    ) : (
                      <span className="font-semibold">{pulledOdds > 0 ? `+${pulledOdds}` : pulledOdds}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">locks from The Line at save</span>
                </label>
              ) : (
                <label className="block text-xs">
                  <span className="text-muted-foreground">Basis</span>
                  <select className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={basis} onChange={(e) => setBasis(e.target.value as 'net' | 'gross')}>
                    <option value="net">Net (with strokes)</option>
                    <option value="gross">Gross (straight up)</option>
                  </select>
                </label>
              )}
              <label className="block text-xs">
                <span className="text-muted-foreground">{betType === 'per_hole' ? 'Per hole $' : isOddsWin ? 'Stake $' : 'Amount $'}</span>
                <input type="number" className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
            </div>

            {!isOddsWin && (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={sameStakeholders} onChange={(e) => setSameStakeholders(e.target.checked)} />
                <span>Stakeholders are the players themselves</span>
              </label>
            )}

            {manualSides && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs">
                  <span className="text-muted-foreground">{needsLine ? 'Backs UNDER' : isOddsWin ? 'Bettor (backs player)' : 'Backs A'}</span>
                  <select className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={sideA} onChange={(e) => setSideA(e.target.value)}>
                    <option value="">—</option>
                    {allPlayers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="block text-xs">
                  <span className="text-muted-foreground">{needsLine ? 'Backs OVER' : isOddsWin ? 'Layer (other side)' : 'Backs B'}</span>
                  <select className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={sideB} onChange={(e) => setSideB(e.target.value)}>
                    <option value="">{isOddsWin ? '🏠 The House' : '—'}</option>
                    {allPlayers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              </div>
            )}

            <input
              type="text"
              placeholder="Note (optional)"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            {create.isError && <p className="text-xs text-red-500">Couldn&apos;t add: {String(create.error)}</p>}

            <Button size="sm" className="gap-1.5 w-full" disabled={!canSubmit} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add bet
            </Button>
          </div>
          )}

          {/* Existing bets */}
          <div className="space-y-2">
            {q.data.bets.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No bets yet.</p>}
            {q.data.bets.map((b) => (
              <div key={b.id} className="rounded-lg border bg-card px-3 py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{describe(b)}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {b.sideA.name} vs {b.sideB?.name ?? 'The House'}
                    {b.betType !== 'per_hole' ? ` · $${b.amountDollars}` : ''}
                  </div>
                </div>
                {confirmingId === b.id ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      className="rounded-md bg-red-500 px-2 py-1 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                      onClick={() => del.mutate(b.id)}
                      disabled={del.isPending}
                    >
                      {del.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Delete'}
                    </button>
                    <button
                      className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                      onClick={() => setConfirmingId(null)}
                      disabled={del.isPending}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="shrink-0 text-muted-foreground hover:text-red-500"
                    onClick={() => setConfirmingId(b.id)}
                    aria-label={`Delete bet ${nameOf(b.subjectA.id)}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/bets')({
  component: AdminBetsPage,
});
