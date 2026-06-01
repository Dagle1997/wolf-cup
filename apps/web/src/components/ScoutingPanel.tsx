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
  holes: { hole: number; par: number; avg: number }[];
};
type ScoutGroup = {
  groupNumber: number;
  players: ScoutPlayer[];
  rivalry: { leaderName: string; trailerName: string; leaderWins: number; trailerWins: number; moneyDiff: number; shared: number } | null;
  luckyCharm: { aName: string; bName: string; wins: number; losses: number; pushes: number; winRate: number } | null;
};

type OddsTier = 'favorite' | 'live' | 'longshot' | 'unpriced';
type OddsLine = {
  playerId: number;
  name: string;
  fairProb: number;
  postedAmerican: number | null;
  impliedProb: number;
  tier: OddsTier;
  confidence: { rounds: number; level: 'low' | 'medium' | 'high' };
  drivers: {
    rounds: number;
    stablefordMean: number | null;
    moneyMean: number | null;
    stablefordRank: number | null;
    moneyRank: number | null;
    fieldSize: number;
  };
};

/** Plain-language reasoning behind a member's price — "the form behind the number."
 * Built from the same Stableford/money the model priced on, so it can't be argued with. */
function oddsWhy(line: OddsLine): string | null {
  const d = line.drivers;
  if (!d) return null;
  if (line.tier === 'unpriced' || d.rounds < 2) {
    return `Only ${d.rounds} round${d.rounds === 1 ? '' : 's'} in the books — too thin to price, so you're parked near the field average until there's more to go on.`;
  }
  const N = d.fieldSize;
  const band = Math.max(1, Math.ceil(N / 3));
  const where = (rank: number | null) =>
    rank == null ? 'mid-pack' : rank <= band ? 'top of the field' : rank > N - band ? 'near the bottom' : 'mid-pack';
  const money = d.moneyMean == null ? '' : d.moneyMean >= 0 ? `+$${d.moneyMean}` : `−$${Math.abs(d.moneyMean)}`;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const stab = `${where(d.stablefordRank)} in Stableford (${d.stablefordMean} avg)`;
  const mon = `${where(d.moneyRank)} in money (${money})`;
  return `${cap(stab)}; ${mon}.`;
}
type Odds =
  | { gated: true; reason: string }
  | { gated: false; theoreticalHold: number; effectiveHold: number; wideOpen: boolean; simCount: number; lines: OddsLine[] };
type Retrospective = {
  winningMemberId: number | null;
  winningMemberName: string | null;
  subSpoiled: boolean;
  verdict: 'chalk' | 'upset' | 'busted';
  favoriteId: number | null;
  favoriteName: string | null;
  winnerPostedAmerican: number | null;
} | null;
type Week = { roundId: number; date: string; label: string; status: string };
type ScoutResponse = {
  roundId: number;
  seasonRounds: number;
  groups: ScoutGroup[];
  weeks: Week[];
  odds: Odds;
  retrospective: Retrospective;
};

const teeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const fmtAmerican = (a: number | null) => (a === null ? '—' : a > 0 ? `+${a}` : `${a}`);
const fmtDate = (d: string) => {
  const [, m, day] = d.split('-');
  return m && day ? `${Number(m)}/${Number(day)}` : d;
};
const tierLabel: Record<OddsTier, string> = { favorite: 'Favorite', live: 'Live', longshot: 'Longshot', unpriced: 'Thin sample' };
const chipClass = (tier: OddsTier) =>
  tier === 'favorite'
    ? 'text-emerald-700 bg-emerald-50'
    : tier === 'longshot'
      ? 'text-muted-foreground bg-muted'
      : tier === 'unpriced'
        ? 'text-muted-foreground'
        : 'text-foreground bg-muted/60';

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

/** Hole-by-hole average score (vs par). Rendered from data already on the card —
 * no fetch, so expanding is instant and the layout doesn't shift. */
