/**
 * Resolve the two 2-man best-ball teams in a foursome from the ORGANIZER'S
 * intended slot order (`pairing_members.slot_number`) — NOT alphabetically.
 *
 * Teams in a foursome are a deliberate choice — ball-toss + two-closest, or an
 * A-player/B-player draw — and are NEVER alphabetical. `teamA` = slots 1 & 2,
 * `teamB` = slots 3 & 4 (the cell order the organizer set in the pairings UI).
 *
 * This is centralized so money (`money.ts`), the foursome-results detail
 * (`money-detail.ts`), and the press orchestrator (`press-orchestrator.ts`)
 * can NEVER disagree on who is partnered with whom. In 2v2 best ball the
 * partnership determines each team's best net per hole, so a disagreement
 * between those paths would be a silent money bug.
 *
 * Returns `null` when the foursome does not have exactly 4 members; callers
 * already guard on this and skip the foursome.
 */
export type FoursomeMemberSlot = { playerId: string; slotNumber: number };

export interface FoursomeTeams {
  teamA: [string, string];
  teamB: [string, string];
  /** All four playerIds in slot order (slot 1 → 4). */
  ordered: [string, string, string, string];
}

export function resolveFoursomeTeams(
  members: FoursomeMemberSlot[],
): FoursomeTeams | null {
  if (members.length !== 4) return null;
  // Order by slot number. Tie-break by playerId so a mis-seeded duplicate slot
  // is at least deterministic rather than dependent on row-arrival order.
  const ordered = [...members].sort(
    (a, b) => a.slotNumber - b.slotNumber || a.playerId.localeCompare(b.playerId),
  );
  const ids = ordered.map((m) => m.playerId) as [string, string, string, string];
  return {
    teamA: [ids[0], ids[1]],
    teamB: [ids[2], ids[3]],
    ordered: ids,
  };
}
