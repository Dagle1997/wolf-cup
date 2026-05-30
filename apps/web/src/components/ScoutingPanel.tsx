import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';

type Trend = { direction: 'up' | 'down' | 'flat'; delta: number; sample: number };
type ScoutPlayer = {
  playerId: number;
  name: string;
  rounds: number;
  handicapTrend: Trend | null;
  bestHoles: number[];
  worstHoles: number[];
  topBirdieHole: { hole: number; count: number; rounds: number } | null;
  bestTee: { tee: string; avgStableford: number; rounds: number } | null;
  biggestWin: number;
  biggestLoss: number;
  boomOrBust: { stdDev: number; sample: number } | null;
  loneWolfWhenBehind: { alone: number; behind: number; rate: number } | null;
};
type ScoutGroup = {
  groupNumber: number;
  players: ScoutPlayer[];
  rivalry: { aName: string; bName: string; leaderName: string; aWins: number; bWins: number; moneyDiff: number; shared: number } | null;
  luckyCharm: { aName: string; bName: string; wins: number; losses: number; pushes: number; winRate: number } | null;
};
type ScoutResponse = { roundId: number; seasonRounds: number; groups: ScoutGroup[] };

const teeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Compact stat lines for a player, most-interesting first. */
function statLines(p: ScoutPlayer): string[] {
  const out: string[] = [];
  if (p.handicapTrend && p.handicapTrend.direction !== 'flat') {
    const arrow = p.handicapTrend.direction === 'up' ? '↑' : '↓';
    out.push(`📈 Handicap ${arrow} ${Math.abs(p.handicapTrend.delta)} over last ${p.handicapTrend.sample} wks`);
  }
  if (p.bestHoles.length) out.push(`🎯 Best holes: ${p.bestHoles.join(', ')}`);
  if (p.topBirdieHole) out.push(`🐦 Birdied ${p.topBirdieHole.hole} in ${p.topBirdieHole.count} of ${p.topBirdieHole.rounds}`);
  if (p.bestTee) out.push(`🟦 Best off ${teeLabel(p.bestTee.tee)} (${p.bestTee.avgStableford} avg)`);
  if (p.boomOrBust && p.boomOrBust.stdDev >= 6) out.push(`🎢 Boom-or-bust (±${p.boomOrBust.stdDev})`);
  if (p.loneWolfWhenBehind && p.loneWolfWhenBehind.behind >= 2 && p.loneWolfWhenBehind.rate >= 0.5) {
    out.push(`🐺 Lone wolf when behind (${p.loneWolfWhenBehind.alone}/${p.loneWolfWhenBehind.behind})`);
  }
  if (p.biggestWin > 0) out.push(`💰 Best day +$${p.biggestWin}`);
  if (p.worstHoles.length) out.push(`⚠️ Struggles: ${p.worstHoles.join(', ')}`);
  return out;
}

function PlayerRow({ p }: { p: ScoutPlayer }) {
  const [open, setOpen] = useState(false);
  const lines = statLines(p);
  const headline = lines[0] ?? `${p.rounds} round${p.rounds === 1 ? '' : 's'} this year`;
  return (
    <div className="border-b last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="font-medium text-sm shrink-0">{p.name}</span>
        <span className="text-xs text-muted-foreground truncate">· {headline}</span>
      </button>
      {open && (
        <ul className="px-3 pb-2 pl-8 flex flex-col gap-1">
          {lines.length > 0 ? (
            lines.map((l, i) => <li key={i} className="text-xs text-muted-foreground">{l}</li>)
          ) : (
            <li className="text-xs text-muted-foreground">Not enough rounds yet ({p.rounds}).</li>
          )}
        </ul>
      )}
    </div>
  );
}

export function ScoutingPanel({ roundId }: { roundId: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['scouting', roundId],
    queryFn: () => apiFetch<ScoutResponse>(`/scouting/${roundId}`),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border p-8 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (isError || !data) {
    return <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Could not load the scouting report.</div>;
  }
  if (data.groups.length === 0) {
    return <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">No scouting data yet — groups or 2026 rounds aren't set.</div>;
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground px-1">Based on {data.seasonRounds} round{data.seasonRounds === 1 ? '' : 's'} this season · tap a player for more</p>
      {data.groups.map((g) => (
        <div key={g.groupNumber} className="rounded-xl border overflow-hidden shadow-sm">
          <div className="bg-muted/60 px-3 py-2 border-b">
            <p className="font-semibold text-sm">Group {g.groupNumber}</p>
            <div className="mt-1 flex flex-col gap-0.5">
              {g.rivalry && Math.abs(g.rivalry.aWins - g.rivalry.bWins) > 0 && (
                <p className="text-xs text-amber-800">
                  ⚔️ {g.rivalry.leaderName} owns it — {g.rivalry.aName} {g.rivalry.aWins}–{g.rivalry.bWins} {g.rivalry.bName}
                  {Math.abs(g.rivalry.moneyDiff) > 0 ? ` (${g.rivalry.moneyDiff >= 0 ? '+' : '−'}$${Math.abs(g.rivalry.moneyDiff)})` : ''}
                </p>
              )}
              {g.luckyCharm && (
                <p className="text-xs text-emerald-800">
                  🤝 Lucky charm: {g.luckyCharm.aName} + {g.luckyCharm.bName} ({g.luckyCharm.wins}–{g.luckyCharm.losses}
                  {g.luckyCharm.pushes ? `–${g.luckyCharm.pushes}` : ''} partnered)
                </p>
              )}
            </div>
          </div>
          <div>
            {g.players.map((p) => <PlayerRow key={p.playerId} p={p} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