function HoleAverages({ holes }: { holes: ScoutPlayer['holes'] }) {
  if (holes.length === 0) return null;
  const byHole = new Map(holes.map((h) => [h.hole, h]));
  const cell = (n: number) => {
    const h = byHole.get(n);
    const color = !h ? 'text-muted-foreground' : h.avg < h.par ? 'text-green-600' : h.avg > h.par ? 'text-destructive' : 'text-foreground';
    return (
      <div key={n} className="flex flex-col items-center w-7 shrink-0 text-[10px]">
        <span className="text-muted-foreground">{n}</span>
        <span className={`font-semibold ${color}`}>{h ? h.avg.toFixed(1) : '—'}</span>
      </div>
    );
  };
  return (
    <div className="mt-2">
      <p className="text-[10px] text-muted-foreground mb-0.5">Avg score by hole (green = under par)</p>
      <div className="flex">{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(cell)}</div>
      <div className="flex mt-0.5">{[10, 11, 12, 13, 14, 15, 16, 17, 18].map(cell)}</div>
    </div>
  );
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
        <div className="px-3 pb-2 pl-8">
          <ul className="flex flex-col gap-1">
            {lines.length > 0 ? (
              lines.map((l, i) => <li key={i} className="text-xs text-muted-foreground">{l}</li>)
            ) : (
              <li className="text-xs text-muted-foreground">Not enough rounds yet ({p.rounds}).</li>
            )}
          </ul>
          <HoleAverages holes={p.holes} />
        </div>
      )}
    </div>
  );
}

/** One tappable row on The Line — name + price; tap to drill into the % + reasoning. */
function LineRow({ line }: { line: OddsLine }) {
  const [open, setOpen] = useState(false);
  const why = oddsWhy(line);
  return (
    <div className="border-b last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40 text-sm"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="font-medium">{line.name}</span>
        <span className="text-[10px] text-muted-foreground">{tierLabel[line.tier]}</span>
        <span className={`ml-auto w-14 text-right font-semibold tabular-nums rounded px-1 ${chipClass(line.tier)}`}>{fmtAmerican(line.postedAmerican)}</span>
      </button>
      {open && (
        <div className="px-3 pb-2 pl-8 text-xs">
          {line.postedAmerican !== null && (
            <p className="text-muted-foreground mb-1">{(line.fairProb * 100).toFixed(1)}% to win the week · confidence {line.confidence.level}</p>
          )}
          {why && <p className="text-foreground/80 italic leading-snug">📊 {why}</p>}
        </div>
      )}
    </div>
  );
}

