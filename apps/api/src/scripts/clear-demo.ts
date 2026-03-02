/**
 * clear-demo.ts — Deletes all rounds in the current season and their related data.
 *
 * Run from repo root on server:
 *   DB_PATH=/data/wolf-cup.db npx tsx apps/api/scripts/clear-demo.ts
 */

import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  seasons,
  rounds,
  groups,
  roundPlayers,
  holeScores,
  wolfDecisions,
  roundResults,
  harveyResults as harveyResultsTable,
} from '../db/schema.js';

async function clearDemoData() {
  const season = await db
    .select({ id: seasons.id, name: seasons.name })
    .from(seasons)
    .orderBy(desc(seasons.startDate))
    .get();

  if (!season) {
    console.log('No season found.');
    process.exit(0);
  }
  console.log(`Clearing all round data for season: "${season.name}" (id=${season.id})`);

  const seasonRounds = await db
    .select({ id: rounds.id, scheduledDate: rounds.scheduledDate })
    .from(rounds)
    .where(eq(rounds.seasonId, season.id));

  const roundIds = seasonRounds.map(r => r.id);
  if (roundIds.length === 0) {
    console.log('No rounds found — nothing to clear.');
    process.exit(0);
  }
  console.log(`Found ${roundIds.length} round(s): ${seasonRounds.map(r => r.scheduledDate).join(', ')}`);

  const seasonGroups = await db
    .select({ id: groups.id })
    .from(groups)
    .where(inArray(groups.roundId, roundIds));
  const groupIds = seasonGroups.map(g => g.id);

  if (groupIds.length > 0) {
    await db.delete(holeScores).where(inArray(holeScores.groupId, groupIds));
    await db.delete(wolfDecisions).where(inArray(wolfDecisions.groupId, groupIds));
    await db.delete(groups).where(inArray(groups.roundId, roundIds));
  }
  await db.delete(roundResults).where(inArray(roundResults.roundId, roundIds));
  await db.delete(harveyResultsTable).where(inArray(harveyResultsTable.roundId, roundIds));
  await db.delete(roundPlayers).where(inArray(roundPlayers.roundId, roundIds));
  await db.delete(rounds).where(inArray(rounds.id, roundIds));

  console.log('✅ All round data cleared. Season and players are untouched.');
  process.exit(0);
}

clearDemoData().catch(err => {
  console.error('Clear error:', err);
  process.exit(1);
});
