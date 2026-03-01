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
  wolfCallsAlone: number;
  wolfCallsPartner: number;
  wolfWins: number;
  wolfLosses: number;
  wolfPushes: number;
  netBirdies: number;
  netEagles: number;
  greenies: number;
  polies: number;
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
  return `${p.wolfWins}−${p.wolfLosses}−${p.wolfPushes}`;
}

function formatMoney(n: number): string {
  if (n === 0) return '$0';
  return n > 0 ? `+$${n}` : `−$${Math.abs(n)}`;
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
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Player Statistics</h2>
        <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
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
            <p className="text-muted-foreground">No statistics available yet.</p>
          ) : (
            <StatsTable players={data.players} />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatsTable({ players }: { players: PlayerStats[] }) {
  return (
    <div className="rounded-md border overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
            <th className="py-2 px-2 text-left font-medium">Player</th>
            <th className="py-2 px-2 text-center font-medium">
              Wolf
              <br />
              <span className="font-normal">W-L-P</span>
            </th>
            <th className="py-2 px-2 text-center font-medium">Alone</th>
            <th className="py-2 px-2 text-center font-medium">Partner</th>
            <th className="py-2 px-2 text-center font-medium">Birdies</th>
            <th className="py-2 px-2 text-center font-medium">Eagles</th>
            <th className="py-2 px-2 text-center font-medium">Greenies</th>
            <th className="py-2 px-2 text-center font-medium">Polies</th>
            <th className="py-2 px-2 text-right font-medium">Best $</th>
            <th className="py-2 px-2 text-right font-medium">Worst $</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.playerId} className="border-b last:border-0">
              <td className="py-2 px-2 font-medium">{p.name}</td>
              <td className="py-2 px-2 text-center tabular-nums">{wolfRecord(p)}</td>
              <td className="py-2 px-2 text-center tabular-nums">{p.wolfCallsAlone}</td>
              <td className="py-2 px-2 text-center tabular-nums">{p.wolfCallsPartner}</td>
              <td className="py-2 px-2 text-center tabular-nums">{p.netBirdies}</td>
              <td className="py-2 px-2 text-center tabular-nums">{p.netEagles}</td>
              <td className="py-2 px-2 text-center tabular-nums">{p.greenies}</td>
              <td className="py-2 px-2 text-center tabular-nums">{p.polies}</td>
              <td className="py-2 px-2 text-right tabular-nums text-green-600">
                {formatMoney(p.biggestRoundWin)}
              </td>
              <td className="py-2 px-2 text-right tabular-nums text-destructive">
                {formatMoney(p.biggestRoundLoss)}
              </td>
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
          <div className="h-4 w-24 bg-muted rounded" />
          <div className="flex-1 flex gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((j) => (
              <div key={j} className="h-4 w-8 bg-muted rounded" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