/** 📊 The Line — field-wide board, favorites → longshots; tap a name to drill in. */
function TheLine({ odds }: { odds: Odds }) {
  if (odds.gated) {
    return (
      <div className="rounded-xl border p-4 text-center text-sm text-muted-foreground">
        📊 The Line · {odds.reason}
      </div>
    );
  }
  if (odds.wideOpen) {
    return (
      <div className="rounded-xl border overflow-hidden shadow-sm">
        <div className="bg-muted/60 px-3 py-2 border-b font-semibold text-sm">🌀 Wide-open week</div>
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Nobody has separated from the pack — handicaps have everyone bunched. Any of these could take it.
        </p>
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {odds.lines.map((l) => (
            <span key={l.playerId} className="text-xs rounded px-1.5 py-0.5 bg-muted tabular-nums">
              {l.name} {fmtAmerican(l.postedAmerican)}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border overflow-hidden shadow-sm">
      <div className="bg-muted/60 px-3 py-2 border-b">
        <p className="font-semibold text-sm">📊 The Line — to win the week</p>
        <p className="text-[10px] text-muted-foreground">most Harvey points · house holds ~{(odds.effectiveHold * 100).toFixed(0)}% · for fun · tap a name for the why</p>
      </div>
      <div>
        {odds.lines.map((l) => <LineRow key={l.playerId} line={l} />)}
      </div>
    </div>
  );
}

/** Retrospective verdict badge for past finalized weeks. */
function RetroGrade({ retro }: { retro: NonNullable<Retrospective> }) {
  const badge =
    retro.verdict === 'chalk' ? { emoji: '✅', label: 'Chalk', cls: 'text-emerald-800 bg-emerald-50' }
      : retro.verdict === 'upset' ? { emoji: '🎲', label: 'Upset', cls: 'text-amber-800 bg-amber-50' }
        : { emoji: '💥', label: 'Busted', cls: 'text-rose-800 bg-rose-50' };
  return (
    <div className={`rounded-xl border p-3 text-sm ${badge.cls}`}>
      <p className="font-semibold">{badge.emoji} {badge.label}</p>
      <p className="text-xs mt-0.5">
        {retro.subSpoiled && '🃏 Won by a sub — settled on the top member. '}
        Favorite was <span className="font-medium">{retro.favoriteName ?? '—'}</span>;
        the week went to <span className="font-medium">{retro.winningMemberName ?? '—'}</span>
        {retro.winnerPostedAmerican !== null ? ` (${fmtAmerican(retro.winnerPostedAmerican)})` : ''}.
      </p>
    </div>
  );
}

export function ScoutingPanel({ roundId }: { roundId: number }) {
  // Week selector — default = the round we were mounted with; scrubbing loads a
  // past week's frozen line + grade.
  const [selected, setSelected] = useState<number | null>(null);
  const effectiveRoundId = selected ?? roundId;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['scouting', effectiveRoundId],
    queryFn: () => apiFetch<ScoutResponse>(`/scouting/${effectiveRoundId}`),
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

  return (
    <div className="space-y-3">
      {/* Week selector */}
      {data.weeks.length > 1 && (
        <div className="flex items-center gap-2 px-1">
          <label htmlFor="scouting-week" className="text-[11px] text-muted-foreground">Week</label>
          <select
            id="scouting-week"
            value={effectiveRoundId}
            onChange={(e) => setSelected(Number(e.target.value))}
            className="text-xs border rounded px-2 py-1 bg-background"
          >
            {data.weeks.map((w) => (
              <option key={w.roundId} value={w.roundId}>
                {fmtDate(w.date)}{w.status === 'finalized' ? '' : ' (upcoming)'}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Retrospective grade (past finalized weeks only) — leads, above the line */}
      {data.retrospective && <RetroGrade retro={data.retrospective} />}

      {/* 📊 The Line */}
      <TheLine odds={data.odds} />

      {data.groups.length === 0 ? (
        <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">No scouting data yet — groups or 2026 rounds aren't set.</div>
      ) : (
        <>
          <div className="px-1 pt-1">
            <h3 className="font-bold text-sm">🔍 Group Scouting</h3>
            <p className="text-[11px] text-muted-foreground">This week's foursomes · based on {data.seasonRounds} round{data.seasonRounds === 1 ? '' : 's'} this season · tap a player for their form</p>
          </div>
          {data.groups.map((g) => (
            <div key={g.groupNumber} className="rounded-xl border overflow-hidden shadow-sm">
              <div className="bg-muted/60 px-3 py-2 border-b">
                <p className="font-semibold text-sm">Group {g.groupNumber}</p>
                <div className="mt-1 flex flex-col gap-0.5">
                  {g.rivalry && g.rivalry.leaderWins > g.rivalry.trailerWins && (
                    <p className="text-xs text-amber-800">
                      ⚔️ {g.rivalry.leaderName} owns {g.rivalry.trailerName} — {g.rivalry.leaderWins}–{g.rivalry.trailerWins}
                      {g.rivalry.moneyDiff !== 0 ? ` (${g.rivalry.moneyDiff >= 0 ? '+' : '−'}$${Math.abs(g.rivalry.moneyDiff)})` : ''}
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
        </>
      )}
    </div>
  );
}
