import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  rank: number;
  isPlayoffEligible: boolean;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatHarvey(points: number): string {
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

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">
          {data?.season ? `${data.season.name} Standings` : 'Season Standings'}
        </h2>
        <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
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
            <p className="text-muted-foreground">No season data available</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Round {data.season.roundsCompleted} of {data.season.totalRounds}
              </p>
              <StandingsTable players={data.fullMembers} showPlayoff />
              {data.subs.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-base font-semibold mb-2">Substitutes</h3>
                  <StandingsTable players={data.subs} showPlayoff={false} />
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StandingsTable({ players, showPlayoff }: { players: StandingsPlayer[]; showPlayoff: boolean }) {
  if (players.length === 0) {
    return <p className="text-muted-foreground text-sm">No results yet.</p>;
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="py-2 px-3 text-left font-medium text-muted-foreground w-10">Rank</th>
            <th className="py-2 px-3 text-left font-medium text-muted-foreground">Player</th>
            <th className="py-2 px-3 text-right font-medium text-muted-foreground">Stab</th>
            <th className="py-2 px-3 text-right font-medium text-muted-foreground">Money</th>
            <th className="py-2 px-3 text-right font-medium text-muted-foreground">Total</th>
          </tr>
        </thead>
        <tbody>
          {players.map((player) => (
            <tr
              key={player.playerId}
              className={`border-b last:border-0 ${showPlayoff && player.isPlayoffEligible ? 'bg-green-50 dark:bg-green-950/20' : ''}`}
            >
              <td className="py-2 px-3 font-medium text-muted-foreground">
                {player.rank}
                {showPlayoff && player.isPlayoffEligible && (
                  <span className="ml-1 text-green-600 text-xs">✓</span>
                )}
              </td>
              <td className="py-2 px-3">
                <div className="font-medium">{player.name}</div>
                <div className="text-xs text-muted-foreground">
                  Rnd {player.roundsPlayed} (−{player.roundsDropped})
                </div>
              </td>
              <td className="py-2 px-3 text-right tabular-nums">{formatHarvey(player.stablefordTotal)}</td>
              <td className="py-2 px-3 text-right tabular-nums">{formatHarvey(player.moneyTotal)}</td>
              <td className="py-2 px-3 text-right tabular-nums font-medium">{formatHarvey(player.combinedTotal)}</td>
            </tr>
          ))}
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
          <div className="flex-1 space-y-1">
            <div className="h-4 w-32 bg-muted rounded" />
            <div className="h-3 w-20 bg-muted rounded" />
          </div>
          <div className="h-4 w-8 bg-muted rounded" />
          <div className="h-4 w-8 bg-muted rounded" />
          <div className="h-4 w-8 bg-muted rounded" />
        </div>
      ))}
    </div>
  );
}
