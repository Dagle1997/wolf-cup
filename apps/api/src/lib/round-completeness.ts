import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { groups, roundPlayers, holeScores, wolfDecisions } from '../db/schema.js';

export const ALL_HOLES: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
] as const;

// Holes 1 and 3 are skins; every other hole is a wolf hole (16 total).
export const WOLF_HOLES: readonly number[] = [
  2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
] as const;

export interface GroupIncompleteness {
  groupId: number;
  groupNumber: number;
  missingScoreHoles: number[];
  missingWolfHoles: number[];
}

export interface RoundCompletenessResult {
  complete: boolean;
  totalGroups: number;
  completeGroups: number;
  incompleteGroups: GroupIncompleteness[];
}

/**
 * Determines whether a round is fully scored and (optionally) has a wolf
 * decision recorded on every wolf hole for every group.
 *
 * A group is "complete" when:
 *   - every player in the group has a hole_scores row for each hole 1..18
 *   - if `requireWolfDecisions` is true, a wolf_decisions row exists with
 *     `decision IS NOT NULL` for each of the 16 wolf holes
 *
 * The "score POST" and "wolf decision POST" are two separate client requests
 * (score-entry-hole.tsx fires the wolf POST from the score POST's onSuccess),
 * so a network blip can leave a group looking done by hole count alone while
 * the money data is still pending. Use this to gate finalize server-side.
 */
export async function checkRoundCompleteness(
  roundId: number,
  requireWolfDecisions: boolean,
): Promise<RoundCompletenessResult> {
  const groupRows = await db
    .select({ id: groups.id, groupNumber: groups.groupNumber })
    .from(groups)
    .where(eq(groups.roundId, roundId));

  if (groupRows.length === 0) {
    return { complete: false, totalGroups: 0, completeGroups: 0, incompleteGroups: [] };
  }

  const groupIds = groupRows.map((g) => g.id);

  const playerRows = await db
    .select({ groupId: roundPlayers.groupId, playerId: roundPlayers.playerId })
    .from(roundPlayers)
    .where(eq(roundPlayers.roundId, roundId));

  const playersByGroup = new Map<number, number[]>();
  for (const p of playerRows) {
    const arr = playersByGroup.get(p.groupId) ?? [];
    arr.push(p.playerId);
    playersByGroup.set(p.groupId, arr);
  }

  const scoreRows = await db
    .select({
      groupId: holeScores.groupId,
      playerId: holeScores.playerId,
      holeNumber: holeScores.holeNumber,
    })
    .from(holeScores)
    .where(inArray(holeScores.groupId, groupIds));

  const scoresByGroup = new Map<number, Set<string>>();
  for (const s of scoreRows) {
    const set = scoresByGroup.get(s.groupId) ?? new Set<string>();
    set.add(`${s.playerId}:${s.holeNumber}`);
    scoresByGroup.set(s.groupId, set);
  }

  const wolfByGroup = new Map<number, Set<number>>();
  if (requireWolfDecisions) {
    const wolfRows = await db
      .select({
        groupId: wolfDecisions.groupId,
        holeNumber: wolfDecisions.holeNumber,
        decision: wolfDecisions.decision,
      })
      .from(wolfDecisions)
      .where(inArray(wolfDecisions.groupId, groupIds));
    for (const w of wolfRows) {
      if (w.decision === null) continue;
      const set = wolfByGroup.get(w.groupId) ?? new Set<number>();
      set.add(w.holeNumber);
      wolfByGroup.set(w.groupId, set);
    }
  }

  const incompleteGroups: GroupIncompleteness[] = [];
  let completeGroups = 0;

  for (const g of groupRows) {
    const groupPlayers = playersByGroup.get(g.id) ?? [];
    const scoreSet = scoresByGroup.get(g.id) ?? new Set<string>();

    const missingScoreHoles: number[] = [];
    for (const h of ALL_HOLES) {
      if (groupPlayers.length === 0) {
        missingScoreHoles.push(h);
        continue;
      }
      for (const p of groupPlayers) {
        if (!scoreSet.has(`${p}:${h}`)) {
          missingScoreHoles.push(h);
          break;
        }
      }
    }

    const missingWolfHoles: number[] = [];
    if (requireWolfDecisions) {
      const wolfSet = wolfByGroup.get(g.id) ?? new Set<number>();
      for (const h of WOLF_HOLES) {
        if (!wolfSet.has(h)) missingWolfHoles.push(h);
      }
    }

    if (missingScoreHoles.length === 0 && missingWolfHoles.length === 0) {
      completeGroups++;
    } else {
      incompleteGroups.push({
        groupId: g.id,
        groupNumber: g.groupNumber,
        missingScoreHoles,
        missingWolfHoles,
      });
    }
  }

  return {
    complete: incompleteGroups.length === 0,
    totalGroups: groupRows.length,
    completeGroups,
    incompleteGroups,
  };
}
