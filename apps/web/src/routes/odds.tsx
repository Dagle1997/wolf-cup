import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types — match the /seasons/:year/odds response shape
// ---------------------------------------------------------------------------

type BoardRow = {
  playerId: number | null;
  name: string;
  displayName: string;
  currentOdds: number;
  openingOdds: number;
  movement: number;
  lastMovedAt: string;
  note: string | null;
  timeline: { odds: number; asOf: string; note?: string }[];
};

type Move = { name: string; from: number; to: number; asOf: string; note: string | null };

type OddsResponse = {
  year: number;
  openedAt: string;
  board: BoardRow[];
  moves: Move[];
};

// Fixed to the current season. If we add 2027+ we'll swap in a selector.
const SEASON_YEAR = 2026;

export const Route = createFileRoute('/odds')({
  component: OddsPage,
});

function formatAmericanOdds(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function MoveBadge({ movement }: { movement: number }) {
  if (movement === 0) return null;
  // movement > 0 means line lengthened (odds got longer → less likely in book's view)
  const longer = movement > 0;
  const Icon = longer ? TrendingDown : TrendingUp;
  const color = longer
    ? 'text-muted-foreground bg-muted'
    : 'text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-950/40';
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${color}`}>
      <Icon className="h-3 w-3" />
      {longer ? '+' : ''}{movement}
    </span>
  );
}

function OddsPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['odds', SEASON_YEAR],
    queryFn: () => apiFetch<OddsResponse>(`/seasons/${SEASON_YEAR}/odds`),
    staleTime: 60_000,
  });

  const noOdds = error instanceof Error && error.message === 'NO_ODDS';

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <Link
        to="/standings"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
      >
        <ChevronLeft className="h-3 w-3" />
        Standings
      </Link>

      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight">{SEASON_YEAR} Season Futures</h1>
        {data && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Opened {formatDate(data.openedAt)} · set by Jaquint · {data.board.length} entries
          </p>
        )}
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {noOdds && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="text-4xl">📋</span>
          <p className="text-sm text-muted-foreground">
            No futures odds posted for {SEASON_YEAR} yet.
          </p>
        </div>
      )}

      {isError && !noOdds && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">Could not load odds.</p>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      )}

      {data && !isError && (
        <>
          <div className="rounded-lg border overflow-hidden">
            {data.board.map((row, i) => {
              const displayName = row.displayName !== row.name ? row.displayName : row.name;
              const movedFromOpen = row.movement !== 0;
              return (
                <div
                  key={row.name + i}
                  className={`flex items-center gap-3 px-3 py-2.5 text-sm ${
                    i < data.board.length - 1 ? 'border-b' : ''
                  }`}
                >
                  <span className="w-5 text-xs text-muted-foreground text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{displayName}</div>
                    {row.note && (
                      <div className="text-[10px] text-muted-foreground truncate">{row.note}</div>
                    )}
                  </div>
                  {movedFromOpen && (
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      open {formatAmericanOdds(row.openingOdds)}
                    </span>
                  )}
                  <MoveBadge movement={row.movement} />
                  <span className="font-bold tabular-nums w-14 text-right">
                    {formatAmericanOdds(row.currentOdds)}
                  </span>
                </div>
              );
            })}
          </div>

          {data.moves.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold mb-2">Line Moves</h2>
              <div className="rounded-lg border divide-y">
                {data.moves.map((m, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">{m.name}</span>
                      {m.note && <span className="text-muted-foreground"> · {m.note}</span>}
                    </div>
                    <span className="text-muted-foreground tabular-nums">
                      {formatAmericanOdds(m.from)} → {formatAmericanOdds(m.to)}
                    </span>
                    <span className="text-muted-foreground w-14 text-right">
                      {formatDate(m.asOf)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground mt-4 text-center">
            For entertainment only. No actual wagering. Juice is what it is.
          </p>
        </>
      )}
    </div>
  );
}
