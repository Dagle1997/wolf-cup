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
            <div className="flex flex-col gap-3">
              {sortedPlayers.map((p, i) => (
                <PlayerCard key={p.playerId} player={p} rank={i + 1} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player Card — mobile-optimized
// ---------------------------------------------------------------------------

function PlayerCard({ player: p, rank }: { player: PlayerStats; rank: number }) {
  const [expanded, setExpanded] = useState(false);

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
              {/* Best/worst holes */}
              {(() => {
                const withAvg = detail.holeAverages.filter((h) => h.avg != null);
                if (withAvg.length === 0) return null;
                const best = withAvg.reduce((a, b) => (a.avg! - a.par) < (b.avg! - b.par) ? a : b);
                const worst = withAvg.reduce((a, b) => (a.avg! - a.par) > (b.avg! - b.par) ? a : b);
                return (
                  <div className="flex gap-4 mt-2 text-xs">
                    <span className="text-green-500">Best: #{best.hole} (avg {best.avg!.toFixed(1)}, par {best.par})</span>
                    <span className="text-red-500">Worst: #{worst.hole} (avg {worst.avg!.toFixed(1)}, par {worst.par})</span>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Round history */}
          {detail.rounds.length > 0 && (
            <div className="px-4 py-3 border-b">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Round History</p>
              <div className="space-y-1">
                {detail.rounds.map((r) => (
                  <div key={r.roundId} className="flex items-center justify-between text-xs py-1">
                    <span className="text-muted-foreground w-16">{new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    <span className="w-10 text-center capitalize text-muted-foreground/60">{r.tee}</span>
                    <span className="w-10 text-center tabular-nums font-medium">{r.gross}</span>
                    <span className="w-10 text-center tabular-nums">{r.stableford}</span>
                    <span className={`w-12 text-right tabular-nums font-medium ${r.money > 0 ? 'text-green-600' : r.money < 0 ? 'text-destructive' : ''}`}>
                      {formatMoney(r.money)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground/50 mt-1 pt-1 border-t border-muted">
                <span>Date</span><span>Tee</span><span>Gross</span><span>Stab</span><span>Money</span>
              </div>
            </div>
          )}

          {/* Rivals */}
          {detail.rivals.length > 0 && (
            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Rivals</p>
              <div className="space-y-1.5">
                {detail.rivals.map((r) => (
                  <div key={r.playerId} className="flex items-center justify-between text-xs">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground">{r.roundsTogether}x together</span>
                    <span className={`font-bold tabular-nums ${r.moneyDiff > 0 ? 'text-green-600' : r.moneyDiff < 0 ? 'text-destructive' : ''}`}>
                      {r.moneyDiff > 0 ? '+' : ''}{r.moneyDiff !== 0 ? `$${Math.abs(r.moneyDiff)}` : 'Even'}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-muted-foreground/50 mt-2">Money differential when grouped together</p>
            </div>
          )}
        </div>
      )}

      {expanded && !detail && (
        <div className="border-t px-4 py-3 text-center text-xs text-muted-foreground">Loading...</div>
      )}
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
