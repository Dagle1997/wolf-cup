import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshCw, AlertCircle, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sparkline } from '@/components/sparkline';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StandingsPlayer = {
  playerId: number;
  name: string;
  roundsPlayed: number;
  roundsDropped: number;
  stablefordTotal: number;
  moneyTotal: number;
  combinedTotal: number;
  avgPerRound: number;
  lowRound: number;
  highRound: number;
  rank: number;
  isPlayoffEligible: boolean;
  roundTotals: number[];
};

type StandingsResponse = {
  season: {
    id: number;
    name: string;
    totalRounds: number;
    roundsCompleted: number;
  } | null;
  fullMembers: StandingsPlayer[];
  subs: StandingsPlayer[];
  lastUpdated: string;
};

type PairingPair = {
  playerAId: number;
  playerAName: string;
  playerBId: number;
  playerBName: string;
  count: number;
};

type PairingHistoryResponse = {
  season: { id: number; name: string; year: number } | null;
  pairs: PairingPair[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/standings')({
  component: StandingsPage,
});

function StandingsPage() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['standings'],
    queryFn: () => apiFetch<StandingsResponse>('/standings'),
  });

  const { data: pairingData } = useQuery({
    queryKey: ['pairing-history'],
    queryFn: () => apiFetch<PairingHistoryResponse>('/pairings/history'),
    staleTime: 60_000,
  });

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <Link
        to="/standings/history"
        className="flex items-center justify-between px-4 py-2 mb-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 group"
      >
        <span className="text-sm font-semibold text-amber-800 dark:text-amber-200">
          🏆 Champions & History
        </span>
        <span className="text-xs text-amber-600 dark:text-amber-400 group-hover:translate-x-0.5 transition-transform">→</span>
      </Link>

      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            {data?.season ? `${data.season.name}` : 'Season Standings'}
          </h2>
          {data?.season && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Round {data.season.roundsCompleted} of {data.season.totalRounds} · Best 10 count
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Link
            to="/odds"
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2"
          >
            Odds
          </Link>
          <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching} className="h-8 px-2">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {isLoading && <LoadingSkeleton />}

      {isError && !isLoading && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-muted-foreground">Could not load standings — tap to retry</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      )}

      {!isLoading && !isError && data && (
        <>
          {data.season === null ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="text-5xl">📊</span>
              <p className="text-muted-foreground">No season data available</p>
            </div>
          ) : (
            <>
              {data.fullMembers.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <span className="text-5xl">🏆</span>
                  <p className="text-muted-foreground">No standings yet — play some rounds!</p>
                </div>
              ) : (
                <>
                  <StandingsTable players={data.fullMembers} showPlayoff pairs={pairingData?.pairs ?? []} />
                  {data.subs.length > 0 && (
                    <div className="mt-6">
                      <h3 className="text-base font-semibold mb-2">Substitutes</h3>
                      <StandingsTable players={data.subs} showPlayoff={false} pairs={pairingData?.pairs ?? []} />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StandingsTable
// ---------------------------------------------------------------------------

function rankRowStyle(rank: number, isPlayoffEligible: boolean, showPlayoff: boolean): string {
  const base = 'border-b last:border-0';
  const playoff = showPlayoff && isPlayoffEligible ? ' bg-green-50/50 dark:bg-green-950/15' : '';
  if (rank === 1) return `${base} border-l-2 border-l-amber-400${playoff}`;
  if (rank === 2) return `${base} border-l-2 border-l-slate-400${playoff}`;
  if (rank === 3) return `${base} border-l-2 border-l-orange-500${playoff}`;
  return `${base} border-l-2 border-l-transparent${playoff}`;
}

function RankBadge({ rank, isPlayoffEligible, showPlayoff }: { rank: number; isPlayoffEligible: boolean; showPlayoff: boolean }) {
  const badge = showPlayoff && isPlayoffEligible ? <span className="ml-1 text-green-500 text-[10px]">✓</span> : null;
  if (rank === 1) return <><span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-400 text-amber-900 text-xs font-black">1</span>{badge}</>;
  if (rank === 2) return <><span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-100 text-xs font-black">2</span>{badge}</>;
  if (rank === 3) return <><span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-400 text-orange-900 text-xs font-black">3</span>{badge}</>;
  return <><span className="text-sm font-medium text-muted-foreground">{rank}</span>{badge}</>;
}

function getPlayerPairings(playerId: number, pairs: PairingPair[]): { name: string; count: number }[] {
  const partners: { name: string; count: number }[] = [];
  for (const p of pairs) {
    if (p.playerAId === playerId) partners.push({ name: p.playerBName, count: p.count });
    else if (p.playerBId === playerId) partners.push({ name: p.playerAName, count: p.count });
  }
  partners.sort((a, b) => b.count - a.count);
  return partners;
}

function StandingsTable({ players, showPlayoff, pairs }: { players: StandingsPlayer[]; showPlayoff: boolean; pairs: PairingPair[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const hasPairings = pairs.length > 0;

  if (players.length === 0) {
    return <p className="text-muted-foreground text-sm">No results yet.</p>;
  }

  return (
    <div className="rounded-xl border overflow-x-auto shadow-sm">
      <table className="w-full text-sm min-w-[600px]">
        <thead>
          <tr className="border-b bg-muted/60 text-[11px] text-muted-foreground">
            <th className="py-2 pl-3 pr-1 text-center font-medium w-12">#</th>
            <th className="py-2 px-2 text-left font-medium">Player</th>
            <th className="py-2 px-2 text-right font-medium">Total</th>
            <th className="py-2 px-1 text-center font-medium w-16">Trend</th>
            <th className="py-2 px-2 text-center font-medium">Rds</th>
            <th className="py-2 px-2 text-right font-medium">Avg</th>
            <th className="py-2 px-2 text-right font-medium">Low</th>
            <th className="py-2 px-2 text-right font-medium">High</th>
            <th className="py-2 px-2 text-right font-medium">Stab</th>
            <th className="py-2 px-3 text-right font-medium">$</th>
          </tr>
        </thead>
        <tbody>
          {players.map((player) => {
            const isExpanded = expandedId === player.playerId;
            const partnerList = isExpanded ? getPlayerPairings(player.playerId, pairs) : [];
            return (
              <>
                <tr
                  key={player.playerId}
                  className={`${rankRowStyle(player.rank, player.isPlayoffEligible, showPlayoff)} ${hasPairings ? 'cursor-pointer hover:bg-muted/30' : ''}`}
                  onClick={() => hasPairings && setExpandedId(isExpanded ? null : player.playerId)}
                >
                  <td className="py-2.5 pl-3 pr-1 text-center">
                    <RankBadge rank={player.rank} isPlayoffEligible={player.isPlayoffEligible} showPlayoff={showPlayoff} />
                  </td>
                  <td className="py-2.5 px-2 font-semibold">
                    <span className="flex items-center gap-1">
                      {player.name}
                      {hasPairings && (
                        <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      )}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums font-bold text-base">{fmt(player.combinedTotal)}</td>
                  <td className="py-2.5 px-1 text-center">
                    {player.roundTotals.length >= 2 ? (
                      <Sparkline
                        data={player.roundTotals}
                        width={52}
                        height={16}
                        color="#8b5cf6"
                      />
                    ) : (
                      <span className="text-[10px] text-muted-foreground/30">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-center tabular-nums text-muted-foreground">
                    {player.roundsPlayed}
                    {player.roundsDropped > 0 && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 ml-0.5">(-{player.roundsDropped})</span>
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums text-muted-foreground">
                    {fmt(player.avgPerRound)}
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums text-muted-foreground">
                    {player.roundsPlayed > 0 ? fmt(player.lowRound) : '—'}
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums text-muted-foreground">
                    {player.roundsPlayed > 0 ? fmt(player.highRound) : '—'}
                  </td>
                  <td className="py-2.5 px-2 text-right tabular-nums">{fmt(player.stablefordTotal)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{fmt(player.moneyTotal)}</td>
                </tr>
                {isExpanded && (
                  <tr key={`${player.playerId}-pairings`}>
                    <td colSpan={10} className="px-4 py-2 bg-muted/20 border-b">
                      <p className="text-xs font-semibold text-muted-foreground mb-1.5">Paired With This Season</p>
                      {partnerList.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No pairing history yet</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {partnerList.map((p) => (
                            <span
                              key={p.name}
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                p.count >= 3
                                  ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                                  : p.count === 2
                                    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                                    : 'bg-muted text-foreground'
                              }`}
                            >
                              {p.name} <span className="font-bold">{p.count}x</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="rounded-md border overflow-hidden animate-pulse">
      <div className="h-9 bg-muted/50" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3 px-3 py-3 border-b last:border-0">
          <div className="h-4 w-6 bg-muted rounded" />
          <div className="flex-1">
            <div className="h-4 w-32 bg-muted rounded" />
          </div>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((j) => (
            <div key={j} className="h-4 w-10 bg-muted rounded" />
          ))}
        </div>
      ))}
    </div>
  );
}
