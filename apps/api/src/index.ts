import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { and, eq, inArray, lt } from 'drizzle-orm';
import type { Variables } from './types.js';
import { db } from './db/index.js';
import { rounds, groups, roundPlayers, holeScores, wolfDecisions, roundResults, players } from './db/schema.js';
import publicRoundsRouter from './routes/rounds.js';
import leaderboardRouter from './routes/leaderboard.js';
import standingsRouter from './routes/standings.js';
import statsRouter from './routes/stats.js';
import adminAuthRouter from './routes/admin/auth.js';
import adminRosterRouter from './routes/admin/roster.js';
import adminSeasonRouter from './routes/admin/season.js';
import adminRoundsRouter from './routes/admin/rounds.js';
import adminSideGamesRouter from './routes/admin/side-games.js';
import adminScoreCorrectionsRouter from './routes/admin/score-corrections.js';
import adminGhinRouter from './routes/admin/ghin.js';
import adminPairingRouter from './routes/admin/pairing.js';
import adminAttendanceRouter from './routes/admin/attendance.js';
import adminHistoryRouter from './routes/admin/history.js';
import attendanceRouter from './routes/attendance.js';
import historyRouter from './routes/history.js';
import pairingsRouter from './routes/pairings.js';
import galleryRouter from './routes/gallery.js';
import cron from 'node-cron';
import { ghinClient } from './lib/ghin-client.js';
import { roundPlayers as roundPlayersTable } from './db/schema.js';
import { eq as eqOp, and as andOp } from 'drizzle-orm';

export const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// Health check — public, no auth required
// ---------------------------------------------------------------------------

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Version stamp — clients poll this to detect new deploys and prompt refresh.
const STARTUP_TIME = Date.now();
app.get('/api/version', (c) => c.json({ version: STARTUP_TIME }));

// ---------------------------------------------------------------------------
// Public rounds routes
// ---------------------------------------------------------------------------

app.route('/api', publicRoundsRouter);
app.route('/api', leaderboardRouter);
app.route('/api', standingsRouter);
app.route('/api', statsRouter);
app.route('/api', attendanceRouter);
app.route('/api', pairingsRouter);
app.route('/api', historyRouter);
app.route('/api', galleryRouter);

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------

app.route('/api/admin', adminAuthRouter);
app.route('/api/admin', adminRosterRouter);
app.route('/api/admin', adminSeasonRouter);
app.route('/api/admin', adminRoundsRouter);
app.route('/api/admin', adminSideGamesRouter);
app.route('/api/admin', adminScoreCorrectionsRouter);
app.route('/api/admin', adminGhinRouter);
app.route('/api/admin', adminPairingRouter);
app.route('/api/admin', adminAttendanceRouter);
app.route('/api/admin/history', adminHistoryRouter);

// ---------------------------------------------------------------------------
// Startup cleanup — delete cancelled casual rounds older than 24 hours
// ---------------------------------------------------------------------------

async function cleanupCancelledRounds(): Promise<void> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  try {
    const staleRounds = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(eq(rounds.type, 'casual'), eq(rounds.status, 'cancelled'), lt(rounds.createdAt, cutoff)));

    if (staleRounds.length === 0) return;

    const roundIds = staleRounds.map((r) => r.id);

    await db.transaction(async (tx) => {
      // Find guest player IDs before deleting round_players
      const guestPlayerRows = await tx
        .select({ playerId: roundPlayers.playerId })
        .from(roundPlayers)
        .innerJoin(players, and(eq(roundPlayers.playerId, players.id), eq(players.isGuest, 1)))
        .where(inArray(roundPlayers.roundId, roundIds));
      const guestIds = guestPlayerRows.map((r) => r.playerId);

      await tx.delete(holeScores).where(inArray(holeScores.roundId, roundIds));
      await tx.delete(wolfDecisions).where(inArray(wolfDecisions.roundId, roundIds));
      await tx.delete(roundResults).where(inArray(roundResults.roundId, roundIds));
      await tx.delete(roundPlayers).where(inArray(roundPlayers.roundId, roundIds));
      await tx.delete(groups).where(inArray(groups.roundId, roundIds));
      await tx.delete(rounds).where(inArray(rounds.id, roundIds));

      // Clean up guest players with no remaining round entries
      if (guestIds.length > 0) {
        const stillUsed = await tx
          .select({ playerId: roundPlayers.playerId })
          .from(roundPlayers)
          .where(inArray(roundPlayers.playerId, guestIds));
        const stillUsedIds = new Set(stillUsed.map((r) => r.playerId));
        const orphanIds = guestIds.filter((id) => !stillUsedIds.has(id));
        if (orphanIds.length > 0) {
          await tx.delete(players).where(inArray(players.id, orphanIds));
        }
      }
    });

    console.log(`Cleaned up ${roundIds.length} stale cancelled practice round(s)`);
  } catch (err) {
    console.error('Cleanup failed (non-fatal):', err);
  }
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const port = Number(process.env['PORT'] ?? 3000);

// ---------------------------------------------------------------------------
// Friday 6am ET auto-refresh handicaps for today's scheduled round
// ---------------------------------------------------------------------------

async function autoRefreshHandicaps(): Promise<void> {
  if (!ghinClient) {
    console.log('GHIN not configured — skipping auto-refresh');
    return;
  }

  try {
    const today = new Date().toISOString().slice(0, 10);

    // Find today's scheduled official round
    const round = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(andOp(eqOp(rounds.scheduledDate, today), eqOp(rounds.type, 'official'), eqOp(rounds.status, 'scheduled')))
      .get();

    if (!round) {
      console.log(`No scheduled round for ${today} — skipping auto-refresh`);
      return;
    }

    // Get round players with GHIN numbers
    const rps = await db
      .select({ rpId: roundPlayersTable.id, playerId: roundPlayersTable.playerId, ghinNumber: players.ghinNumber })
      .from(roundPlayersTable)
      .innerJoin(players, eqOp(roundPlayersTable.playerId, players.id))
      .where(eqOp(roundPlayersTable.roundId, round.id));

    let refreshed = 0;
    for (const rp of rps) {
      if (!rp.ghinNumber) continue;
      try {
        const { handicapIndex } = await ghinClient.getHandicap(Number(rp.ghinNumber));
        if (handicapIndex !== null) {
          await db.update(players).set({ handicapIndex }).where(eqOp(players.id, rp.playerId));
          await db.update(roundPlayersTable).set({ handicapIndex }).where(eqOp(roundPlayersTable.id, rp.rpId));
          refreshed++;
        }
      } catch {
        // Individual player failure — continue with others
      }
    }

    await db.update(rounds).set({ handicapUpdatedAt: Date.now() }).where(eqOp(rounds.id, round.id));
    console.log(`Auto-refreshed ${refreshed}/${rps.length} handicaps for round ${round.id}`);
  } catch (err) {
    console.error('Auto-refresh failed (non-fatal):', err);
  }
}

serve({ fetch: app.fetch, port }, async () => {
  console.log(`Wolf Cup API listening on port ${port}`);
  await cleanupCancelledRounds();

  // Schedule Friday 6am ET auto-refresh
  cron.schedule('0 6 * * 5', () => {
    void autoRefreshHandicaps();
  }, { timezone: 'America/New_York' });
  console.log('Scheduled Friday 6am ET handicap auto-refresh');
});
