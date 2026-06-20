import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { nameWithInitial } from '@/lib/names';

// Matches server response from GET /rounds/:id/ctp-entries.
type CtpEntry = {
  id: number;
  roundId: number;
  groupId: number;
  holeNumber: number;
  winnerPlayerId: number | null;
  winnerName: string | null;
  holeCompletedAt: number;
  finalizedAt: number | null;
  updatedAt: number;
};

type CtpWinner = {
  playerId: number;
  playerName: string;
  groupId: number;
  holeCompletedAt: number;
};

type CtpEntriesResponse = {
  entries: CtpEntry[];
  currentWinners: Record<string, CtpWinner | null>;
};

type Props = {
  roundId: number;
  // Server-provided label (from sideGames.name). Respecting this means an
  // admin rename of the side game is reflected in the card header.
  name: string;
  format: string;
  // 'scheduled' | 'active' | 'finalized' | 'cancelled' | 'completed'.
  // We stop polling on terminal states.
  roundStatus: string;
};

const PAR3_HOLES: readonly [6, 7, 12, 15] = [6, 7, 12, 15] as const;

export function CtpSideGameCard({ roundId, name, format, roundStatus }: Props) {
  const isTerminal =
    roundStatus === 'finalized' ||
    roundStatus === 'cancelled' ||
    roundStatus === 'completed';

  const { data, isLoading, isError } = useQuery({
    queryKey: ['ctp-entries', roundId],
    queryFn: () => apiFetch<CtpEntriesResponse>(`/rounds/${roundId}/ctp-entries`),
    // Poll while the round is active so other groups' entries surface live.
    // Once terminal (finalized / completed / cancelled), CTP entries are
    // either locked or no longer meaningful — no point polling.
    refetchInterval: isTerminal ? false : 5000,
    staleTime: 0,
  });

  const winners = data?.currentWinners;
  const claimedCount = winners
    ? PAR3_HOLES.filter((h) => winners[String(h)] != null).length
    : 0;

  return (
    <div className="rounded-xl border bg-card p-3 mb-3">
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
          Side Game{isTerminal ? ' — Final' : ''}
        </p>
        {!isTerminal && winners && (
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {claimedCount}/4 claimed
          </p>
        )}
      </div>
      <p className="font-semibold">🎯 {name}</p>
      <p className="text-xs text-muted-foreground mb-2">{format}</p>

      {/* Only surface error when we have nothing cached to show. Once winners
          have loaded at least once, a background-refetch failure shouldn't
          flash an error over live data — the next poll (or next render on
          recovery) will refresh. Terminal rounds don't retry; the copy
          reflects that. */}
      {isError && !winners && (
        <p className="text-xs text-destructive mb-2" role="alert">
          {isTerminal
            ? "Couldn't load CTP state — try refreshing."
            : "Couldn't load CTP state — will retry."}
        </p>
      )}

      {/* 2-col on narrow phones (≤360px), 4-col from sm up. Always shows the
          last initial ("Matt J.") — the league has several shared first names,
          so first-name-only is ambiguous. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
        {PAR3_HOLES.map((hole) => {
          const w = winners?.[String(hole)];
          return (
            <div
              key={hole}
              className="rounded-lg bg-muted p-2 text-center"
            >
              <p className="text-[10px] text-muted-foreground">Hole {hole}</p>
              {isLoading && !winners ? (
                <p className="text-sm text-muted-foreground">…</p>
              ) : w ? (
                <p
                  className="text-sm font-semibold truncate"
                  title={w.playerName}
                >
                  {nameWithInitial(w.playerName)}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
