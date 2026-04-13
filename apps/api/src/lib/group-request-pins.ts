import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { seasonWeeks, attendance } from '../db/schema.js';

export interface GroupRequestPinsResult {
  pins: Map<number, number>;
  warnings: string[];
  honoredRequests: { playerId: number; groupNumber: number }[];
}

/**
 * Read attendance.group_request for the matching season_week and translate
 * 'first' / 'last' into 0-based group indices, with first-click-wins
 * overflow when more than groupSize players request the same position.
 *
 * Non-fatal on lookup failure — returns empty pins and the caller proceeds
 * without per-week preferences.
 */
export async function buildGroupRequestPins(args: {
  seasonId: number;
  scheduledDate: string;
  playerIds: readonly number[];
  groupSize?: number;
}): Promise<GroupRequestPinsResult> {
  const { seasonId, scheduledDate, playerIds, groupSize = 4 } = args;
  const numGroups = Math.floor(playerIds.length / groupSize);
  const pins = new Map<number, number>();
  const warnings: string[] = [];

  if (numGroups === 0) {
    return { pins, warnings, honoredRequests: [] };
  }

  try {
    const week = await db
      .select({ id: seasonWeeks.id })
      .from(seasonWeeks)
      .where(and(eq(seasonWeeks.seasonId, seasonId), eq(seasonWeeks.friday, scheduledDate)))
      .get();

    if (!week) return { pins, warnings, honoredRequests: [] };

    const rows = await db
      .select({
        playerId: attendance.playerId,
        groupRequest: attendance.groupRequest,
        groupRequestAt: attendance.groupRequestAt,
      })
      .from(attendance)
      .where(eq(attendance.seasonWeekId, week.id));

    const pidSet = new Set(playerIds);
    type Req = { playerId: number; at: number };
    const firsts: Req[] = [];
    const lasts: Req[] = [];
    for (const r of rows) {
      if (!pidSet.has(r.playerId)) continue;
      const at = r.groupRequestAt ?? Number.MAX_SAFE_INTEGER;
      if (r.groupRequest === 'first') firsts.push({ playerId: r.playerId, at });
      else if (r.groupRequest === 'last') lasts.push({ playerId: r.playerId, at });
    }

    firsts.sort((a, b) => a.at - b.at);
    lasts.sort((a, b) => a.at - b.at);

    const pinnedCount = new Array<number>(numGroups).fill(0);

    let firstPreferred = 0;
    let firstBumped = 0;
    for (const req of firsts) {
      let g = 0;
      while (g < numGroups && pinnedCount[g]! >= groupSize) g++;
      if (g >= numGroups) break;
      pins.set(req.playerId, g);
      pinnedCount[g]!++;
      if (g === 0) firstPreferred++;
      else firstBumped++;
    }

    const lastIdx = numGroups - 1;
    let lastPreferred = 0;
    let lastBumped = 0;
    for (const req of lasts) {
      let g = lastIdx;
      while (g >= 0 && pinnedCount[g]! >= groupSize) g--;
      if (g < 0) break;
      pins.set(req.playerId, g);
      pinnedCount[g]!++;
      if (g === lastIdx) lastPreferred++;
      else lastBumped++;
    }

    if (firstBumped > 0) {
      warnings.push(
        `${firsts.length} players requested First group — ${firstPreferred} honored in Group 1, ${firstBumped} moved to the next available group`,
      );
    }
    if (lastBumped > 0) {
      warnings.push(
        `${lasts.length} players requested Last group — ${lastPreferred} honored in Group ${numGroups}, ${lastBumped} moved to the next available group`,
      );
    }
  } catch {
    // Non-fatal — caller falls through with empty pins
    return { pins: new Map(), warnings: [], honoredRequests: [] };
  }

  const honoredRequests = [...pins.entries()].map(([playerId, groupIdx]) => ({
    playerId,
    groupNumber: groupIdx + 1,
  }));

  return { pins, warnings, honoredRequests };
}
