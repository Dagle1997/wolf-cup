import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { RefreshCw, AlertCircle, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlayerBadge = {
  id: string;
  emoji: string;
  name: string;
  years: number[];
};

type PlayerStats = {
  playerId: number;
  name: string;
  wolfCallsTotal: number;
  wolfCallsWolf: number;
  wolfCallsBlindWolf: number;
  wolfWins: number;
  wolfLosses: number;
  wolfPushes: number;
  birdies: number;
  eagles: number;
  greenies: number;
  polies: number;
  totalMoney: number;
  biggestRoundWin: number;
  biggestRoundLoss: number;
  championshipWins?: number;
  championshipYears?: number[];
  isDefendingChampion?: boolean;
  badges?: PlayerBadge[];
  sandbagging?: { beatsCount: number; totalRounds: number; tier: 1 | 2 | 3 };
};

type StatsResponse = {
  players: PlayerStats[];
  lastUpdated: string;
};

type HoleAverage = {
  hole: number;
  par: number;
  avg: number | null;
  min: number | null;
  max: number | null;
  rounds: number;
};

type RoundSummary = {
  roundId: number;
  date: string;
  tee: string | null;
  handicapIndex: number;
  gross: number;
  stableford: number;
  money: number;
};

type Rival = {
  playerId: number;
  name: string;
  roundsTogether: number;
  myMoney: number;
  theirMoney: number;
  moneyDiff: number;
};

type PlayerDetail = {
  playerId: number;
  holeAverages: HoleAverage[];
  rounds: RoundSummary[];
  rivals: Rival[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wolfRecord(p: PlayerStats): string {
  return `${p.wolfWins}-${p.wolfLosses}-${p.wolfPushes}`;
}

function formatMoney(n: number): string {
  if (n === 0) return '$0';
  return n > 0 ? `+$${n}` : `-$${Math.abs(n)}`;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/stats')({
  component: StatsPage,
});

type SortKey = 'standings' | 'alpha' | 'money' | 'birdies' | 'wolf';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'standings', label: 'Standings' },
  { key: 'alpha', label: 'A-Z' },
  { key: 'money', label: 'Money' },
  { key: 'birdies', label: 'Birdies' },
  { key: 'wolf', label: 'Wolf' },
];

function sortPlayers(players: PlayerStats[], sortKey: SortKey, standingsRankMap?: Map<number, number>): PlayerStats[] {
  const sorted = [...players];
  switch (sortKey) {
    case 'standings': {
      const getRank = (p: PlayerStats) => standingsRankMap?.get(p.playerId) ?? 999;
      sorted.sort((a, b) => getRank(a) - getRank(b) || a.name.localeCompare(b.name));
      break;
    }
    case 'alpha':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'money':
      sorted.sort((a, b) => b.totalMoney - a.totalMoney || a.name.localeCompare(b.name));
      break;
    case 'birdies':
      sorted.sort((a, b) => (b.birdies + b.eagles) - (a.birdies + a.eagles) || a.name.localeCompare(b.name));
      break;
    case 'wolf': {
      // Sort by win%, then total alone/blind calls desc
      const wolfScore = (p: PlayerStats) => {
        const total = p.wolfCallsWolf + p.wolfCallsBlindWolf;
        if (total === 0) return -1; // no calls = bottom
        return p.wolfWins / total;
      };
      sorted.sort((a, b) => {
        const diff = wolfScore(b) - wolfScore(a);
        if (Math.abs(diff) > 0.001) return diff;
        return (b.wolfCallsWolf + b.wolfCallsBlindWolf) - (a.wolfCallsWolf + a.wolfCallsBlindWolf) || a.name.localeCompare(b.name);
      });
      break;
    }
  }
  return sorted;
}

type StandingsEntry = { playerId: number; rank: number; combinedTotal: number };
type StandingsData = { fullMembers: StandingsEntry[]; subs: StandingsEntry[] };

