import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ArrowLeft } from 'lucide-react';
import { apiFetch } from '@/lib/api';

type Validity = {
  logLoss: number;
  brier: number;
  baselines: {
    uniform: { logLoss: number; brier: number };
    handicapOnly: { logLoss: number; brier: number };
    lastWeek: { logLoss: number; brier: number };
  };
  ci: {
    logLoss: { mean: number; lo: number; hi: number };
    vsUniform: { mean: number; lo: number; hi: number };
    vsHandicapOnly: { mean: number; lo: number; hi: number };
    vsLastWeek: { mean: number; lo: number; hi: number };
  };
};
type Ledger = {
  openWeeks: number;
  cumulativeUnits: number;
  totalStakes: number;
  theoreticalHold: number;
  effectiveHold: number;
  realizedHold: number;
  perWeek: { roundId: number; date: string; housePnl: number; cumulative: number; effectiveHold: number }[];
  validity: Validity | null;
};
type Resp = { season: { id: number; name: string; year: number } | null; ledger: Ledger | null };

const fmtDate = (d: string) => {
  const [, m, day] = d.split('-');
  return m && day ? `${Number(m)}/${Number(day)}` : d;
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const signed = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;

export const Route = createFileRoute('/admin/the-house')({
  component: TheHousePage,
});

function TheHousePage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-the-house'],
    queryFn: () => apiFetch<Resp>('/admin/the-house'),
    retry: false,
  });

  if (isError && (error as Error).message === 'UNAUTHORIZED') {
    void navigate({ to: '/admin/login' });
    return null;
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Link to="/admin" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-5 h-5" /></Link>
        <h2 className="text-xl font-semibold">🏛️ The House</h2>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Weekly House P&amp;L on the scouting line + calibration vs. dumb baselines. Hidden from the public page —
        for entertainment / model validity only (can't price dives, round-dumping, or index sandbagging).
      </p>

      {isLoading && (
        <div className="rounded-xl border p-8 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      {isError && (error as Error).message !== 'UNAUTHORIZED' && (
        <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Could not load the ledger.</div>
      )}

      {data && (!data.ledger || data.ledger.openWeeks === 0) && (
        <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
          Books open after week 3{data.season ? ` — ${data.season.name}` : ''}. No qualifying weeks yet.
        </div>
      )}

      {data?.ledger && data.ledger.openWeeks > 0 && (
        <Ledger season={data.season} ledger={data.ledger} />
      )}
    </div>
  );
}

function Ledger({ season, ledger }: { season: Resp['season']; ledger: Ledger }) {
  const up = ledger.cumulativeUnits >= 0;
  const v = ledger.validity;
  return (
    <>
      {/* Headline */}
      <div className="rounded-xl border overflow-hidden shadow-sm">
        <div className="bg-muted/60 px-4 py-2 border-b font-semibold text-sm">
          {season ? `${season.name} · ` : ''}{ledger.openWeeks} open week{ledger.openWeeks === 1 ? '' : 's'}
        </div>
        <div className="px-4 py-3">
          <p className={`text-3xl font-bold tabular-nums ${up ? 'text-emerald-700' : 'text-rose-700'}`}>
            {signed(ledger.cumulativeUnits)}u
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            on {ledger.totalStakes} units staked · realized hold {pct(ledger.realizedHold)} · effective {pct(ledger.effectiveHold)} · theoretical {pct(ledger.theoreticalHold)}
          </p>
        </div>
      </div>

      {/* Per-week tracking table */}
      <div className="rounded-xl border overflow-hidden shadow-sm">
        <div className="bg-muted/60 px-4 py-2 border-b font-semibold text-sm">Week by week</div>
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-muted-foreground text-[11px]">
                <th className="text-left py-2 px-3">Week</th>
                <th className="text-right py-2 px-3">House P&amp;L</th>
                <th className="text-right py-2 px-3">Cumulative</th>
                <th className="text-right py-2 px-3">Hold</th>
              </tr>
            </thead>
            <tbody>
              {ledger.perWeek.map((w) => (
                <tr key={w.roundId} className="border-b last:border-0">
                  <td className="py-2 px-3">{fmtDate(w.date)}</td>
                  <td className={`py-2 px-3 text-right tabular-nums ${w.housePnl >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{signed(w.housePnl)}u</td>
                  <td className={`py-2 px-3 text-right tabular-nums font-medium ${w.cumulative >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{signed(w.cumulative)}u</td>
                  <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{pct(w.effectiveHold)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Calibration vs. baselines */}
      {v && (
        <div className="rounded-xl border overflow-hidden shadow-sm">
          <div className="bg-muted/60 px-4 py-2 border-b font-semibold text-sm">Calibration — is the line better than guessing?</div>
          <div className="px-4 py-3 text-sm">
            <p className="text-xs text-muted-foreground mb-2">Log-loss &amp; Brier, lower = better. The line should beat all three baselines.</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-[11px]">
                  <th className="text-left py-1"></th>
                  <th className="text-right py-1">Log-loss</th>
                  <th className="text-right py-1">Brier</th>
                </tr>
              </thead>
              <tbody>
                <tr className="font-medium"><td className="py-1">📊 The line</td><td className="py-1 text-right tabular-nums">{v.logLoss.toFixed(3)}</td><td className="py-1 text-right tabular-nums">{v.brier.toFixed(3)}</td></tr>
                <tr className="text-muted-foreground"><td className="py-1">uniform (1/N)</td><td className="py-1 text-right tabular-nums">{v.baselines.uniform.logLoss.toFixed(3)}</td><td className="py-1 text-right tabular-nums">{v.baselines.uniform.brier.toFixed(3)}</td></tr>
                <tr className="text-muted-foreground"><td className="py-1">handicap-only</td><td className="py-1 text-right tabular-nums">{v.baselines.handicapOnly.logLoss.toFixed(3)}</td><td className="py-1 text-right tabular-nums">{v.baselines.handicapOnly.brier.toFixed(3)}</td></tr>
                <tr className="text-muted-foreground"><td className="py-1">last-week winner</td><td className="py-1 text-right tabular-nums">{v.baselines.lastWeek.logLoss.toFixed(3)}</td><td className="py-1 text-right tabular-nums">{v.baselines.lastWeek.brier.toFixed(3)}</td></tr>
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground mt-3">
              Edge vs. uniform: <span className="font-medium">{signed(-v.ci.vsUniform.mean)}</span> log-loss
              (95% CI {(-v.ci.vsUniform.hi).toFixed(3)} … {(-v.ci.vsUniform.lo).toFixed(3)}; positive = line wins).
              Low-power with few weeks — read the interval, not the point.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
