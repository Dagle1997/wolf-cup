import { Hono } from 'hono';
import { eq, and, inArray, countDistinct, count } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  seasons,
  seasonWeeks,
  rounds,
  groups,
  roundPlayers,
  holeScores,
  roundResults,
  harveyResults,
  wolfDecisions,
  scoreCorrections,
  sideGames,
  sideGameResults,
  pairingHistory,
  attendance,
  subBench,
} from '../../db/schema.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import {
  createSeasonSchema,
  updateSeasonSchema,
  toggleWeekSchema,
} from '../../schemas/season.js';
import { getFridaysInRange } from '../../utils/fridays.js';
import { calculateTeeRotation } from '../../utils/tee-rotation.js';
import { calculateSideGameRotation } from '../../utils/side-game-rotation.js';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// GET /seasons — list all seasons
// ---------------------------------------------------------------------------

app.get('/seasons', adminAuthMiddleware, async (c) => {
  try {
    const allSeasons = await db.select().from(seasons).orderBy(seasons.id);
    return c.json({ items: allSeasons }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /seasons — create a season
// ---------------------------------------------------------------------------

app.post('/seasons', adminAuthMiddleware, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] },
      400,
    );
  }

  const result = createSeasonSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  // Zod already validated both dates are Fridays and start <= end
  const fridays = getFridaysInRange(result.data.startDate, result.data.endDate);

  try {
    const now = Date.now();
    const txResult = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(seasons)
        .values({
          name: result.data.name,
          year: Number(result.data.startDate.slice(0, 4)),
          startDate: result.data.startDate,
          endDate: result.data.endDate,
          playoffFormat: result.data.playoffFormat,
          harveyLiveEnabled: result.data.harveyLiveEnabled ? 1 : 0,
          totalRounds: fridays.length,
          createdAt: now,
        })
        .returning();

      const season = inserted[0];
      if (!season) throw new Error('Insert failed');

      // All weeks start active — calculate tees upfront for single INSERT
      const teeCycle = ['blue', 'black', 'white'] as const;
      const weekRows = fridays.map((friday, i) => ({
        seasonId: season.id,
        friday,
        isActive: 1 as const,
        tee: teeCycle[i % 3]!,
        createdAt: now,
      }));

      const weeks = await tx.insert(seasonWeeks).values(weekRows).returning();

      return { season, weeks };
    });

    return c.json(
      {
        season: txResult.season,
        weeks: txResult.weeks,
        totalFridays: txResult.weeks.length,
      },
      201,
    );
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// PATCH /seasons/:id — update a season
// ---------------------------------------------------------------------------

