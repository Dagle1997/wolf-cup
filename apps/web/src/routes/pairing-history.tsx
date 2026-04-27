import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, useEffect } from 'react';
import { AlertCircle, ChevronLeft, Loader2, RefreshCw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types — mirror the /api/pairing-history shape
// ---------------------------------------------------------------------------

type SeasonRef = { id: number; name: string; year: number };

type PairingHistoryResponse = {
  seasons: SeasonRef[];
  season: SeasonRef | null;
  players: { id: number; name: string }[];
  pairs: { playerAId: number; playerBId: number; pairCount: number }[];
};

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/pairing-history')({
  component: PairingHistoryPage,
});

function PairingHistoryPage() {
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);

  const queryKey = useMemo(
    () => ['pairing-history', seasonId] as const,
    [seasonId],
  );
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      apiFetch<PairingHistoryResponse>(
        seasonId ? `/pairing-history?seasonId=${seasonId}` : '/pairing-history',
      ),
  });

  // Default the season picker to whatever the API resolved (the latest season),
  // and default the player picker to the first player in the season.
  useEffect(() => {
    if (data?.season && seasonId === null) setSeasonId(data.season.id);
  }, [data, seasonId]);
  useEffect(() => {
    if (data && data.players.length > 0) {
      const stillValid = data.players.some((p) => p.id === selectedPlayerId);
      if (!stillValid) setSelectedPlayerId(data.players[0]!.id);
    } else if (data && data.players.length === 0) {
      setSelectedPlayerId(null);
    }
  }, [data, selectedPlayerId]);

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
          <p className="text-muted-foreground">Could not load pairing history</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Build a lookup of (playerId → list of {otherId, count}) from the
  // canonical-ordered pairs (lower id first). Each pair contributes once to
  // each side of the relationship.
  const countsForSelected = (() => {
    if (selectedPlayerId === null) return [];
    const out: { otherId: number; count: number }[] = [];
    for (const row of data.pairs) {
      if (row.playerAId === selectedPlayerId) {
        out.push({ otherId: row.playerBId, count: row.pairCount });
      } else if (row.playerBId === selectedPlayerId) {
        out.push({ otherId: row.playerAId, count: row.pairCount });
      }
    }
    return out;
  })();

  const playerNameById = new Map(data.players.map((p) => [p.id, p.name]));

  // Sort: count desc, then name asc for ties.
  const sortedRows = [...countsForSelected].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const an = playerNameById.get(a.otherId) ?? '';
    const bn = playerNameById.get(b.otherId) ?? '';
    return an.localeCompare(bn);
  });

  // Pre-2026 historical seasons have no group-level pairing data.
  const isPre2026 = data.season ? data.season.year < 2026 : false;
  const hasAnyData = data.pairs.length > 0;

  return (
    <div className="p-4 max-w-2xl mx-auto pb-16">
      {/* Back link */}
      <Link
        to="/stats"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
      >
        <ChevronLeft className="w-3 h-3" />
        Stats
      </Link>

      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            Pairing History
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            How often each player has been grouped together this season — proves the algorithm is fair.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Season picker — shown only if more than one season exists */}
      {data.seasons.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {data.seasons.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSeasonId(s.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                (data.season?.id ?? seasonId) === s.id
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {s.year}
            </button>
          ))}
        </div>
      )}

      {/* Empty states */}
      {isPre2026 && (
        <div className="rounded-lg border bg-muted/30 px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            Group-level pairing data available from 2026 season onward.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Historical rounds (2022–2025) were imported without group records.
          </p>
        </div>
      )}

      {!isPre2026 && !hasAnyData && (
        <div className="rounded-lg border bg-muted/30 px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            No pairing data yet for this season.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Counts populate as official rounds are finalized.
          </p>
        </div>
      )}

      {!isPre2026 && hasAnyData && (
        <>
          {/* Player picker */}
          <div className="mb-3">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
              Show pairings for
            </label>
            <select
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              value={selectedPlayerId ?? ''}
              onChange={(e) => setSelectedPlayerId(Number(e.target.value))}
            >
              {data.players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Counts list */}
          {sortedRows.length === 0 ? (
            <div className="rounded-lg border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              No groupings recorded yet for this player.
            </div>
          ) : (
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-muted/40 border-b">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Player
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Times Together
                </span>
              </div>
              <div className="divide-y">
                {sortedRows.map((row) => {
                  const name = playerNameById.get(row.otherId) ?? `#${row.otherId}`;
                  return (
                    <div
                      key={row.otherId}
                      className="flex items-center justify-between px-4 py-2.5 text-sm"
                    >
                      <span className="font-medium">{name}</span>
                      <span className="font-mono tabular-nums text-foreground">
                        {row.count}x
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/70 mt-3 text-center">
            Counts include only finalized official rounds. Cancelled, practice, and hidden rounds are excluded.
          </p>
        </>
      )}
    </div>
  );
}
