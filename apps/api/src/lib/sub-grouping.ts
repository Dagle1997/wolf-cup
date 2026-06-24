import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { seasonWeeks, attendance, subBench } from '../db/schema.js';

export interface SubGroupingInputs {
  /** Player IDs that are subs this season (∩ the round's players). */
  subIds: Set<number>;
  /**
   * Hard keep-together links `[playerId, sponsorPlayerId]` from the week's
   * "play-with" requests, restricted to pairs where BOTH are in `playerIds`.
   */
  links: Array<[number, number]>;
}

/**
 * Build the sub-aware inputs for the pairing engine for one round:
 *   - `subIds`  — season sub-bench members who are playing this round (drives
 *                 the soft one-sub-per-group spreading).
 *   - `links`   — per-week "play-with sponsor" requests (attendance
 *                 .play_with_player_id), kept only when both the requester and
 *                 the sponsor are in `playerIds` (drives the hard keep-together
 *                 contraction). A request naming an absent sponsor is dropped.
 *
 * Non-fatal on lookup failure — returns empty inputs so the caller still pairs
 * (just without sub awareness), mirroring buildGroupRequestPins.
 */
export async function buildSubGroupingInputs(args: {
  seasonId: number;
  scheduledDate: string;
  playerIds: readonly number[];
}): Promise<SubGroupingInputs> {
  const { seasonId, scheduledDate, playerIds } = args;
  const pidSet = new Set(playerIds);
  const subIds = new Set<number>();
  const links: Array<[number, number]> = [];

  try {
    // Subs: season-scoped bench, intersected with this round's players.
    const subRows = await db
      .select({ playerId: subBench.playerId })
      .from(subBench)
      .where(eq(subBench.seasonId, seasonId));
    for (const s of subRows) {
      if (pidSet.has(s.playerId)) subIds.add(s.playerId);
    }

    // Links: this week's play-with requests.
    const week = await db
      .select({ id: seasonWeeks.id })
      .from(seasonWeeks)
      .where(and(eq(seasonWeeks.seasonId, seasonId), eq(seasonWeeks.friday, scheduledDate)))
      .get();

    if (week) {
      const rows = await db
        .select({
          playerId: attendance.playerId,
          status: attendance.status,
          playWithPlayerId: attendance.playWithPlayerId,
        })
        .from(attendance)
        .where(eq(attendance.seasonWeekId, week.id));

      // Status guard makes the link semantics self-contained (honored only when
      // BOTH are confirmed in), independent of how the caller built playerIds.
      const statusMap = new Map(rows.map((r) => [r.playerId, r.status]));
      for (const r of rows) {
        const sponsor = r.playWithPlayerId;
        if (sponsor == null) continue;
        if (sponsor === r.playerId) continue; // self-link is a no-op
        if (!pidSet.has(r.playerId) || !pidSet.has(sponsor)) continue;
        if (statusMap.get(r.playerId) !== 'in' || statusMap.get(sponsor) !== 'in') continue;
        links.push([r.playerId, sponsor]);
      }
    }
  } catch {
    // Non-fatal — caller falls through with whatever was gathered.
    return { subIds, links };
  }

  return { subIds, links };
}
