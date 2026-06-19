import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Trash2, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

type Person = { id: number; name: string };
type Bet = {
  id: number;
  betType: 'h2h' | 'over_under' | 'per_hole';
  basis: 'net' | 'gross';
  amountDollars: number;
  line: number | null;
  subjectA: Person;
  subjectB: Person | null;
  sideA: Person;
  sideB: Person;
};
type AdminBoard = {
  round: { id: number; status: string; scheduledDate: string } | null;
  bets: Bet[];
  roster: Person[]; // valid SUBJECTS (in the round → have scores)
  allPlayers: Person[]; // valid STAKEHOLDERS (any active league member)
};

type BetType = 'h2h' | 'over_under' | 'per_hole';

const TYPE_LABEL: Record<BetType, string> = {
  h2h: 'Overall (lower 18 wins)',
  over_under: 'Over / Under',
  per_hole: 'Per-hole match ($/hole)',
};

function AdminBetsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin-bets'],
    queryFn: () => apiFetch<AdminBoard>('/admin/bets'),
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
  const [amount, setAmount] = useState('');
  const [sameStakeholders, setSameStakeholders] = useState(true);
  const [sideA, setSideA] = useState('');
  const [sideB, setSideB] = useState('');
  const [note, setNote] = useState('');

  const roster = q.data?.roster ?? []; // subjects (in the round)
  const allPlayers = q.data?.allPlayers ?? roster; // stakeholders (any league member)
  const needsSubjectB = betType === 'h2h' || betType === 'per_hole';
  const needsLine = betType === 'over_under';

  const create = useMutation({
    mutationFn: async () => {
      const sA = sameStakeholders ? subjectA : sideA;
      const sB = sameStakeholders ? (needsSubjectB ? subjectB : '') : sideB;
      const body: Record<string, unknown> = {
        betType,
        basis,
        amountDollars: Number(amount),
        subjectAPlayerId: Number(subjectA),
        sideAPlayerId: Number(sA),
        sideBPlayerId: Number(sB),
        note: note.trim() || undefined,
      };
      if (needsSubjectB) body['subjectBPlayerId'] = Number(subjectB);
      if (needsLine) body['line'] = Number(line);
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

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/admin/bets/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-bets'] });
      qc.invalidateQueries({ queryKey: ['bets'] });
    },
  });

  // For the over/under stakeholder default, side A = "under" backer, side B = "over".
  // When sameStakeholders + over_under, there's no subjectB → side B must be set manually.
  const ouNeedsManualSides = sameStakeholders && needsLine;

  const canSubmit =
    subjectA &&
    (!needsSubjectB || subjectB) &&
    (!needsLine || line) &&
    amount &&
    Number(amount) > 0 &&
    (sameStakeholders ? (!ouNeedsManualSides || (sideA && sideB)) : sideA && sideB) &&
    !create.isPending;

  const nameOf = (id: number) => allPlayers.find((p) => p.id === id)?.name ?? `#${id}`;

  function describe(b: Bet): string {
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
        <h1 className="text-xl font-bold tracking-tight">Bets — this week</h1>
        {q.data?.round && (
          <p className="text-xs text-muted-foreground">Round {q.data.round.id} · {q.data.round.scheduledDate}</p>
        )}
      </div>

      {q.isLoading && <div className="py-8 text-center text-muted-foreground">Loading…</div>}

      {q.data && !q.data.round && (
        <div className="rounded-xl border bg-card p-4 text-sm text-amber-600">
          No active round — set up this week&apos;s round first, then add bets.
        </div>
      )}

      {q.data?.round && (
        <>
          {/* Add a bet */}
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
                <span className="text-muted-foreground">{needsLine ? 'Player' : 'Player A'}</span>
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
              ) : (
                <label className="block text-xs">
                  <span className="text-muted-foreground">Line (e.g. 90)</span>
                  <input type="number" className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={line} onChange={(e) => setLine(e.target.value)} />
                </label>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs">
                <span className="text-muted-foreground">Basis</span>
                <select className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={basis} onChange={(e) => setBasis(e.target.value as 'net' | 'gross')}>
                  <option value="net">Net (with strokes)</option>
                  <option value="gross">Gross (straight up)</option>
                </select>
              </label>
              <label className="block text-xs">
                <span className="text-muted-foreground">{betType === 'per_hole' ? 'Per hole $' : 'Amount $'}</span>
                <input type="number" className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={sameStakeholders} onChange={(e) => setSameStakeholders(e.target.checked)} />
              <span>Stakeholders are the players themselves</span>
            </label>

            {(!sameStakeholders || ouNeedsManualSides) && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs">
                  <span className="text-muted-foreground">{needsLine ? 'Backs UNDER' : 'Backs A'}</span>
                  <select className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={sideA} onChange={(e) => setSideA(e.target.value)}>
                    <option value="">—</option>
                    {allPlayers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="block text-xs">
                  <span className="text-muted-foreground">{needsLine ? 'Backs OVER' : 'Backs B'}</span>
                  <select className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm" value={sideB} onChange={(e) => setSideB(e.target.value)}>
                    <option value="">—</option>
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

          {/* Existing bets */}
          <div className="space-y-2">
            {q.data.bets.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No bets yet.</p>}
            {q.data.bets.map((b) => (
              <div key={b.id} className="rounded-lg border bg-card px-3 py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{describe(b)}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {b.sideA.name} vs {b.sideB.name}
                    {b.betType !== 'per_hole' ? ` · $${b.amountDollars}` : ''}
                  </div>
                </div>
                <button
                  className="shrink-0 text-muted-foreground hover:text-red-500"
                  onClick={() => del.mutate(b.id)}
                  aria-label={`Delete bet ${nameOf(b.subjectA.id)}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
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