function StatsPage() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['stats'],
    queryFn: () => apiFetch<StatsResponse>('/stats'),
  });

  const { data: standingsData } = useQuery({
    queryKey: ['standings'],
    queryFn: () => apiFetch<StandingsData>('/standings'),
    staleTime: 60_000,
  });

  const standingsRankMap = useMemo(() => {
    const map = new Map<number, number>();
    if (standingsData) {
      for (const p of [...standingsData.fullMembers, ...standingsData.subs]) {
        map.set(p.playerId, p.rank);
      }
    }
    return map;
  }, [standingsData]);

  const [sortKey, setSortKey] = useState<SortKey>('standings');
  const [compareIds, setCompareIds] = useState<[number, number] | null>(null);

  const sortedPlayers = useMemo(
    () => data ? sortPlayers(data.players, sortKey, standingsRankMap) : [],
    [data, sortKey, standingsRankMap],
  );

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-bold tracking-tight">Player Statistics</h2>
        <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching} className="h-8 px-2">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Awards Wall link */}
      <Link
        to="/standings/history"
        hash="awards"
        className="block mb-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-2.5 text-center text-sm font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors"
      >
        🏆 View Awards Wall & Badge Explanations
      </Link>

      {/* Sort buttons */}
      {data && data.players.length > 0 && (
        <div className="flex gap-1.5 mb-3">
          {SORT_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSortKey(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                sortKey === key
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {isLoading && <LoadingSkeleton />}

      {isError && !isLoading && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-muted-foreground">Could not load stats — tap to retry</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && data && (
        <>
          {data.players.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="text-5xl">📈</span>
              <p className="text-muted-foreground">No statistics available yet.</p>
              <p className="text-xs text-muted-foreground/60">Stats populate after finalized rounds.</p>
            </div>
          ) : (
            <>
              {compareIds && (() => {
                const pA = data.players.find((pl) => pl.playerId === compareIds[0]);
                const pB = data.players.find((pl) => pl.playerId === compareIds[1]);
                if (!pA || !pB) return null;
                return <CompareView playerA={pA} playerB={pB} onClose={() => setCompareIds(null)} />;
              })()}

              <div className="flex flex-col gap-3">
                {sortedPlayers.map((p, i) => (
                  <PlayerCard
                    key={p.playerId}
                    player={p}
                    rank={i + 1}
                    allPlayers={data.players}
                    onCompare={(otherId) => setCompareIds([p.playerId, otherId])}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player Card — mobile-optimized
// ---------------------------------------------------------------------------

function PlayerCard({ player: p, rank, allPlayers, onCompare }: { player: PlayerStats; rank: number; allPlayers: PlayerStats[]; onCompare: (otherId: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showCompareSelect, setShowCompareSelect] = useState(false);

  const { data: detail } = useQuery({
    queryKey: ['player-detail', p.playerId],
    queryFn: () => apiFetch<PlayerDetail>(`/stats/${p.playerId}/detail`),
    enabled: expanded,
    staleTime: 60_000,
  });
  const moneyColor = p.totalMoney > 0
    ? 'text-green-600'
    : p.totalMoney < 0
      ? 'text-destructive'
      : '';

  return (
    <div className={`rounded-xl border overflow-hidden shadow-sm ${p.isDefendingChampion ? 'border-x-2 border-x-amber-400' : ''}`}>
      {/* Header — player name + total money */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-xs font-bold text-muted-foreground w-5 text-center">{rank}</span>
          <div>
            <span className="font-semibold">{p.name}</span>
            {p.isDefendingChampion && (
              <div className="text-[9px] font-medium text-amber-500">Defending Champion</div>
            )}
          </div>
          {p.championshipYears && p.championshipYears.map((year) => (
            <Link key={year} to="/standings/history" hash="badge-dynasty" className="inline-flex flex-col items-center leading-none">
              <span className="text-sm">🏆</span>
              <span className="text-[8px] text-muted-foreground">{String(year).slice(2)}</span>
            </Link>
          ))}
          {p.badges && p.badges.map((badge) => {
            // Per-season awards (money_man, philanthropist): repeat emoji per year
            if (['money_man', 'philanthropist'].includes(badge.id) && badge.years.length > 1) {
              return badge.years.map((year) => (
                <Link key={`${badge.id}-${year}`} to="/standings/history" hash={`badge-${badge.id}`} className="inline-flex flex-col items-center leading-none">
                  <span className="text-sm">{badge.emoji}</span>
                  <span className="text-[8px] text-muted-foreground">{String(year).slice(2)}</span>
                </Link>
              ));
            }
            // Single emoji badges (OG, Every Season, single-year money/philanthropist)
            return (
              <Link key={badge.id} to="/standings/history" hash={`badge-${badge.id}`} className="inline-flex flex-col items-center leading-none">
                <span className="text-sm">{badge.emoji}</span>
                {['money_man', 'philanthropist'].includes(badge.id) && badge.years[0] && (
                  <span className="text-[8px] text-muted-foreground">{String(badge.years[0]).slice(2)}</span>
                )}
              </Link>
            );
          })}
          {p.sandbagging && (
            <span
              className="inline-flex flex-col items-center leading-none"
              title={p.sandbagging.tier === 1 ? 'Hmm... suspiciously good lately' : p.sandbagging.tier === 2 ? 'Nice putt, Ronnie' : 'Someone call the levee board'}
            >
              <span className={p.sandbagging.tier === 3 ? 'text-2xl' : p.sandbagging.tier === 2 ? 'text-lg' : 'text-sm'}>
                🏌️
              </span>
              <span className="text-[8px] text-amber-600">{p.sandbagging.beatsCount}/{p.sandbagging.totalRounds}</span>
            </span>
          )}
        </div>
        <span className={`text-base font-bold tabular-nums ${moneyColor}`}>
          {formatMoney(p.totalMoney)}
        </span>
      </div>

      {/* Sandbagger explainer */}
      {p.sandbagging && (
        <div className="px-4 py-1 bg-amber-50/50 dark:bg-amber-950/20 border-b text-[10px] text-amber-700 dark:text-amber-400">
          Shot below handicap {p.sandbagging.beatsCount}/{p.sandbagging.totalRounds} rounds
          {p.sandbagging.tier === 1 && ' — hmm...'}
          {p.sandbagging.tier === 2 && ' — suspicious'}
          {p.sandbagging.tier === 3 && ' — CERTIFIED SANDBAGGER'}
        </div>
      )}

      {/* Stats grid — 2 rows of data */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 text-left hover:bg-muted/20 transition-colors"
      >
        <div className="grid grid-cols-4 gap-y-3 gap-x-2 text-center">
          <StatCell label="Record" value={wolfRecord(p)} />
          <StatCell label="Wolf" value={String(p.wolfCallsWolf)} />
          <StatCell label="Blind" value={String(p.wolfCallsBlindWolf)} />
          <StatCell label="Birdies" value={String(p.birdies)} highlight={p.birdies > 0} />

          <StatCell label="Eagles" value={String(p.eagles)} highlight={p.eagles > 0} />
          <StatCell label="Greenies" value={String(p.greenies)} />
          <StatCell label="Polies" value={String(p.polies)} />
          <StatCell
            label="Best Rd"
            value={formatMoney(p.biggestRoundWin)}
            className="text-green-600"
          />
        </div>
        <div className="flex items-center justify-center mt-2">
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && detail && (
        <div className="border-t">
          {/* Compare button at top of expanded */}
          <div className="px-4 py-2 border-b bg-muted/20">
            {!showCompareSelect ? (
              <button
                type="button"
                onClick={() => setShowCompareSelect(true)}
                className="w-full text-xs text-center py-1 rounded-lg bg-muted hover:bg-muted/80 font-medium transition-colors"
              >
                Compare with another player
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  className="flex-1 rounded-md border bg-background px-2 py-1.5 text-xs"
                  onChange={(e) => {
                    if (e.target.value) {
                      onCompare(Number(e.target.value));
                      setShowCompareSelect(false);
                    }
                  }}
                  defaultValue=""
                >
                  <option value="">Pick a player...</option>
                  {allPlayers
                    .filter((o) => o.playerId !== p.playerId)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((o) => (
                      <option key={o.playerId} value={o.playerId}>{o.name}</option>
                    ))}
                </select>
                <button type="button" onClick={() => setShowCompareSelect(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
              </div>
            )}
          </div>

          {/* Per-hole averages — horizontal scroll */}
          {detail.holeAverages.length > 0 && (
            <div className="px-4 py-3 border-b">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Hole-by-Hole</p>
              <div className="overflow-x-auto -mx-4 px-4">
                <div className="flex gap-0">
                  {detail.holeAverages.map((h) => {
                    const diff = h.avg != null ? h.avg - h.par : null;
                    const color = diff == null ? '' : diff <= -1 ? 'text-green-500' : diff <= 0 ? 'text-muted-foreground' : diff <= 0.5 ? 'text-orange-500' : 'text-red-500';
                    const bgColor = diff == null ? '' : diff <= -1 ? 'bg-green-500/10' : diff <= 0 ? '' : diff <= 0.5 ? 'bg-orange-500/10' : 'bg-red-500/10';
                    return (
                      <div key={h.hole} className={`flex-shrink-0 w-10 text-center py-1.5 ${bgColor} ${h.hole === 10 ? 'ml-2 border-l border-muted' : ''}`}>
                        <div className="text-[9px] text-muted-foreground">{h.hole}</div>
                        <div className="text-[9px] text-muted-foreground/50">P{h.par}</div>
                        <div className={`text-sm font-bold tabular-nums ${color}`}>
                          {h.avg != null ? h.avg.toFixed(1) : '—'}
                        </div>
                        <div className="text-[8px] text-muted-foreground">
                          {h.min != null ? `${h.min}-${h.max}` : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Par averages + Best/worst holes */}
              {(() => {
                const withAvg = detail.holeAverages.filter((h) => h.avg != null);
                if (withAvg.length === 0) return null;
                const best = withAvg.reduce((a, b) => (a.avg! - a.par) < (b.avg! - b.par) ? a : b);
                const worst = withAvg.reduce((a, b) => (a.avg! - a.par) > (b.avg! - b.par) ? a : b);
                const parAvg = (par: number) => {
                  const holes = withAvg.filter((h) => h.par === par);
                  if (holes.length === 0) return null;
                  return (holes.reduce((s, h) => s + h.avg!, 0) / holes.length).toFixed(1);
                };
                return (
                  <>
                    <div className="flex gap-3 mt-2 text-xs">
                      <span className="text-muted-foreground">Par 3: <span className="font-bold text-foreground">{parAvg(3) ?? '—'}</span></span>
                      <span className="text-muted-foreground">Par 4: <span className="font-bold text-foreground">{parAvg(4) ?? '—'}</span></span>
                      <span className="text-muted-foreground">Par 5: <span className="font-bold text-foreground">{parAvg(5) ?? '—'}</span></span>
                    </div>
                    <div className="flex gap-4 mt-1 text-xs">
                      <span className="text-green-500">Best: #{best.hole} (avg {best.avg!.toFixed(1)}, par {best.par})</span>
                      <span className="text-red-500">Worst: #{worst.hole} (avg {worst.avg!.toFixed(1)}, par {worst.par})</span>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* Round history */}
          {detail.rounds.length > 0 && (() => {
            const bestRound = detail.rounds.reduce((a, b) => a.gross < b.gross ? a : b);
            return (
              <div className="px-4 py-3 border-b">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Round History</p>
                  <span className="text-[10px] text-green-500">Best Gross: {bestRound.gross} ({new Date(bestRound.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground/50 mb-1 pb-1 border-b border-muted">
                  <span className="w-14">Date</span>
                  <span className="w-10 text-center">Tee</span>
                  <span className="w-10 text-center">Gross</span>
                  <span className="w-10 text-center">Net</span>
                  <span className="w-10 text-center">Stab</span>
                  <span className="w-12 text-right">Money</span>
                </div>
                <div className="space-y-1">
                  {detail.rounds.map((r) => {
                    const isBest = r.roundId === bestRound.roundId;
                    const net = r.gross - Math.round(r.handicapIndex);
                    return (
                      <div key={r.roundId} className={`flex items-center justify-between text-xs py-1 ${isBest ? 'bg-green-500/5 rounded' : ''}`}>
                        <span className="text-muted-foreground w-14">{new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        <span className="w-10 text-center capitalize text-muted-foreground/60 text-[10px]">{r.tee ?? '—'}</span>
                        <span className={`w-10 text-center tabular-nums font-medium ${isBest ? 'text-green-500' : ''}`}>{r.gross}</span>
                        <span className="w-10 text-center tabular-nums text-muted-foreground">{net}</span>
                        <span className="w-10 text-center tabular-nums">{r.stableford}</span>
                        <span className={`w-12 text-right tabular-nums font-medium ${r.money > 0 ? 'text-green-600' : r.money < 0 ? 'text-destructive' : ''}`}>
                          {formatMoney(r.money)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Partner Chemistry + Rivals */}
          {detail.rivals.length > 0 && (() => {
            const sorted = [...detail.rivals].sort((a, b) => b.myMoney - a.myMoney);
            const bestPartner = sorted[0];
            const worstPartner = sorted[sorted.length - 1];
            const rivalsSorted = [...detail.rivals].sort((a, b) => a.moneyDiff - b.moneyDiff); // worst diff first
            return (
              <div className="px-4 py-3">
                {/* Good luck charm + Rival */}
                {sorted.length >= 2 && (
                  <div className="mb-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-2 text-center">
                        <div className="text-[10px] text-green-600 font-medium">Good Luck Charm</div>
                        <div className="text-sm font-bold">{bestPartner!.name}</div>
                        <div className="text-xs text-green-600 font-bold tabular-nums">{formatMoney(bestPartner!.myMoney)}</div>
                        <div className="text-[9px] text-muted-foreground">{bestPartner!.roundsTogether} rounds together</div>
                      </div>
                      <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2 text-center">
                        <div className="text-[10px] text-red-500 font-medium">Rival</div>
                        <div className="text-sm font-bold">{worstPartner!.name}</div>
                        <div className="text-xs text-red-500 font-bold tabular-nums">{formatMoney(worstPartner!.myMoney)}</div>
                        <div className="text-[9px] text-muted-foreground">{worstPartner!.roundsTogether} rounds together</div>
                      </div>
                    </div>
                    <p className="text-[9px] text-muted-foreground/50 mt-1 text-center">Your season money when grouped with each player</p>
                  </div>
                )}

                {/* Full rival list */}
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">When Grouped With</p>
                <div className="flex items-center justify-between text-[9px] text-muted-foreground/50 mb-1 pb-1 border-b border-muted">
                  <span className="flex-1">Player</span>
                  <span className="w-12 text-center">Rds</span>
                  <span className="w-14 text-right">Your $</span>
                  <span className="w-14 text-right">+/-</span>
                </div>
                <div className="space-y-1.5">
                  {rivalsSorted.map((r) => (
                    <div key={r.playerId} className="flex items-center justify-between text-xs">
                      <span className="font-medium flex-1">{r.name}</span>
                      <span className="text-muted-foreground w-12 text-center">{r.roundsTogether}x</span>
                      <span className={`w-14 text-right tabular-nums ${r.myMoney > 0 ? 'text-green-600' : r.myMoney < 0 ? 'text-destructive' : ''}`}>
                        {formatMoney(r.myMoney)}
                      </span>
                      <span className={`w-14 text-right tabular-nums font-bold ${r.moneyDiff > 0 ? 'text-green-600' : r.moneyDiff < 0 ? 'text-destructive' : ''}`}>
                        {r.moneyDiff > 0 ? '+' : ''}{r.moneyDiff !== 0 ? `$${Math.abs(r.moneyDiff)}` : 'Even'}
                      </span>
                    </div>
                  ))}
                </div>

              </div>
            );
          })()}
        </div>
      )}

      {expanded && !detail && (
        <div className="border-t px-4 py-3 text-center text-xs text-muted-foreground">Loading...</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare View — side-by-side player comparison
// ---------------------------------------------------------------------------

function CompareView({ playerA, playerB, onClose }: { playerA: PlayerStats; playerB: PlayerStats; onClose: () => void }) {
  const { data: detailA } = useQuery({
    queryKey: ['player-detail', playerA.playerId],
    queryFn: () => apiFetch<PlayerDetail>(`/stats/${playerA.playerId}/detail`),
    staleTime: 60_000,
  });
  const { data: detailB } = useQuery({
    queryKey: ['player-detail', playerB.playerId],
    queryFn: () => apiFetch<PlayerDetail>(`/stats/${playerB.playerId}/detail`),
    staleTime: 60_000,
  });

  // Find head-to-head from rivalry data
  const h2h = detailA?.rivals.find((r) => r.playerId === playerB.playerId);

  function CompareRow({ label, a, b, higherWins = true }: { label: string; a: number; b: number; higherWins?: boolean }) {
    const aWins = higherWins ? a > b : a < b;
    const bWins = higherWins ? b > a : b < a;
    return (
      <div className="flex items-center text-xs py-1">
        <span className={`w-16 text-right tabular-nums font-bold ${aWins ? 'text-green-500' : ''}`}>{a}</span>
        <span className="flex-1 text-center text-[10px] text-muted-foreground">{label}</span>
        <span className={`w-16 text-left tabular-nums font-bold ${bWins ? 'text-green-500' : ''}`}>{b}</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border shadow-sm overflow-hidden mb-3 bg-card">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/40 border-b">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Head to Head</span>
        <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
      </div>
      <div className="px-4 py-3">
        {/* Names */}
        <div className="flex items-center text-sm font-bold mb-3">
          <span className="w-16 text-right truncate">{playerA.name.split(' ')[0]}</span>
          <span className="flex-1 text-center text-muted-foreground text-xs">vs</span>
          <span className="w-16 text-left truncate">{playerB.name.split(' ')[0]}</span>
        </div>

        <CompareRow label="Wolf W" a={playerA.wolfWins} b={playerB.wolfWins} />
        <CompareRow label="Wolf L" a={playerA.wolfLosses} b={playerB.wolfLosses} higherWins={false} />
        <CompareRow label="Birdies" a={playerA.birdies} b={playerB.birdies} />
        <CompareRow label="Greenies" a={playerA.greenies} b={playerB.greenies} />
        <CompareRow label="Polies" a={playerA.polies} b={playerB.polies} />
        <CompareRow label="Money" a={playerA.totalMoney} b={playerB.totalMoney} />
        <CompareRow label="Best Rd" a={playerA.biggestRoundWin} b={playerB.biggestRoundWin} />

        {/* Head-to-head when grouped */}
        {h2h && (
          <div className="mt-3 pt-2 border-t border-muted">
            <p className="text-[10px] text-muted-foreground text-center mb-2">
              Grouped together {h2h.roundsTogether}x this season
            </p>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium">{playerA.name.split(' ')[0]}</span>
              <span className="text-muted-foreground">Money when grouped</span>
              <span className="font-medium">{playerB.name.split(' ')[0]}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className={`font-bold tabular-nums ${h2h.myMoney > 0 ? 'text-green-600' : h2h.myMoney < 0 ? 'text-destructive' : ''}`}>
                {formatMoney(h2h.myMoney)}
              </span>
              <div className="text-center">
                <div className={`text-lg font-black tabular-nums ${h2h.moneyDiff > 0 ? 'text-green-600' : h2h.moneyDiff < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {h2h.moneyDiff > 0 ? '+' : ''}{h2h.moneyDiff !== 0 ? `$${Math.abs(h2h.moneyDiff)}` : 'EVEN'}
                </div>
                <div className="text-[9px] text-muted-foreground">net {h2h.moneyDiff >= 0 ? playerA.name.split(' ')[0] : playerB.name.split(' ')[0]}</div>
              </div>
              <span className={`font-bold tabular-nums ${h2h.theirMoney > 0 ? 'text-green-600' : h2h.theirMoney < 0 ? 'text-destructive' : ''}`}>
                {formatMoney(h2h.theirMoney)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  highlight,
  className,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div>
      <div className={`text-sm font-semibold tabular-nums ${className ?? ''} ${highlight ? 'text-green-600' : ''}`}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl border overflow-hidden animate-pulse">
          <div className="h-12 bg-muted/40" />
          <div className="p-4 grid grid-cols-4 gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((j) => (
              <div key={j} className="h-8 bg-muted rounded" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
