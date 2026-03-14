import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PairingsResponse = {
  round: {
    id: number;
    scheduledDate: string;
    tee: string | null;
    status: string;
    handicapUpdatedAt: number | null;
  };
  groups: {
    groupNumber: number;
    players: {
      id: number;
      name: string;
      handicapIndex: number;
      courseHandicap: number;
      isSub: boolean;
    }[];
  }[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

const TEE_COLORS: Record<string, string> = {
  blue: 'text-blue-600',
  black: 'text-gray-800 dark:text-gray-200',
  white: 'text-gray-500',
};

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/pairings/$roundId')({
  component: PairingsPage,
});

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function PairingsPage() {
  const { roundId } = Route.useParams();

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['pairings', roundId],
    queryFn: () => apiFetch<PairingsResponse>(`/pairings/${roundId}`),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-muted-foreground">Could not load pairings</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const { round, groups } = data;
  const teeLabel = round.tee ? `${round.tee.charAt(0).toUpperCase()}${round.tee.slice(1)} tees` : '';
  const teeColor = round.tee ? (TEE_COLORS[round.tee] ?? '') : '';

  return (
    <div className="p-3 max-w-2xl mx-auto pb-24">
      {/* Header */}
      <div className="text-center mb-3">
        <h1 className="text-lg font-bold tracking-tight">
          Groups — {formatDate(round.scheduledDate)}
        </h1>
        <p className="text-xs text-muted-foreground">
          {teeLabel && <span className={`font-medium ${teeColor}`}>{teeLabel}</span>}
          {round.handicapUpdatedAt && (
            <>
              {teeLabel && ' · '}
              Updated {formatTimestamp(round.handicapUpdatedAt)}
            </>
          )}
        </p>
      </div>

      {/* Groups grid — 2 columns for screenshot-friendliness */}
      <div className="grid grid-cols-2 gap-2">
        {groups.map((group) => (
          <div
            key={group.groupNumber}
            className="rounded-lg border bg-card p-2"
          >
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Group {group.groupNumber}
            </p>
            {group.players.map((player) => (
              <div
                key={player.id}
                className="flex items-center justify-between py-0.5 text-sm"
              >
                <span className={`truncate ${player.isSub ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                  {player.name}
                </span>
                <span className="font-mono text-xs text-muted-foreground ml-2 tabular-nums">
                  {player.courseHandicap}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Refresh */}
      <div className="flex justify-center mt-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() => void refetch()}
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
    </div>
  );
}
