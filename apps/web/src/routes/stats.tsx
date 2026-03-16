import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
};

type StatsResponse = {
  players: PlayerStats[];
  lastUpdated: string;
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

function StatsPage() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['stats'],
    queryFn: () => apiFetch<StatsResponse>('/stats'),
  });

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold tracking-tight">Player Statistics</h2>
        <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching} className="h-8 px-2">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

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
              {data.players.map((p, i) => (
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
  const moneyColor = p.totalMoney > 0
    ? 'text-green-600'
    : p.totalMoney < 0
      ? 'text-destructive'
      : '';

  return (
    <div className="rounded-xl border overflow-hidden shadow-sm">
      {/* Header — player name + total money */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-bold text-muted-foreground w-5 text-center">{rank}</span>
          <span className="font-semibold">{p.name}</span>
        </div>
        <span className={`text-base font-bold tabular-nums ${moneyColor}`}>
          {formatMoney(p.totalMoney)}
        </span>
      </div>

      {/* Stats grid — 2 rows of data */}
      <div className="px-4 py-3">
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