app.patch('/seasons/:id', adminAuthMiddleware, async (c) => {
  const idParam = c.req.param('id');
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] },
      400,
    );
  }

  const result = updateSeasonSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  let existing: { id: number } | undefined;
  try {
    existing = await db
      .select({ id: seasons.id })
      .from(seasons)
      .where(eq(seasons.id, id))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!existing) {
    return c.json({ error: 'Season not found', code: 'NOT_FOUND' }, 404);
  }

  const updates: Partial<typeof seasons.$inferInsert> = {};
  if (result.data.name !== undefined) updates.name = result.data.name;
  if (result.data.startDate !== undefined) updates.startDate = result.data.startDate;
  if (result.data.endDate !== undefined) updates.endDate = result.data.endDate;
  if (result.data.totalRounds !== undefined) updates.totalRounds = result.data.totalRounds;
  if (result.data.playoffFormat !== undefined) updates.playoffFormat = result.data.playoffFormat;
  if (result.data.harveyLiveEnabled !== undefined) updates.harveyLiveEnabled = result.data.harveyLiveEnabled ? 1 : 0;

  try {
    const updated = await db
      .update(seasons)
      .set(updates)
      .where(eq(seasons.id, id))
      .returning();

    const season = updated[0];
    if (!season) {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    return c.json({ season }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /seasons/:seasonId/weeks — list all weeks for a season
// ---------------------------------------------------------------------------

app.get('/seasons/:seasonId/weeks', adminAuthMiddleware, async (c) => {
  const seasonId = Number(c.req.param('seasonId'));
  if (!Number.isInteger(seasonId) || seasonId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  try {
    const season = await db
      .select({ id: seasons.id })
      .from(seasons)
      .where(eq(seasons.id, seasonId))
      .get();

    if (!season) {
      return c.json({ error: 'Season not found', code: 'NOT_FOUND' }, 404);
    }

    const weeks = await db
      .select()
      .from(seasonWeeks)
      .where(eq(seasonWeeks.seasonId, seasonId))
      .orderBy(seasonWeeks.friday);

    const items = weeks.map((w, i) => ({
      ...w,
      weekNumber: i + 1,
    }));

    const activeRounds = weeks.filter((w) => w.isActive === 1).length;

    return c.json(
      { items, totalFridays: weeks.length, activeRounds },
      200,
    );
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// PATCH /seasons/:seasonId/weeks/:weekId — toggle week active/inactive
// ---------------------------------------------------------------------------

app.patch('/seasons/:seasonId/weeks/:weekId', adminAuthMiddleware, async (c) => {
  const seasonId = Number(c.req.param('seasonId'));
  const weekId = Number(c.req.param('weekId'));
  if (!Number.isInteger(seasonId) || seasonId <= 0 || !Number.isInteger(weekId) || weekId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] },
      400,
    );
  }

  const result = toggleWeekSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  try {
    // Find the week and verify it belongs to the season (outside tx for early 404)
    const week = await db
      .select()
      .from(seasonWeeks)
      .where(and(eq(seasonWeeks.id, weekId), eq(seasonWeeks.seasonId, seasonId)))
      .get();

    if (!week) {
      return c.json({ error: 'Week not found', code: 'NOT_FOUND' }, 404);
    }

    const isActiveValue = result.data.isActive ? 1 : 0;

    // Atomic: update week + recalculate season totalRounds
    const txResult = await db.transaction(async (tx) => {
      await tx
        .update(seasonWeeks)
        .set({ isActive: isActiveValue })
        .where(eq(seasonWeeks.id, weekId));

      const allWeeks = await tx
        .select()
        .from(seasonWeeks)
        .where(eq(seasonWeeks.seasonId, seasonId))
        .orderBy(seasonWeeks.friday);

      const activeRounds = allWeeks.filter((w) => w.isActive === 1).length;
      const totalFridays = allWeeks.length;

      await tx
        .update(seasons)
        .set({ totalRounds: activeRounds })
        .where(eq(seasons.id, seasonId));

      // Recalculate tee rotation for all weeks
      const teeAssignments = calculateTeeRotation(allWeeks);
      for (const assignment of teeAssignments) {
        const existingWeek = allWeeks.find((w) => w.id === assignment.weekId);
        if (existingWeek && existingWeek.tee !== assignment.tee) {
          await tx
            .update(seasonWeeks)
            .set({ tee: assignment.tee })
            .where(eq(seasonWeeks.id, assignment.weekId));
        }
      }

      // Recalculate side-game rotation — same hold semantics as tees, anchored
      // to the active Fridays. Keeps scheduledFridays (the authoritative anchor
      // backfillSideGameRoundId reads) and the already-resolved scheduledRoundIds
      // in sync, so a rainout toggle shifts side games automatically instead of
      // requiring a manual edit. Future rounds self-backfill via scheduledFridays.
      //
      // Unlike tees (a display attribute), a played round carries settled
      // side-game history: recorded side_game_results keyed on (sideGameId,
      // roundId), and manual result entry validates against scheduledRoundIds.
      // A normal future rainout only shifts not-yet-played Fridays, so settled
      // rounds keep their game. But a RETROACTIVE toggle (unchecking a past week
      // that has already-played rounds after it) would reassign those rounds to
      // a different game and orphan their results. We refuse to do that: if the
      // recompute would move or drop any settled round, skip it and warn so the
      // admin adjusts manually rather than silently corrupting history.
      let sideGameRotationSkipped = false;
      let sideGameRotationSkipReason: 'played-rounds' | 'data-integrity' | null = null;
      const seasonSideGames = await tx
        .select({
          id: sideGames.id,
          scheduledFridays: sideGames.scheduledFridays,
          scheduledRoundIds: sideGames.scheduledRoundIds,
        })
        .from(sideGames)
        .where(eq(sideGames.seasonId, seasonId))
        .orderBy(sideGames.id);

      if (seasonSideGames.length > 0) {
        // Resolve Friday → roundId from existing non-cancelled official rounds
        const seasonRounds = await tx
          .select({
            id: rounds.id,
            scheduledDate: rounds.scheduledDate,
            status: rounds.status,
            type: rounds.type,
          })
          .from(rounds)
          .where(eq(rounds.seasonId, seasonId));
        const dateToRoundId = new Map(
          seasonRounds
            .filter((r) => r.type === 'official' && r.status !== 'cancelled')
            .map((r) => [r.scheduledDate, r.id] as const),
        );

        const sideGameAssignments = calculateSideGameRotation(seasonSideGames, allWeeks);

        // Game ownership PER FRIDAY. We compare on the authoritative anchor
        // (scheduledFridays — what backfillSideGameRoundId reads), not on
        // scheduledRoundIds, so an out-of-sync scheduledRoundIds can't blind the
        // guard. If any game's scheduledFridays is unreadable (bad JSON or not a
        // string array) we can't reason about what would move, so fail safe and
        // leave side games untouched.
        const currentFridayOwner = new Map<string, number>();
        for (const g of seasonSideGames) {
          const raw = g.scheduledFridays;
          let fridays: string[];
          if (raw == null || raw.trim() === '') {
            fridays = [];
          } else {
            try {
              const parsed: unknown = JSON.parse(raw);
              if (!Array.isArray(parsed) || parsed.some((f) => typeof f !== 'string')) {
                throw new Error('scheduledFridays is not a string array');
              }
              fridays = parsed as string[];
            } catch {
              sideGameRotationSkipped = true;
              sideGameRotationSkipReason = 'data-integrity';
              break;
            }
          }
          for (const f of fridays) currentFridayOwner.set(f, g.id);
        }
        const newFridayOwner = new Map<string, number>();
        for (const assignment of sideGameAssignments) {
          for (const f of assignment.fridays) newFridayOwner.set(f, assignment.gameId);
        }

        // Settled rounds whose assignment must not change. A round is settled
        // once it is played or being scored (status active/finalized/completed),
        // or already carries a recorded side-game result (covers manual results
        // entered against a still-'active' round). Only 'scheduled' (future) and
        // 'cancelled' (rained out, excluded from the rotation) are reassignable.
        if (!sideGameRotationSkipped) {
          const lockedStatuses = new Set(['active', 'finalized', 'completed']);
          const resultRounds = await tx
            .select({ roundId: sideGameResults.roundId })
            .from(sideGameResults)
            .innerJoin(sideGames, eq(sideGameResults.sideGameId, sideGames.id))
            .where(eq(sideGames.seasonId, seasonId));
          const settledRoundIds = new Set<number>([
            ...seasonRounds.filter((r) => lockedStatuses.has(r.status)).map((r) => r.id),
            ...resultRounds.map((r) => r.roundId),
          ]);
          // Settled round → its Friday (every settled round belongs to this season).
          const roundIdToFriday = new Map(seasonRounds.map((r) => [r.id, r.scheduledDate] as const));

          for (const rid of settledRoundIds) {
            const friday = roundIdToFriday.get(rid);
            if (friday === undefined) continue;
            const cur = currentFridayOwner.get(friday);
            const next = newFridayOwner.get(friday);
            // Disturbed if a settled round's Friday would move to a different
            // game, be dropped from the schedule, or be newly assigned
            // (out-of-sync data). The normal future rainout leaves settled past
            // rounds on the same game (cur === next), so it still applies.
            if (cur !== next) {
              sideGameRotationSkipped = true;
              sideGameRotationSkipReason = 'played-rounds';
              break;
            }
          }
        }

        if (!sideGameRotationSkipped) {
          for (const assignment of sideGameAssignments) {
            const game = seasonSideGames.find((g) => g.id === assignment.gameId);
            if (!game) continue;
            const newFridays = JSON.stringify(assignment.fridays);
            const newRoundIds = JSON.stringify(
              assignment.fridays
                .map((f) => dateToRoundId.get(f))
                .filter((rid): rid is number => typeof rid === 'number'),
            );
            if (game.scheduledFridays !== newFridays || game.scheduledRoundIds !== newRoundIds) {
              await tx
                .update(sideGames)
                .set({ scheduledFridays: newFridays, scheduledRoundIds: newRoundIds })
                .where(eq(sideGames.id, assignment.gameId));
            }
          }
        }
      }

      // Re-fetch to get updated tee values
      const refreshedWeeks = await tx
        .select()
        .from(seasonWeeks)
        .where(eq(seasonWeeks.seasonId, seasonId))
        .orderBy(seasonWeeks.friday);

      const weekIndex = refreshedWeeks.findIndex((w) => w.id === weekId);
      const refreshedWeek = refreshedWeeks.find((w) => w.id === weekId)!;

      return { updatedWeek: refreshedWeek, allWeeks: refreshedWeeks, activeRounds, totalFridays, weekIndex, sideGameRotationSkipped, sideGameRotationSkipReason };
    });

    // Check if a round exists for this Friday (read-only, outside tx is fine)
    const existingRound = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(eq(rounds.seasonId, seasonId), eq(rounds.scheduledDate, txResult.updatedWeek.friday)))
      .get();

    const weekWithNumber = { ...txResult.updatedWeek, weekNumber: txResult.weekIndex + 1 };

    const response: Record<string, unknown> = {
      week: weekWithNumber,
      activeRounds: txResult.activeRounds,
      totalFridays: txResult.totalFridays,
    };

    if (existingRound) {
      response['hasRound'] = true;
    }

    const warnings: string[] = [];
    if (txResult.activeRounds === 0) {
      warnings.push('No active rounds remaining');
    }
    if (txResult.sideGameRotationSkipped) {
      response['sideGameRotationSkipped'] = true;
      warnings.push(
        txResult.sideGameRotationSkipReason === 'data-integrity'
          ? 'Side-game rotation was not auto-adjusted: a side game has unreadable scheduling data. Adjust side-game scheduling manually.'
          : 'Side-game rotation was not auto-adjusted because this change affects already-played rounds. Adjust side-game scheduling manually.',
      );
    }
    if (warnings.length > 0) {
      response['warning'] = warnings.join(' ');
    }

    return c.json(response, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /seasons/:id/stats — season impact stats for delete confirmation
// ---------------------------------------------------------------------------

app.get('/seasons/:id/stats', adminAuthMiddleware, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  try {
    const season = await db
      .select({ id: seasons.id, name: seasons.name })
      .from(seasons)
      .where(eq(seasons.id, id))
      .get();

    if (!season) {
      return c.json({ error: 'Season not found', code: 'NOT_FOUND' }, 404);
    }

    const [roundCountResult] = await db
      .select({ value: count() })
      .from(rounds)
      .where(eq(rounds.seasonId, id));

    const [playerCountResult] = await db
      .select({ value: countDistinct(roundPlayers.playerId) })
      .from(roundPlayers)
      .innerJoin(rounds, eq(roundPlayers.roundId, rounds.id))
      .where(eq(rounds.seasonId, id));

    const [finalizedResult] = await db
      .select({ value: count() })
      .from(rounds)
      .where(and(eq(rounds.seasonId, id), eq(rounds.status, 'finalized')));

    return c.json(
      {
        seasonName: season.name,
        roundCount: roundCountResult?.value ?? 0,
        playerCount: playerCountResult?.value ?? 0,
        hasFinalized: (finalizedResult?.value ?? 0) > 0,
      },
      200,
    );
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /seasons/:id — delete season with all associated data
// ---------------------------------------------------------------------------

app.delete('/seasons/:id', adminAuthMiddleware, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  try {
    const season = await db
      .select({ id: seasons.id, name: seasons.name })
      .from(seasons)
      .where(eq(seasons.id, id))
      .get();

    if (!season) {
      return c.json({ error: 'Season not found', code: 'NOT_FOUND' }, 404);
    }

    await db.transaction(async (tx) => {
      // Get all round IDs for this season
      const seasonRounds = await tx
        .select({ id: rounds.id })
        .from(rounds)
        .where(eq(rounds.seasonId, id));
      const roundIds = seasonRounds.map((r) => r.id);

      if (roundIds.length > 0) {
        // Delete round-dependent leaf tables
        await tx.delete(scoreCorrections).where(inArray(scoreCorrections.roundId, roundIds));
        await tx.delete(wolfDecisions).where(inArray(wolfDecisions.roundId, roundIds));
        await tx.delete(harveyResults).where(inArray(harveyResults.roundId, roundIds));
        await tx.delete(roundResults).where(inArray(roundResults.roundId, roundIds));
        await tx.delete(holeScores).where(inArray(holeScores.roundId, roundIds));
        await tx.delete(roundPlayers).where(inArray(roundPlayers.roundId, roundIds));
        await tx.delete(groups).where(inArray(groups.roundId, roundIds));
        await tx.delete(sideGameResults).where(inArray(sideGameResults.roundId, roundIds));
        await tx.delete(rounds).where(eq(rounds.seasonId, id));
      }

      // Delete season-level dependent tables
      await tx.delete(sideGames).where(eq(sideGames.seasonId, id));
      await tx.delete(pairingHistory).where(eq(pairingHistory.seasonId, id));
      await tx.delete(subBench).where(eq(subBench.seasonId, id));

      // Delete attendance before season_weeks (attendance FK → season_weeks)
      const weekIds = (await tx.select({ id: seasonWeeks.id }).from(seasonWeeks).where(eq(seasonWeeks.seasonId, id))).map((w) => w.id);
      if (weekIds.length > 0) {
        await tx.delete(attendance).where(inArray(attendance.seasonWeekId, weekIds));
      }
      await tx.delete(seasonWeeks).where(eq(seasonWeeks.seasonId, id));

      // Delete the season
      await tx.delete(seasons).where(eq(seasons.id, id));
    });

    return c.json({ deleted: true, seasonName: season.name }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
