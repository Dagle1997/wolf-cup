// Closest-to-Pin (CTP) per-par-3 winner resolution.
//
// Current-winner rule (from tech-spec-ctp-per-par3-prompt.md Revision 2):
// for each par-3 hole, the "current winner" is the entry with MAX(holeCompletedAt)
// across all groups for that hole WHERE winnerPlayerId is non-null.
// Ties are broken by MAX(groupId).
//
// holeCompletedAt is a server-captured timestamp of the moment the last roster
// score for (round, group, hole) landed — NOT the CTP entry's own updatedAt,
// which would incorrectly put offline-drained entries ahead of online entries
// that played later.

export const PAR3_HOLES: readonly [6, 7, 12, 15] = [6, 7, 12, 15] as const;
export type Par3Hole = (typeof PAR3_HOLES)[number];

export type CtpEntry = {
  id: number;
  roundId: number;
  groupId: number;
  holeNumber: number;
  winnerPlayerId: number | null;
  winnerName: string | null;
  holeCompletedAt: number;
};

export type CtpWinner = {
  playerId: number;
  playerName: string;
  groupId: number;
  holeCompletedAt: number;
};

export type CtpWinnersByHole = Record<Par3Hole, CtpWinner | null>;

export function isPar3Hole(hole: number): hole is Par3Hole {
  return PAR3_HOLES.includes(hole as Par3Hole);
}

export function resolvePerHoleWinners(entries: readonly CtpEntry[]): CtpWinnersByHole {
  const result: CtpWinnersByHole = {
    6: null,
    7: null,
    12: null,
    15: null,
  };

  for (const hole of PAR3_HOLES) {
    const claims = entries.filter(
      (e) => e.holeNumber === hole && e.winnerPlayerId !== null,
    );
    if (claims.length === 0) continue;

    // MAX(holeCompletedAt), ties broken by MAX(groupId).
    let best = claims[0]!;
    for (let i = 1; i < claims.length; i++) {
      const c = claims[i]!;
      if (
        c.holeCompletedAt > best.holeCompletedAt ||
        (c.holeCompletedAt === best.holeCompletedAt && c.groupId > best.groupId)
      ) {
        best = c;
      }
    }

    result[hole] = {
      playerId: best.winnerPlayerId!,
      playerName: best.winnerName ?? 'Unknown',
      groupId: best.groupId,
      holeCompletedAt: best.holeCompletedAt,
    };
  }

  return result;
}

// Given winners-by-hole, return a map of playerId → list of par-3 holes won.
// Used by the round-level Par 3 Champion highlight and season stat.
export function tallyByPlayer(
  winnersByHole: CtpWinnersByHole,
): Map<number, { playerName: string; holes: Par3Hole[] }> {
  const tally = new Map<number, { playerName: string; holes: Par3Hole[] }>();
  for (const hole of PAR3_HOLES) {
    const w = winnersByHole[hole];
    if (!w) continue;
    const existing = tally.get(w.playerId);
    if (existing) {
      existing.holes.push(hole);
    } else {
      tally.set(w.playerId, { playerName: w.playerName, holes: [hole] });
    }
  }
  return tally;
}
