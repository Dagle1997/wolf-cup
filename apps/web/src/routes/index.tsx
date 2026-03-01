import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, Fragment } from 'react';
import { RefreshCw, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LeaderboardPlayer = {
  playerId: number;
  name: string;
  groupId: number;
  groupNumber: number;
  thruHole: number;
  stablefordTotal: number;
  moneyTotal: number;
  stablefordRank: number;
  moneyRank: number;
  harveyStableford: number | null;
  harveyMoney: number | null;
};

type LeaderboardResponse = {
  round: {
    id: number;
    type: 'official' | 'casual';
    status: string;
    scheduledDate: string;
    autoCalculateMoney: boolean;
  } | null;
  harveyLiveEnabled: boolean;
  sideGame: { name: string; format: string } | null;
  leaderboard: LeaderboardPlayer[];
  lastUpdated: string;
};

// ---------------------------------------------------------------------------
// Scorecard types
// ---------------------------------------------------------------------------

type ScorecardHole = {
  holeNumber: number;
  par: number;
  grossScore: number;
  netScore: number;
  stablefordPoints: number;
  moneyNet: number;
};

type ScorecardResponse = {
  playerId: number;
  playerName: string;
  groupId: number;
  autoCalculateMoney: boolean;
  holes: ScorecardHole[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(amount: number): string {
  if (amount > 0) return `+$${amount}`;
  if (amount < 0) return `-$${Math.abs(amount)}`;
  return '$0';
}

function formatThru(thruHole: number): string {
  if (thruHole === 0) return '—';
  if (thruHole === 18) return 'F';
  return `Thru ${thruHole}`;
}

function renderGolfNotation(grossScore: number, netScore: number, par: number) {
  if (netScore <= par - 2) {
    // Eagle or better: double circle
    return (
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full border-2 border-foreground">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full border-2 border-foreground text-xs font-bold">
          {grossScore}
        </span>
      </span>
    );
  }
  if (netScore === par - 1) {
    // Birdie: single circle
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-foreground text-xs font-bold">
        {grossScore}
      </span>
    );
  }
  if (netScore === par) {
    // Par: plain
    return <span className="text-xs font-medium">{grossScore}</span>;
  }
  if (netScore === par + 1) {
    // Bogey: single square
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 border-2 border-foreground text-xs font-bold">
        {grossScore}
      </span>
    );
  }
  // Double bogey or worse: double square
  return (
    <span className="inline-flex items-center justify-center w-8 h-8 border-2 border-foreground">
      <span className="inline-flex items-center justify-center w-5 h-5 border-2 border-foreground text-xs font-bold">
        {grossScore}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// ScorecardPanel — inline per-hole scorecard for a selected player
// ---------------------------------------------------------------------------

function ScorecardPanel({
  roundId,
  playerId,
  autoCalculateMoney,
}: {
  roundId: number;
  playerId: number;
  autoCalculateMoney: boolean;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['scorecard', roundId, playerId],
    queryFn: () => apiFetch<ScorecardResponse>(`/rounds/${roundId}/players/${playerId}/scorecard`),
  });

  if (isLoading) {
    return (
      <div className="p-4 text-center">
        <Loader2 className="h-4 w-4 animate-spin inline" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="p-4 text-center text-muted-foreground text-xs">Could not load scorecard</div>
    );
  }
  if (!data || data.holes.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground text-xs">No scores yet</div>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground">
          <th className="py-1 pl-3 text-left">Hole</th>
          <th className="py-1 text-center">Par</th>
          <th className="py-1 text-center">Gross</th>
          <th className="py-1 text-center">Net</th>
          <th className="py-1 text-center">Stab</th>
          {data.autoCalculateMoney && <th className="py-1 pr-3 text-right">$</th>}
        </tr>
      </thead>
      <tbody>
        {data.holes.map((hole) => (
          <tr key={hole.holeNumber} className="border-t border-muted">
            <td className="py-1 pl-3">{hole.holeNumber}</td>
            <td className="py-1 text-center">{hole.par}</td>
            <td className="py-1 text-center">
              {renderGolfNotation(hole.grossScore, hole.netScore, hole.par)}
            </td>
            <td className="py-1 text-center">{hole.netScore}</td>
            <td className="py-1 text-center">{hole.stablefordPoints}</td>
            {data.autoCalculateMoney && (
              <td className="py-1 pr-3 text-right">{formatMoney(hole.moneyNet)}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function LeaderboardPage() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => apiFetch<LeaderboardResponse>('/leaderboard/live'),
    refetchInterval: 5000,
  });

  const [secondsAgo, setSecondsAgo] = useState(0);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);

  // Derived: non-null round reference so TypeScript can narrow without ! assertions
  const currentRound = data?.round ?? null;

  // Reset scorecard selection when the active round changes (new round, round ends, etc.)
  useEffect(() => {
    setSelectedPlayerId(null);
  }, [data?.round?.id]);

  useEffect(() => {
    if (!data?.lastUpdated) return;
    setSecondsAgo(Math.floor((Date.now() - new Date(data.lastUpdated).getTime()) / 1000));
    const interval = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - new Date(data.lastUpdated).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [data?.lastUpdated]);

  return (
    <div className="p-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Live Leaderboard</h1>
        <div className="flex items-center gap-2">
          <Link to="/practice" className="text-xs text-muted-foreground hover:underline">
            Practice round
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refetch()}
            className="gap-1"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Staleness indicator */}
      {data?.lastUpdated && (
        <p className="text-xs text-muted-foreground mb-3">
          Updated {secondsAgo}s ago
        </p>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-12 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {/* Error state */}
      {isError && !isLoading && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-muted-foreground">Could not load leaderboard — tap to retry</p>
          <Button variant="outline" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      )}

      {/* No-round state */}
      {data && data.round === null && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <p className="text-muted-foreground">No official round today</p>
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <Link to="/practice">
              <Button className="w-full min-h-12">Start Practice Round</Button>
            </Link>
            <Link to="/score-entry">
              <Button variant="outline" className="w-full min-h-12">Join Official Round</Button>
            </Link>
          </div>
        </div>
      )}

      {/* Active leaderboard */}
      {data && currentRound && (
        <>
          {/* Side game banner */}
          {data.sideGame && (
            <div className="rounded-xl border bg-card p-3 mb-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Side Game
              </p>
              <p className="font-medium">{data.sideGame.name}</p>
              <p className="text-sm text-muted-foreground">{data.sideGame.format}</p>
            </div>
          )}

          {/* Leaderboard table */}
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-muted-foreground">
                  <th className="text-left py-2 px-3 w-8">#</th>
                  <th className="text-left py-2 pr-2">Player</th>
                  <th className="text-right py-2 pr-2">Stab</th>
                  <th className="text-right py-2 pr-2">Money</th>
                  {data.harveyLiveEnabled && (
                    <th className="text-right py-2 pr-2">H.Stab</th>
                  )}
                  {data.harveyLiveEnabled && (
                    <th className="text-right py-2 pr-3">H.Money</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((player) => (
                  <Fragment key={player.playerId}>
                    <tr
                      role="button"
                      aria-expanded={selectedPlayerId === player.playerId}
                      onClick={() =>
                        setSelectedPlayerId((prev) =>
                          prev === player.playerId ? null : player.playerId,
                        )
                      }
                      className={`border-b last:border-0 cursor-pointer hover:bg-muted/30 transition-colors ${selectedPlayerId === player.playerId ? 'bg-muted/20' : ''}`}
                    >
                      <td className="py-2 px-3 font-medium text-muted-foreground">
                        {player.stablefordRank}
                      </td>
                      <td className="py-2 pr-2">
                        <div className="font-medium">{player.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatThru(player.thruHole)}
                        </div>
                      </td>
                      <td className="py-2 pr-2 text-right font-medium">
                        {player.stablefordTotal}
                      </td>
                      <td className="py-2 pr-2 text-right">
                        {formatMoney(player.moneyTotal)}
                      </td>
                      {data.harveyLiveEnabled && (
                        <td className="py-2 pr-2 text-right">
                          {player.harveyStableford !== null ? player.harveyStableford : '—'}
                        </td>
                      )}
                      {data.harveyLiveEnabled && (
                        <td className="py-2 pr-3 text-right">
                          {player.harveyMoney !== null ? player.harveyMoney : '—'}
                        </td>
                      )}
                    </tr>
                    {selectedPlayerId === player.playerId && (
                      <tr className="border-b bg-muted/10">
                        <td colSpan={data.harveyLiveEnabled ? 6 : 4} className="p-0">
                          <ScorecardPanel
                            roundId={currentRound.id}
                            playerId={player.playerId}
                            autoCalculateMoney={currentRound.autoCalculateMoney}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {data.leaderboard.length === 0 && (
                  <tr>
                    <td
                      colSpan={data.harveyLiveEnabled ? 6 : 4}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No players in this round yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: LeaderboardPage,
});
