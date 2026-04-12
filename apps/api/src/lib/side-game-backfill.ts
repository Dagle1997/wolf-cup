import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sideGames } from '../db/schema.js';

/**
 * After creating an official round, append its id to any side_game in the
 * same season whose scheduledFridays contains the round's scheduledDate.
 * Non-fatal: any error is swallowed so round creation never fails for this.
 */
export async function backfillSideGameRoundId(
  roundId: number,
  seasonId: number,
  scheduledDate: string,
): Promise<void> {
  try {
    const games = await db
      .select({
        id: sideGames.id,
        scheduledFridays: sideGames.scheduledFridays,
        scheduledRoundIds: sideGames.scheduledRoundIds,
      })
      .from(sideGames)
      .where(eq(sideGames.seasonId, seasonId));

    for (const g of games) {
      let fridays: string[];
      try {
        fridays = JSON.parse(g.scheduledFridays ?? '[]') as string[];
      } catch { continue; }
      if (!fridays.includes(scheduledDate)) continue;

      let ids: number[];
      try {
        ids = JSON.parse(g.scheduledRoundIds ?? '[]') as number[];
      } catch { ids = []; }
      if (ids.includes(roundId)) continue;
      ids.push(roundId);

      await db
        .update(sideGames)
        .set({ scheduledRoundIds: JSON.stringify(ids) })
        .where(eq(sideGames.id, g.id));
    }
  } catch { /* non-fatal */ }
}
