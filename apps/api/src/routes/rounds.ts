import { Hono } from 'hono';
import { eq, and, gte, inArray, desc, asc, sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import {
  getWolfAssignment,
  getCourseHole,
  calculateStablefordPoints,
  calculateHoleMoney,
  applyBonusModifiers,
  getHandicapStrokes,
  calcCourseHandicap,
} from '@wolf-cup/engine';
import type { HoleNumber, WolfDecision, HoleAssignment, BonusInput, BattingPosition } from '@wolf-cup/engine';
import type { Tee } from '@wolf-cup/engine';
import { db } from '../db/index.js';
import { rounds, groups, roundPlayers, players, holeScores, roundResults, wolfDecisions, seasons, harveyResults } from '../db/schema.js';
import { battingOrderSchema, submitHoleScoresSchema, wolfDecisionSchema, addGuestSchema, createPracticeRoundSchema } from '../schemas/round.js';
import { ghinClient } from '../lib/ghin-client.js';

const app = new Hono();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAR3_HOLES = new Set([6, 7, 12, 15]); // Guyan G&CC par-3 holes

// ---------------------------------------------------------------------------
// Money engine helpers
// ---------------------------------------------------------------------------

function buildWolfDecision(
  decision: string,
  partnerPlayerId: number | null,
  battingOrder: number[],
): WolfDecision {
  if (decision === 'alone') return { type: 'alone' };
  if (decision === 'blind_wolf') return { type: 'blind_wolf' };
  const partnerBatterIndex = battingOrder.indexOf(partnerPlayerId!) as BattingPosition;
  return { type: 'partner', partnerBatterIndex };
}

function buildHoleAssignment(holeNumber: number): HoleAssignment {
  return getWolfAssignment([0, 1, 2, 3], holeNumber as HoleNumber);
}

function buildBonusInput(bonusesJson: string | null, battingOrder: number[]): BonusInput {
  if (!bonusesJson) return { greenies: [], polies: [] };
  const { greenies = [], polies = [] } = JSON.parse(bonusesJson) as {
    greenies?: number[];
    polies?: number[];
  };
  return {
    greenies: greenies
      .map((id) => battingOrder.indexOf(id) as BattingPosition)
      .filter((p) => p >= 0),
    polies: polies
      .map((id) => battingOrder.indexOf(id) as BattingPosition)
      .filter((p) => p >= 0),
  };
}

type DbWolfDecision = {
  holeNumber: number;
  decision: string | null;
  partnerPlayerId: number | null;
  bonusesJson: string | null;
};

async function recalculateMoney(roundId: number, groupId: number, tee: Tee = 'blue'): Promise<Map<number, number>> {
  const group = await db
    .select({ battingOrder: groups.battingOrder })
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.roundId, roundId)))
    .get();
  if (!group?.battingOrder) return new Map();
  const battingOrder = JSON.parse(group.battingOrder) as number[];

  const [allScoresRows, allDecisionRows, handicapRows] = await Promise.all([
    db
      .select({ playerId: holeScores.playerId, holeNumber: holeScores.holeNumber, grossScore: holeScores.grossScore })
      .from(holeScores)
      .where(and(eq(holeScores.roundId, roundId), eq(holeScores.groupId, groupId))),
    db
      .select({
        holeNumber: wolfDecisions.holeNumber,
        decision: wolfDecisions.decision,
        partnerPlayerId: wolfDecisions.partnerPlayerId,
        bonusesJson: wolfDecisions.bonusesJson,
      })
      .from(wolfDecisions)
      .where(and(eq(wolfDecisions.roundId, roundId), eq(wolfDecisions.groupId, groupId))),
    db
      .select({ playerId: roundPlayers.playerId, handicapIndex: roundPlayers.handicapIndex })
      .from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId))),
  ]);

  // Build lookup maps
  const scoresByHole = new Map<number, Map<number, number>>();
  for (const row of allScoresRows) {
    if (!scoresByHole.has(row.holeNumber)) scoresByHole.set(row.holeNumber, new Map());
    scoresByHole.get(row.holeNumber)!.set(row.playerId, row.grossScore);
  }

  const decisionByHole = new Map<number, DbWolfDecision>();
  for (const row of allDecisionRows) {
    decisionByHole.set(row.holeNumber, row);
  }

  // Relative handicaps: convert HI → course handicap, then subtract group's lowest ("play off the low man")
  const courseHandicaps = handicapRows.map((r) => ({
    playerId: r.playerId,
    courseHandicap: calcCourseHandicap(r.handicapIndex, tee),
  }));
  const minCH = Math.min(...courseHandicaps.map((r) => r.courseHandicap));
  const handicapMap = new Map(courseHandicaps.map((r) => [r.playerId, r.courseHandicap - minCH]));

  const playerMoneyTotals = new Map<number, number>();

  for (let holeNum = 1; holeNum <= 18; holeNum++) {
    const holeMap = scoresByHole.get(holeNum);
    if (!holeMap || holeMap.size < 4) continue;

    const courseHole = getCourseHole(holeNum as HoleNumber);
    const grossScores = battingOrder.map((pid) => holeMap.get(pid) ?? 0) as [
      number,
      number,
      number,
      number,
    ];
    const netScores = battingOrder.map((pid, i) => {
      const strokes = getHandicapStrokes(handicapMap.get(pid) ?? 0, courseHole.strokeIndex);
      return grossScores[i]! - strokes;
    }) as [number, number, number, number];

    const holeAssignment = buildHoleAssignment(holeNum);
    const decisionRecord = decisionByHole.get(holeNum);

    let wolfDecision: WolfDecision | null = null;
    if (holeNum <= 2) {
      // Skins holes: no wolf decision needed
      wolfDecision = null;
    } else {
      if (!decisionRecord?.decision) continue; // wolf hole without decision yet — skip
      wolfDecision = buildWolfDecision(decisionRecord.decision, decisionRecord.partnerPlayerId, battingOrder);
    }

    const base = calculateHoleMoney(netScores, holeAssignment, wolfDecision, courseHole.par);
    // Skins holes (1-2): no bonus modifiers — just the base individual skin ($3/-$1 or $0).
    // Wolf holes (3+): always apply bonus modifiers (birdie/eagle/double-birdie are score-detected).
    let result = base;
    if (holeNum >= 3) {
      const bonusInput = buildBonusInput(decisionRecord?.bonusesJson ?? null, battingOrder);
      result = applyBonusModifiers(base, netScores, grossScores, bonusInput, holeAssignment, wolfDecision, courseHole.par);
    }

    for (let pos = 0; pos < 4; pos++) {
      const playerId = battingOrder[pos]!;
      playerMoneyTotals.set(playerId, (playerMoneyTotals.get(playerId) ?? 0) + result[pos]!.total);
    }

    // Write wolf outcome for non-skins holes
    if (holeNum >= 3 && holeAssignment.type === 'wolf') {
      const wolfBatterIndex = holeAssignment.wolfBatterIndex;
      const wolfMoney = result[wolfBatterIndex]!.total;
      const outcome = wolfMoney > 0 ? 'win' : wolfMoney < 0 ? 'loss' : 'push';
      await db
        .update(wolfDecisions)
        .set({ outcome })
        .where(
          and(
            eq(wolfDecisions.roundId, roundId),
            eq(wolfDecisions.groupId, groupId),
            eq(wolfDecisions.holeNumber, holeNum),
          ),
        );
    }
  }

  return playerMoneyTotals;
}

// ---------------------------------------------------------------------------
// Helper: build full round detail (round + groups + players per group)
// ---------------------------------------------------------------------------

async function getRoundDetail(roundId: number) {
  const round = await db
    .select({
      id: rounds.id,
      seasonId: rounds.seasonId,
      type: rounds.type,
      status: rounds.status,
      scheduledDate: rounds.scheduledDate,
      autoCalculateMoney: rounds.autoCalculateMoney,
    })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .get();

  if (!round) return null;

  // Compute per-season round number
  const seasonRounds = await db
    .select({ id: rounds.id, scheduledDate: rounds.scheduledDate })
    .from(rounds)
    .where(and(eq(rounds.seasonId, round.seasonId), sql`${rounds.status} != 'cancelled'`))
    .orderBy(rounds.scheduledDate, rounds.id);
  const roundNumber = seasonRounds.findIndex((r) => r.id === round.id) + 1;

  const roundGroups = await db
    .select({ id: groups.id, groupNumber: groups.groupNumber, battingOrder: groups.battingOrder })
    .from(groups)
    .where(eq(groups.roundId, roundId))
    .orderBy(groups.groupNumber);

  // Fetch all round_players + player info for this round in one query
  const roundPlayerRows = await db
    .select({
      groupId: roundPlayers.groupId,
      playerId: roundPlayers.playerId,
      handicapIndex: roundPlayers.handicapIndex,
      name: players.name,
    })
    .from(roundPlayers)
    .where(eq(roundPlayers.roundId, roundId))
    .innerJoin(players, eq(roundPlayers.playerId, players.id));

  // Assemble nested structure
  const groupsWithPlayers = roundGroups.map((g) => ({
    id: g.id,
    groupNumber: g.groupNumber,
    battingOrder: g.battingOrder ? (JSON.parse(g.battingOrder) as number[]) : null,
    players: roundPlayerRows
      .filter((rp) => rp.groupId === g.id)
      .map((rp) => ({ id: rp.playerId, name: rp.name, handicapIndex: rp.handicapIndex })),
  }));

  // Check if every player has a score for hole 18
  const allPlayerIds = roundPlayerRows.map((rp) => rp.playerId);
  let allHole18Scored = false;
  if (allPlayerIds.length > 0) {
    const hole18Scores = await db
      .select({ playerId: holeScores.playerId })
      .from(holeScores)
      .where(and(eq(holeScores.roundId, roundId), eq(holeScores.holeNumber, 18)));
    const hole18PlayerIds = new Set(hole18Scores.map((r) => r.playerId));
    allHole18Scored = allPlayerIds.every((id) => hole18PlayerIds.has(id));
  }

  return {
    id: round.id,
    roundNumber,
    type: round.type,
    status: round.status,
    scheduledDate: round.scheduledDate,
    autoCalculateMoney: Boolean(round.autoCalculateMoney),
    allHole18Scored,
    groups: groupsWithPlayers,
  };
}

// ---------------------------------------------------------------------------
// POST /rounds/:id/cancel — cancel a casual round (public, casual only)
// ---------------------------------------------------------------------------

app.post('/rounds/:id/cancel', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
  }

  let round: { id: number; type: string; status: string } | undefined;
  try {
    round = await db
      .select({ id: rounds.id, type: rounds.type, status: rounds.status })
      .from(rounds)
      .where(eq(rounds.id, id))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  if (round.type !== 'casual') {
    return c.json({ error: 'Only casual rounds can be self-cancelled', code: 'OFFICIAL_ONLY' }, 422);
  }
  if (round.status === 'cancelled') {
    return c.json({ success: true }, 200); // idempotent
  }
  if (round.status === 'finalized') {
    return c.json({ error: 'Cannot cancel a finalized round', code: 'ROUND_NOT_ACTIVE' }, 422);
  }

  try {
    await db.update(rounds).set({ status: 'cancelled' }).where(eq(rounds.id, id));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  return c.json({ success: true }, 200);
});

// ---------------------------------------------------------------------------
// POST /rounds/:id/complete — non-destructively end a casual round
// Preserves all scores/wolf data. Removes from live leaderboard.
// ---------------------------------------------------------------------------

app.post('/rounds/:id/complete', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
  }

  let round: { id: number; type: string; status: string } | undefined;
  try {
    round = await db
      .select({ id: rounds.id, type: rounds.type, status: rounds.status })
      .from(rounds)
      .where(eq(rounds.id, id))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  if (round.type !== 'casual') {
    return c.json({ error: 'Only casual rounds can be completed this way', code: 'CASUAL_ONLY' }, 422);
  }
  if (round.status === 'completed') {
    return c.json({ success: true }, 200); // idempotent
  }
  if (round.status !== 'active') {
    return c.json({ error: 'Round is not active', code: 'ROUND_NOT_ACTIVE' }, 422);
  }

  try {
    await db.update(rounds).set({ status: 'completed' }).where(eq(rounds.id, id));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  return c.json({ success: true }, 200);
});

// ---------------------------------------------------------------------------
// POST /rounds/:id/groups/:groupId/quit — remove one group from a casual round
// If this is the last group, the round is cancelled. Otherwise only this
// group's data is deleted and the round stays active for other groups.
// ---------------------------------------------------------------------------

app.post('/rounds/:id/groups/:groupId/quit', async (c) => {
  const roundId = Number(c.req.param('id'));
  const groupId = Number(c.req.param('groupId'));
  if (!Number.isInteger(roundId) || roundId <= 0 || !Number.isInteger(groupId) || groupId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  let round: { id: number; type: string; status: string } | undefined;
  try {
    round = await db
      .select({ id: rounds.id, type: rounds.type, status: rounds.status })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  if (round.type !== 'casual') {
    return c.json({ error: 'Only casual rounds can be quit', code: 'OFFICIAL_ONLY' }, 422);
  }
  if (round.status === 'finalized') {
    return c.json({ error: 'Cannot quit a finalized round', code: 'ROUND_FINALIZED' }, 422);
  }

  try {
    await db.transaction(async (tx) => {
      // Get player IDs for this group
      const groupPlayerRows = await tx
        .select({ playerId: roundPlayers.playerId })
        .from(roundPlayers)
        .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId)));
      const playerIds = groupPlayerRows.map((r) => r.playerId);

      // Identify guest players in this group
      const guestIds: number[] = [];
      if (playerIds.length > 0) {
        const guestRows = await tx
          .select({ id: players.id })
          .from(players)
          .where(and(inArray(players.id, playerIds), eq(players.isGuest, 1)));
        guestIds.push(...guestRows.map((r) => r.id));
      }

      // Delete group-scoped data
      await tx.delete(holeScores).where(and(eq(holeScores.roundId, roundId), eq(holeScores.groupId, groupId)));
      await tx.delete(wolfDecisions).where(and(eq(wolfDecisions.roundId, roundId), eq(wolfDecisions.groupId, groupId)));

      if (playerIds.length > 0) {
        await tx.delete(roundResults).where(and(eq(roundResults.roundId, roundId), inArray(roundResults.playerId, playerIds)));
        await tx.delete(harveyResults).where(and(eq(harveyResults.roundId, roundId), inArray(harveyResults.playerId, playerIds)));
      }

      await tx.delete(roundPlayers).where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId)));
      await tx.delete(groups).where(eq(groups.id, groupId));

      // Orphan guest player cleanup
      if (guestIds.length > 0) {
        const stillUsed = await tx
          .select({ playerId: roundPlayers.playerId })
          .from(roundPlayers)
          .where(inArray(roundPlayers.playerId, guestIds));
        const stillUsedSet = new Set(stillUsed.map((r) => r.playerId));
        const orphanIds = guestIds.filter((id) => !stillUsedSet.has(id));
        if (orphanIds.length > 0) {
          await tx.delete(players).where(inArray(players.id, orphanIds));
        }
      }

      // If no groups remain, cancel the round
      const remainingGroups = await tx
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.roundId, roundId));
      if (remainingGroups.length === 0) {
        await tx.update(rounds).set({ status: 'cancelled' }).where(eq(rounds.id, roundId));
      }
    });
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  return c.json({ success: true }, 200);
});

// ---------------------------------------------------------------------------
// GET /players/active — public roster for ball-draw dropdown (no auth)
// ---------------------------------------------------------------------------

app.get('/players/active', async (c) => {
  try {
    const rows = await db
      .select({ id: players.id, name: players.name, handicapIndex: players.handicapIndex })
      .from(players)
      .where(and(eq(players.isActive, 1), eq(players.isGuest, 0)))
      .orderBy(asc(players.name));
    return c.json({ players: rows }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /players/refresh-handicaps — bulk-fetch fresh GHIN HIs for all active roster players
// ---------------------------------------------------------------------------

app.post('/players/refresh-handicaps', async (c) => {
  if (!ghinClient) {
    return c.json({ error: 'GHIN not configured', code: 'GHIN_NOT_CONFIGURED' }, 503);
  }
  const client = ghinClient;

  let activePlayers: Array<{ id: number; name: string; ghinNumber: string | null; handicapIndex: number | null }>;
  try {
    activePlayers = await db
      .select({ id: players.id, name: players.name, ghinNumber: players.ghinNumber, handicapIndex: players.handicapIndex })
      .from(players)
      .where(and(eq(players.isActive, 1), eq(players.isGuest, 0)));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  const ghinPlayers = activePlayers.filter((p) => p.ghinNumber);
  const results = await Promise.allSettled(
    ghinPlayers.map(async (p) => {
      const { handicapIndex } = await client.getHandicap(Number(p.ghinNumber));
      return { playerId: p.id, handicapIndex };
    }),
  );

  let updated = 0;
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.handicapIndex !== null) {
      const { playerId, handicapIndex } = result.value;
      try {
        await db.update(players).set({ handicapIndex }).where(eq(players.id, playerId));
        updated++;
      } catch {
        // Non-fatal
      }
    }
  }

  // Return the refreshed roster
  try {
    const rows = await db
      .select({ id: players.id, name: players.name, handicapIndex: players.handicapIndex })
      .from(players)
      .where(and(eq(players.isActive, 1), eq(players.isGuest, 0)))
      .orderBy(asc(players.name));
    return c.json({ players: rows, updated }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /rounds — list scheduled/active rounds (past day through future)
// ---------------------------------------------------------------------------

app.get('/rounds', async (c) => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  try {
    const rows = await db
      .select({
        id: rounds.id,
        seasonId: rounds.seasonId,
        type: rounds.type,
        status: rounds.status,
        scheduledDate: rounds.scheduledDate,
        autoCalculateMoney: rounds.autoCalculateMoney,
      })
      .from(rounds)
      .where(
        and(
          gte(rounds.scheduledDate, yesterday),
          inArray(rounds.status, ['scheduled', 'active']),
        ),
      )
      .orderBy(desc(rounds.scheduledDate));

    // Compute per-season round numbers for each unique season
    const seasonIds = [...new Set(rows.map((r) => r.seasonId))];
    const roundNumberMap = new Map<number, number>();
    for (const sid of seasonIds) {
      const seasonRounds = await db
        .select({ id: rounds.id })
        .from(rounds)
        .where(and(eq(rounds.seasonId, sid), sql`${rounds.status} != 'cancelled'`))
        .orderBy(rounds.scheduledDate, rounds.id);
      seasonRounds.forEach((sr, i) => roundNumberMap.set(sr.id, i + 1));
    }

    const items = rows.map((r) => ({
      ...r,
      roundNumber: roundNumberMap.get(r.id) ?? null,
      autoCalculateMoney: Boolean(r.autoCalculateMoney),
    }));

    return c.json({ items }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /rounds/practice — create a casual practice round (no auth required)
// ---------------------------------------------------------------------------

app.post('/rounds/practice', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] }, 400);
  }
  const parsed = createPracticeRoundSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }
  const { groupCount } = parsed.data;

  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();

  // Use the most recently created season; auto-create a minimal one if none exists
  let seasonId: number;
  try {
    const latestSeason = await db
      .select({ id: seasons.id })
      .from(seasons)
      .orderBy(desc(seasons.id))
      .limit(1)
      .get();

    if (latestSeason) {
      seasonId = latestSeason.id;
    } else {
      const [newSeason] = await db
        .insert(seasons)
        .values({
          name: 'Practice',
          startDate: today,
          endDate: today,
          totalRounds: 0,
          playoffFormat: 'none',
          harveyLiveEnabled: 0,
          createdAt: now,
        })
        .returning({ id: seasons.id });
      if (!newSeason) throw new Error('Season insert failed');
      seasonId = newSeason.id;
    }
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [newRound] = await tx
        .insert(rounds)
        .values({ seasonId, type: 'casual', status: 'active', scheduledDate: today, autoCalculateMoney: 1, createdAt: now })
        .returning({ id: rounds.id });
      if (!newRound) throw new Error('Round insert failed');

      const createdGroups: { id: number; groupNumber: number }[] = [];
      for (let i = 1; i <= groupCount; i++) {
        const [newGroup] = await tx
          .insert(groups)
          .values({ roundId: newRound.id, groupNumber: i })
          .returning({ id: groups.id });
        if (!newGroup) throw new Error('Group insert failed');
        createdGroups.push({ id: newGroup.id, groupNumber: i });
      }

      return { roundId: newRound.id, groups: createdGroups };
    });

    return c.json(result, 201);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /rounds/:id — round detail with groups and players
// ---------------------------------------------------------------------------

app.get('/rounds/:id', async (c) => {
  const idParam = c.req.param('id');
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
  }

  try {
    const round = await getRoundDetail(id);
    if (!round) {
      return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
    }
    return c.json({ round }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /rounds/:id/start — validate entry code (official) and transition to active
// ---------------------------------------------------------------------------

app.post('/rounds/:id/start', async (c) => {
  const idParam = c.req.param('id');
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'INVALID_ID' }, 400);
  }

  // Fetch minimal round info (including entryCodeHash for validation)
  let round:
    | { id: number; type: string; status: string; entryCodeHash: string | null }
    | undefined;
  try {
    round = await db
      .select({
        id: rounds.id,
        type: rounds.type,
        status: rounds.status,
        entryCodeHash: rounds.entryCodeHash,
      })
      .from(rounds)
      .where(eq(rounds.id, id))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!round) {
    return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  }

  // Finalized or cancelled rounds cannot be joined
  if (round.status === 'finalized' || round.status === 'cancelled') {
    return c.json({ error: 'Round not joinable', code: 'ROUND_NOT_JOINABLE' }, 422);
  }

  // Casual rounds bypass entry code check (FR25)
  if (round.type !== 'official') {
    try {
      const detail = await getRoundDetail(id);
      return c.json({ round: detail }, 200);
    } catch {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
  }

  // Official round: validate entry code (FR24 / FR62)
  const providedCode = c.req.header('x-entry-code');
  if (!providedCode || !round.entryCodeHash) {
    return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);
  }

  let valid = false;
  try {
    valid = await bcrypt.compare(providedCode, round.entryCodeHash);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!valid) {
    return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);
  }

  // Transition scheduled → active (idempotent: already-active stays active)
  if (round.status === 'scheduled') {
    try {
      await db.update(rounds).set({ status: 'active' }).where(eq(rounds.id, id));
    } catch {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
  }

  try {
    const detail = await getRoundDetail(id);
    return c.json({ round: detail }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// PUT /rounds/:roundId/groups/:groupId/batting-order — save ball draw batting order
// ---------------------------------------------------------------------------

app.put('/rounds/:roundId/groups/:groupId/batting-order', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const groupId = Number(c.req.param('groupId'));
  if (!Number.isInteger(roundId) || roundId <= 0 || !Number.isInteger(groupId) || groupId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  // Fetch round
  let round:
    | { id: number; type: string; status: string; entryCodeHash: string | null }
    | undefined;
  try {
    round = await db
      .select({ id: rounds.id, type: rounds.type, status: rounds.status, entryCodeHash: rounds.entryCodeHash })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  if (round.status === 'finalized' || round.status === 'cancelled') {
    return c.json({ error: 'Round not joinable', code: 'ROUND_NOT_JOINABLE' }, 422);
  }

  // Entry code check for official rounds
  if (round.type === 'official') {
    const code = c.req.header('x-entry-code');
    if (!code || !round.entryCodeHash) {
      return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);
    }
    let valid = false;
    try {
      valid = await bcrypt.compare(code, round.entryCodeHash);
    } catch {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    if (!valid) return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);
  }

  // Fetch group (must belong to this round)
  let group: { id: number; groupNumber: number; battingOrder: string | null } | undefined;
  try {
    group = await db
      .select({ id: groups.id, groupNumber: groups.groupNumber, battingOrder: groups.battingOrder })
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.roundId, roundId)))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!group) return c.json({ error: 'Group not found', code: 'NOT_FOUND' }, 404);

  // Parse and validate body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] }, 400);
  }
  const parsed = battingOrderSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }
  const { order, tee } = parsed.data;

  // Validate: exactly 4 players
  if (order.length !== 4) {
    return c.json({ error: 'Invalid batting order', code: 'INVALID_BATTING_ORDER' }, 422);
  }

  // Validate: no duplicates
  if (new Set(order).size !== 4) {
    return c.json({ error: 'Invalid batting order', code: 'INVALID_BATTING_ORDER' }, 422);
  }

  // Validate: all players in order must be in this group
  let groupPlayerRows: Array<{ playerId: number; name: string }>;
  try {
    groupPlayerRows = await db
      .select({ playerId: roundPlayers.playerId, name: players.name })
      .from(roundPlayers)
      .innerJoin(players, eq(roundPlayers.playerId, players.id))
      .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId)));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  const validPlayerIds = new Set(groupPlayerRows.map((p) => p.playerId));
  for (const pid of order) {
    if (!validPlayerIds.has(pid)) {
      return c.json({ error: 'Invalid batting order', code: 'INVALID_BATTING_ORDER' }, 422);
    }
  }

  // Save batting order (and tee if provided)
  try {
    const updateFields: { battingOrder: string; tee?: string } = { battingOrder: JSON.stringify(order) };
    if (tee) updateFields.tee = tee;
    await db.update(groups).set(updateFields).where(eq(groups.id, groupId));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  // Compute wolf schedule
  const playerNameMap = new Map(groupPlayerRows.map((p) => [p.playerId, p.name]));
  const battingOrderTuple = order as [number, number, number, number];

  const wolfSchedule = Array.from({ length: 18 }, (_, i) => {
    const holeNumber = (i + 1) as HoleNumber;
    const assignment = getWolfAssignment(battingOrderTuple, holeNumber);
    if (assignment.type === 'skins') {
      return { holeNumber, type: 'skins' as const, wolfPlayerId: null, wolfPlayerName: null };
    }
    const wolfPlayerId = battingOrderTuple[assignment.wolfBatterIndex];
    return {
      holeNumber,
      type: 'wolf' as const,
      wolfPlayerId,
      wolfPlayerName: playerNameMap.get(wolfPlayerId) ?? null,
    };
  });

  return c.json(
    {
      group: {
        id: group.id,
        groupNumber: group.groupNumber,
        battingOrder: order,
        wolfSchedule,
      },
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/groups/:groupId/holes/:holeNumber/scores — submit hole scores
// ---------------------------------------------------------------------------

app.post('/rounds/:roundId/groups/:groupId/holes/:holeNumber/scores', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const groupId = Number(c.req.param('groupId'));
  const holeNumber = Number(c.req.param('holeNumber'));

  if (!Number.isInteger(roundId) || roundId <= 0 || !Number.isInteger(groupId) || groupId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }
  if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
    return c.json({ error: 'Invalid hole number', code: 'INVALID_HOLE' }, 400);
  }

  // Fetch round
  let round:
    | { id: number; type: string; status: string; entryCodeHash: string | null }
    | undefined;
  try {
    round = await db
      .select({ id: rounds.id, type: rounds.type, status: rounds.status, entryCodeHash: rounds.entryCodeHash })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  if (round.status === 'finalized' || round.status === 'cancelled') {
    return c.json({ error: 'Round not active', code: 'ROUND_NOT_ACTIVE' }, 422);
  }

  // Entry code check for official rounds
  if (round.type === 'official') {
    const code = c.req.header('x-entry-code');
    if (!code || !round.entryCodeHash) {
      return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);
    }
    let valid = false;
    try {
      valid = await bcrypt.compare(code, round.entryCodeHash);
    } catch {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    if (!valid) return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);
  }

  // Fetch group (must belong to this round)
  let group: { id: number } | undefined;
  try {
    group = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.roundId, roundId)))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!group) return c.json({ error: 'Group not found', code: 'NOT_FOUND' }, 404);

  // Parse and validate body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] }, 400);
  }
  const parsed = submitHoleScoresSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }
  const { scores } = parsed.data;

  // Validate all playerIds are members of this group
  let groupPlayerRows: Array<{ playerId: number; handicapIndex: number }>;
  try {
    groupPlayerRows = await db
      .select({ playerId: roundPlayers.playerId, handicapIndex: roundPlayers.handicapIndex })
      .from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId)));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  const validPlayerIds = new Set(groupPlayerRows.map((p) => p.playerId));
  for (const { playerId } of scores) {
    if (!validPlayerIds.has(playerId)) {
      return c.json({ error: 'Invalid scores', code: 'INVALID_SCORES' }, 422);
    }
  }

  // Validate no duplicate playerIds
  if (new Set(scores.map((s) => s.playerId)).size !== scores.length) {
    return c.json({ error: 'Invalid scores', code: 'INVALID_SCORES' }, 422);
  }

  // Upsert hole scores (idempotent)
  const now = Date.now();
  try {
    for (const { playerId, grossScore } of scores) {
      await db
        .insert(holeScores)
        .values({ roundId, groupId, playerId, holeNumber, grossScore, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [holeScores.roundId, holeScores.playerId, holeScores.holeNumber],
          set: { grossScore, updatedAt: now },
        });
    }
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  // Fetch ALL hole scores for this group (all holes submitted so far)
  let allHoleScores: Array<{ playerId: number; holeNumber: number; grossScore: number }>;
  try {
    allHoleScores = await db
      .select({
        playerId: holeScores.playerId,
        holeNumber: holeScores.holeNumber,
        grossScore: holeScores.grossScore,
      })
      .from(holeScores)
      .where(and(eq(holeScores.roundId, roundId), eq(holeScores.groupId, groupId)));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  // Recalculate Stableford totals across all submitted holes
  const handicapMap = new Map(groupPlayerRows.map((p) => [p.playerId, p.handicapIndex]));
  const stablefordTotals = new Map<number, number>();
  for (const row of allHoleScores) {
    const hi = handicapMap.get(row.playerId) ?? 0;
    const courseHole = getCourseHole(row.holeNumber as HoleNumber);
    const points = calculateStablefordPoints(row.grossScore, hi, courseHole.par, courseHole.strokeIndex);
    stablefordTotals.set(row.playerId, (stablefordTotals.get(row.playerId) ?? 0) + points);
  }

  // Upsert round_results per player
  try {
    for (const [playerId, stablefordTotal] of stablefordTotals) {
      await db
        .insert(roundResults)
        .values({ roundId, playerId, stablefordTotal, moneyTotal: 0, updatedAt: now })
        .onConflictDoUpdate({
          target: [roundResults.roundId, roundResults.playerId],
          set: { stablefordTotal, updatedAt: now },
        });
    }
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  const sortedHoleScores = [...allHoleScores].sort(
    (a, b) => a.holeNumber - b.holeNumber || a.playerId - b.playerId,
  );

  return c.json(
    {
      holeScores: sortedHoleScores,
      roundTotals: Array.from(stablefordTotals.entries()).map(([playerId, stablefordTotal]) => ({
        playerId,
        stablefordTotal,
      })),
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/groups/:groupId/scores — fetch all submitted hole scores
// ---------------------------------------------------------------------------

app.get('/rounds/:roundId/groups/:groupId/scores', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const groupId = Number(c.req.param('groupId'));

  if (!Number.isInteger(roundId) || roundId <= 0 || !Number.isInteger(groupId) || groupId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  // Verify round exists
  let round: { id: number } | undefined;
  try {
    round = await db.select({ id: rounds.id }).from(rounds).where(eq(rounds.id, roundId)).get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);

  // Verify group exists and belongs to round
  let group: { id: number } | undefined;
  try {
    group = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.roundId, roundId)))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!group) return c.json({ error: 'Group not found', code: 'NOT_FOUND' }, 404);

  try {
    const scores = await db
      .select({
        holeNumber: holeScores.holeNumber,
        playerId: holeScores.playerId,
        grossScore: holeScores.grossScore,
      })
      .from(holeScores)
      .where(and(eq(holeScores.roundId, roundId), eq(holeScores.groupId, groupId)))
      .orderBy(asc(holeScores.holeNumber), asc(holeScores.playerId));

    // Include Stableford + money totals for players in this group who have scores
    const groupPlayerIds = [...new Set(scores.map((s) => s.playerId))];
    const roundTotals =
      groupPlayerIds.length > 0
        ? await db
            .select({
              playerId: roundResults.playerId,
              stablefordTotal: roundResults.stablefordTotal,
              moneyTotal: roundResults.moneyTotal,
            })
            .from(roundResults)
            .where(and(eq(roundResults.roundId, roundId), inArray(roundResults.playerId, groupPlayerIds)))
        : [];

    return c.json({ scores, roundTotals }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/groups/:groupId/holes/:holeNumber/wolf-decision
// ---------------------------------------------------------------------------

app.post('/rounds/:roundId/groups/:groupId/holes/:holeNumber/wolf-decision', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const groupId = Number(c.req.param('groupId'));
  const holeNumber = Number(c.req.param('holeNumber'));

  if (!Number.isInteger(roundId) || roundId <= 0 || !Number.isInteger(groupId) || groupId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }
  if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
    return c.json({ error: 'Invalid hole number', code: 'INVALID_HOLE' }, 400);
  }

  // Fetch round
  let round: { id: number; type: string; status: string; entryCodeHash: string | null; tee: string | null } | undefined;
  try {
    round = await db
      .select({ id: rounds.id, type: rounds.type, status: rounds.status, entryCodeHash: rounds.entryCodeHash, tee: rounds.tee })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  if (round.status === 'finalized' || round.status === 'cancelled') {
    return c.json({ error: 'Round not active', code: 'ROUND_NOT_ACTIVE' }, 422);
  }

  // Entry code check for official rounds
  if (round.type === 'official') {
    const code = c.req.header('x-entry-code');
    if (!code || !round.entryCodeHash) {
      return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);
    }
    let valid = false;
    try {
      valid = await bcrypt.compare(code, round.entryCodeHash);
    } catch {
      return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
    }
    if (!valid) return c.json({ error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' }, 403);
  }

  // Fetch group and batting order
  let group: { id: number; battingOrder: string | null } | undefined;
  try {
    group = await db
      .select({ id: groups.id, battingOrder: groups.battingOrder })
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.roundId, roundId)))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!group) return c.json({ error: 'Group not found', code: 'NOT_FOUND' }, 404);
  if (!group.battingOrder) {
    return c.json({ error: 'Batting order not set', code: 'INVALID_DECISION' }, 422);
  }
  const battingOrder = JSON.parse(group.battingOrder) as number[];

  // Fetch group players for validation
  let groupPlayerRows: Array<{ playerId: number }>;
  try {
    groupPlayerRows = await db
      .select({ playerId: roundPlayers.playerId })
      .from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId)));
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  const validPlayerIds = new Set(groupPlayerRows.map((p) => p.playerId));

  // Parse body
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] }, 400);
  }
  const parsed = wolfDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }
  const { decision, partnerPlayerId, greenies, polies } = parsed.data;

  // Business rule validation
  const isSkinHole = holeNumber <= 2;

  // Skins holes (1-2): decision must not be present
  if (isSkinHole && decision !== undefined) {
    return c.json({ error: 'Invalid decision', code: 'INVALID_DECISION' }, 422);
  }

  // Wolf holes (3-18): decision is required
  if (!isSkinHole && decision === undefined) {
    return c.json({ error: 'Invalid decision', code: 'INVALID_DECISION' }, 422);
  }

  // Partner decision: partnerPlayerId required and must be a non-wolf group member
  let wolfPlayerId: number | null = null;
  if (!isSkinHole) {
    const wolfAssignment = getWolfAssignment([0, 1, 2, 3], holeNumber as HoleNumber);
    const wolfBatterIndex = wolfAssignment.type === 'wolf' ? wolfAssignment.wolfBatterIndex : 0;
    wolfPlayerId = battingOrder[wolfBatterIndex]!;

    if (decision === 'partner') {
      if (!partnerPlayerId) {
        return c.json({ error: 'Invalid decision', code: 'INVALID_DECISION' }, 422);
      }
      if (partnerPlayerId === wolfPlayerId || !validPlayerIds.has(partnerPlayerId)) {
        return c.json({ error: 'Invalid decision', code: 'INVALID_DECISION' }, 422);
      }
    }
  }

  // Validate greenies: par-3 holes only; all must be group members
  if (greenies.length > 0) {
    if (!PAR3_HOLES.has(holeNumber)) {
      return c.json({ error: 'Invalid decision', code: 'INVALID_DECISION' }, 422);
    }
    for (const pid of greenies) {
      if (!validPlayerIds.has(pid)) {
        return c.json({ error: 'Invalid decision', code: 'INVALID_DECISION' }, 422);
      }
    }
  }

  // Validate polies: all must be group members
  for (const pid of polies) {
    if (!validPlayerIds.has(pid)) {
      return c.json({ error: 'Invalid decision', code: 'INVALID_DECISION' }, 422);
    }
  }

  // Build bonusesJson
  const bonusesJson =
    greenies.length > 0 || polies.length > 0 ? JSON.stringify({ greenies, polies }) : null;

  // Upsert wolf_decisions row (idempotent)
  const now = Date.now();
  try {
    await db
      .insert(wolfDecisions)
      .values({
        roundId,
        groupId,
        holeNumber,
        wolfPlayerId,
        decision: decision ?? null,
        partnerPlayerId: partnerPlayerId ?? null,
        bonusesJson,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [wolfDecisions.roundId, wolfDecisions.groupId, wolfDecisions.holeNumber],
        set: {
          wolfPlayerId,
          decision: decision ?? null,
          partnerPlayerId: partnerPlayerId ?? null,
          bonusesJson,
        },
      });
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  // Recalculate money totals for all holes in this group
  let playerMoneyTotals: Map<number, number>;
  try {
    playerMoneyTotals = await recalculateMoney(roundId, groupId, (round.tee as Tee) ?? 'blue');
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  // Upsert round_results moneyTotal for each player
  try {
    for (const [playerId, moneyTotal] of playerMoneyTotals) {
      await db
        .insert(roundResults)
        .values({ roundId, playerId, stablefordTotal: 0, moneyTotal, updatedAt: now })
        .onConflictDoUpdate({
          target: [roundResults.roundId, roundResults.playerId],
          set: { moneyTotal, updatedAt: now },
        });
    }
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  const moneyTotalsResponse = Array.from(playerMoneyTotals.entries()).map(
    ([playerId, moneyTotal]) => ({ playerId, moneyTotal }),
  );

  return c.json(
    {
      wolfDecision: {
        holeNumber,
        decision: decision ?? null,
        partnerPlayerId: partnerPlayerId ?? null,
        greenies,
        polies,
      },
      moneyTotals: moneyTotalsResponse,
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/groups/:groupId/wolf-decisions
// ---------------------------------------------------------------------------

app.get('/rounds/:roundId/groups/:groupId/wolf-decisions', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const groupId = Number(c.req.param('groupId'));

  if (!Number.isInteger(roundId) || roundId <= 0 || !Number.isInteger(groupId) || groupId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  // Verify round exists
  let round: { id: number } | undefined;
  try {
    round = await db.select({ id: rounds.id }).from(rounds).where(eq(rounds.id, roundId)).get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);

  // Verify group belongs to round
  let group: { id: number } | undefined;
  try {
    group = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.roundId, roundId)))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!group) return c.json({ error: 'Group not found', code: 'NOT_FOUND' }, 404);

  try {
    const rows = await db
      .select({
        holeNumber: wolfDecisions.holeNumber,
        decision: wolfDecisions.decision,
        partnerPlayerId: wolfDecisions.partnerPlayerId,
        bonusesJson: wolfDecisions.bonusesJson,
      })
      .from(wolfDecisions)
      .where(and(eq(wolfDecisions.roundId, roundId), eq(wolfDecisions.groupId, groupId)))
      .orderBy(asc(wolfDecisions.holeNumber));

    const result = rows.map((r) => {
      const bonuses = r.bonusesJson
        ? (JSON.parse(r.bonusesJson) as { greenies?: number[]; polies?: number[] })
        : { greenies: [], polies: [] };
      return {
        holeNumber: r.holeNumber,
        decision: r.decision,
        partnerPlayerId: r.partnerPlayerId,
        greenies: bonuses.greenies ?? [],
        polies: bonuses.polies ?? [],
      };
    });

    return c.json({ wolfDecisions: result }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/groups/:groupId/guests — add guest player (casual rounds only)
// ---------------------------------------------------------------------------

app.post('/rounds/:roundId/groups/:groupId/guests', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const groupId = Number(c.req.param('groupId'));

  if (!Number.isInteger(roundId) || roundId <= 0 || !Number.isInteger(groupId) || groupId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  // Fetch round
  let round: { id: number; type: string; status: string } | undefined;
  try {
    round = await db
      .select({ id: rounds.id, type: rounds.type, status: rounds.status })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  if (round.status === 'finalized' || round.status === 'cancelled') {
    return c.json({ error: 'Round not active', code: 'ROUND_NOT_ACTIVE' }, 422);
  }
  if (round.type === 'official') {
    return c.json({ error: 'Guest players can only be added to casual rounds', code: 'CASUAL_ONLY' }, 422);
  }

  // Fetch group (must belong to round)
  let group: { id: number } | undefined;
  try {
    group = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.roundId, roundId)))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!group) return c.json({ error: 'Group not found', code: 'NOT_FOUND' }, 404);

  // Parse and validate body before acquiring the transaction lock
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: [] }, 400);
  }
  const parsed = addGuestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation error', code: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }
  const { name, handicapIndex } = parsed.data;

  // Capacity check + both inserts in one transaction to prevent race conditions
  // and ensure no orphaned player rows if the round_players insert fails.
  const now = Date.now();
  let newPlayerId: number;
  try {
    const result = await db.transaction(async (tx) => {
      const countRow = await tx
        .select({ count: sql<number>`count(*)` })
        .from(roundPlayers)
        .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId)))
        .get();
      if ((countRow?.count ?? 0) >= 4) return 'GROUP_FULL' as const;

      const [newPlayer] = await tx
        .insert(players)
        .values({ name, ghinNumber: null, isActive: 1, isGuest: 1, createdAt: now })
        .returning({ id: players.id });
      if (!newPlayer) throw new Error('Insert returned no row');

      await tx
        .insert(roundPlayers)
        .values({ roundId, playerId: newPlayer.id, groupId, handicapIndex, isSub: 0 });

      return newPlayer.id;
    });

    if (result === 'GROUP_FULL') {
      return c.json({ error: 'Group already has 4 players', code: 'GROUP_FULL' }, 422);
    }
    newPlayerId = result;
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  return c.json({ player: { id: newPlayerId, name, handicapIndex } }, 200);
});

// ---------------------------------------------------------------------------
// DELETE /rounds/:roundId/groups/:groupId/players/:playerId — remove player
// Casual rounds only, before batting order is set. Removes roundPlayers row
// and deletes guest player rows entirely.
// ---------------------------------------------------------------------------

app.delete('/rounds/:roundId/groups/:groupId/players/:playerId', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const groupId = Number(c.req.param('groupId'));
  const playerId = Number(c.req.param('playerId'));

  if (
    !Number.isInteger(roundId) || roundId <= 0 ||
    !Number.isInteger(groupId) || groupId <= 0 ||
    !Number.isInteger(playerId) || playerId <= 0
  ) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  // Fetch round — must be casual and active/scheduled
  let round: { id: number; type: string; status: string } | undefined;
  try {
    round = await db
      .select({ id: rounds.id, type: rounds.type, status: rounds.status })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  if (round.type === 'official') {
    return c.json({ error: 'Can only remove players from casual rounds', code: 'CASUAL_ONLY' }, 422);
  }
  if (round.status === 'finalized' || round.status === 'cancelled') {
    return c.json({ error: 'Round not active', code: 'ROUND_NOT_ACTIVE' }, 422);
  }

  // Fetch group — must belong to round and not have batting order set
  let group: { id: number; battingOrder: string | null } | undefined;
  try {
    group = await db
      .select({ id: groups.id, battingOrder: groups.battingOrder })
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.roundId, roundId)))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
  if (!group) return c.json({ error: 'Group not found', code: 'NOT_FOUND' }, 404);
  if (group.battingOrder) {
    return c.json({ error: 'Cannot remove player after ball draw', code: 'BATTING_ORDER_SET' }, 422);
  }

  // Remove player from group in a transaction
  try {
    await db.transaction(async (tx) => {
      // Verify the player is in this group
      const rp = await tx
        .select({ id: roundPlayers.id })
        .from(roundPlayers)
        .where(and(
          eq(roundPlayers.roundId, roundId),
          eq(roundPlayers.groupId, groupId),
          eq(roundPlayers.playerId, playerId),
        ))
        .get();
      if (!rp) throw new Error('PLAYER_NOT_IN_GROUP');

      // Delete round_players row
      await tx
        .delete(roundPlayers)
        .where(eq(roundPlayers.id, rp.id));

      // If guest player, delete player row too
      const player = await tx
        .select({ isGuest: players.isGuest })
        .from(players)
        .where(eq(players.id, playerId))
        .get();
      if (player?.isGuest) {
        await tx.delete(players).where(eq(players.id, playerId));
      }
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'PLAYER_NOT_IN_GROUP') {
      return c.json({ error: 'Player not in group', code: 'NOT_FOUND' }, 404);
    }
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  return c.json({ ok: true }, 200);
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/players/:playerId/scorecard — public
// Per-hole scorecard: gross, net, stableford, money for a single player.
// ---------------------------------------------------------------------------

app.get('/rounds/:roundId/players/:playerId/scorecard', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  const playerId = Number(c.req.param('playerId'));
  if (!Number.isInteger(roundId) || roundId <= 0 || !Number.isInteger(playerId) || playerId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  // Look up round
  const round = await db
    .select({ autoCalculateMoney: rounds.autoCalculateMoney, tee: rounds.tee })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .get();
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  const roundTee = (round.tee as Tee) ?? 'blue';

  // Look up player in round → get groupId and handicapIndex
  const rp = await db
    .select({ groupId: roundPlayers.groupId, handicapIndex: roundPlayers.handicapIndex })
    .from(roundPlayers)
    .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.playerId, playerId)))
    .get();
  if (!rp) return c.json({ error: 'Player not in round', code: 'NOT_FOUND' }, 404);

  const { groupId, handicapIndex } = rp;

  // Get batting order for the group
  const group = await db
    .select({ battingOrder: groups.battingOrder })
    .from(groups)
    .where(eq(groups.id, groupId))
    .get();
  const battingOrder: number[] = group?.battingOrder ? (JSON.parse(group.battingOrder) as number[]) : [];
  const playerPos = battingOrder.indexOf(playerId); // 0–3; -1 if not in order

  // Fetch all data for the group in parallel
  const [allScores, allDecisions, allHandicaps, playerRow] = await Promise.all([
    db
      .select({
        playerId: holeScores.playerId,
        holeNumber: holeScores.holeNumber,
        grossScore: holeScores.grossScore,
      })
      .from(holeScores)
      .where(and(eq(holeScores.roundId, roundId), eq(holeScores.groupId, groupId))),
    db
      .select({
        holeNumber: wolfDecisions.holeNumber,
        decision: wolfDecisions.decision,
        wolfPlayerId: wolfDecisions.wolfPlayerId,
        partnerPlayerId: wolfDecisions.partnerPlayerId,
        bonusesJson: wolfDecisions.bonusesJson,
      })
      .from(wolfDecisions)
      .where(and(eq(wolfDecisions.roundId, roundId), eq(wolfDecisions.groupId, groupId))),
    db
      .select({ playerId: roundPlayers.playerId, handicapIndex: roundPlayers.handicapIndex })
      .from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.groupId, groupId))),
    db.select({ name: players.name }).from(players).where(eq(players.id, playerId)).get(),
  ]);

  // Build player name map for wolf/partner initials
  const groupPlayerIds = [...new Set([...battingOrder, ...allHandicaps.map((r) => r.playerId)])];
  const groupPlayerRows = groupPlayerIds.length > 0
    ? await db.select({ id: players.id, name: players.name }).from(players).where(inArray(players.id, groupPlayerIds))
    : [];
  const playerNameMap = new Map(groupPlayerRows.map((p) => [p.id, p.name]));

  // Relative handicaps for money calculations ("play off the low man")
  // Convert HI → course handicap first, then subtract lowest
  const allCourseHandicaps = allHandicaps.map((r) => ({
    playerId: r.playerId,
    courseHandicap: calcCourseHandicap(r.handicapIndex, roundTee),
  }));
  const minCH = allCourseHandicaps.length > 0 ? Math.min(...allCourseHandicaps.map((r) => r.courseHandicap)) : 0;
  const relativeHandicapMap = new Map(allCourseHandicaps.map((r) => [r.playerId, r.courseHandicap - minCH]));
  const relativeHI = calcCourseHandicap(handicapIndex, roundTee) - minCH;

  const scoresByHole = new Map<number, Map<number, number>>();
  for (const row of allScores) {
    if (!scoresByHole.has(row.holeNumber)) scoresByHole.set(row.holeNumber, new Map());
    scoresByHole.get(row.holeNumber)!.set(row.playerId, row.grossScore);
  }

  const decisionByHole = new Map(allDecisions.map((r) => [r.holeNumber, r]));

  const canCalcMoney =
    Boolean(round.autoCalculateMoney) && battingOrder.length === 4 && playerPos >= 0;

  const holes: {
    holeNumber: number;
    par: number;
    grossScore: number | null;
    netScore: number | null;
    stablefordPoints: number | null;
    moneyNet: number;
    hasGreenie: boolean;
    hasPolie: boolean;
    relativeStrokes: number;
    wolfDecision: string | null;
    wolfRole: 'wolf' | 'partner' | 'opponent' | null;
    wolfPlayerName: string | null;
    partnerPlayerName: string | null;
  }[] = [];

  for (let holeNum = 1; holeNum <= 18; holeNum++) {
    const holeMap = scoresByHole.get(holeNum);
    const grossScore = holeMap?.get(playerId) ?? null;

    const courseHole = getCourseHole(holeNum as HoleNumber);
    const relStrokes = getHandicapStrokes(relativeHI, courseHole.strokeIndex);

    // Unplayed hole — still include par + stroke dots
    if (grossScore === null) {
      const dec = decisionByHole.get(holeNum);
      let earlyWolfRole: 'wolf' | 'partner' | 'opponent' | null = null;
      if (dec?.decision) {
        if (dec.wolfPlayerId === playerId) earlyWolfRole = 'wolf';
        else if (dec.decision === 'partner' && dec.partnerPlayerId === playerId) earlyWolfRole = 'partner';
        else earlyWolfRole = 'opponent';
      }
      holes.push({ holeNumber: holeNum, par: courseHole.par, grossScore: null, netScore: null, stablefordPoints: null, moneyNet: 0, hasGreenie: false, hasPolie: false, relativeStrokes: relStrokes, wolfDecision: dec?.decision ?? null, wolfRole: earlyWolfRole, wolfPlayerName: dec?.wolfPlayerId ? playerNameMap.get(dec.wolfPlayerId) ?? null : null, partnerPlayerName: dec?.partnerPlayerId ? playerNameMap.get(dec.partnerPlayerId) ?? null : null });
      continue;
    }

    const strokes = getHandicapStrokes(handicapIndex, courseHole.strokeIndex);
    const netScore = grossScore - strokes;
    const stablefordPoints = calculateStablefordPoints(
      grossScore,
      handicapIndex,
      courseHole.par,
      courseHole.strokeIndex,
    );

    let moneyNet = 0;

    if (canCalcMoney && holeMap && holeMap.size >= 4) {
      const grossScores = battingOrder.map((pid) => holeMap.get(pid) ?? 0) as [
        number,
        number,
        number,
        number,
      ];
      // Use relative handicaps for money net scores ("play off the low man")
      const relativeStrokes = getHandicapStrokes(relativeHI, courseHole.strokeIndex);
      const netScores = battingOrder.map((pid, i) => {
        const s = pid === playerId ? relativeStrokes : getHandicapStrokes(relativeHandicapMap.get(pid) ?? 0, courseHole.strokeIndex);
        return grossScores[i]! - s;
      }) as [number, number, number, number];

      const holeAssignment = buildHoleAssignment(holeNum);
      const decisionRecord = decisionByHole.get(holeNum);

      let wolfDecision: WolfDecision | null = null;
      if (holeNum > 2) {
        if (!decisionRecord?.decision) {
          // Wolf hole with no decision recorded yet — push hole with $0 and move on
          holes.push({ holeNumber: holeNum, par: courseHole.par, grossScore, netScore, stablefordPoints, moneyNet: 0, hasGreenie: false, hasPolie: false, relativeStrokes: relStrokes, wolfDecision: null, wolfRole: null, wolfPlayerName: null, partnerPlayerName: null });
          continue;
        }
        wolfDecision = buildWolfDecision(
          decisionRecord.decision,
          decisionRecord.partnerPlayerId,
          battingOrder,
        );
      }

      const base = calculateHoleMoney(netScores, holeAssignment, wolfDecision, courseHole.par);
      // Skins holes (1-2): no bonus modifiers. Wolf holes (3+): always apply.
      let result = base;
      if (holeNum >= 3) {
        const bonusInput = buildBonusInput(decisionRecord?.bonusesJson ?? null, battingOrder);
        result = applyBonusModifiers(base, netScores, grossScores, bonusInput, holeAssignment, wolfDecision, courseHole.par);
      }
      moneyNet = result[playerPos]!.total;
    }

    // Check if this player has a greenie or polie on this hole
    const decRecord = decisionByHole.get(holeNum);
    const bonuses = decRecord?.bonusesJson ? JSON.parse(decRecord.bonusesJson) as { greenies?: number[]; polies?: number[] } : null;
    const hasGreenie = bonuses?.greenies?.includes(playerId) ?? false;
    const hasPolie = bonuses?.polies?.includes(playerId) ?? false;

    const decForHole = decisionByHole.get(holeNum);
    // Determine this player's role on the hole
    let wolfRole: 'wolf' | 'partner' | 'opponent' | null = null;
    if (decForHole?.decision) {
      if (decForHole.wolfPlayerId === playerId) {
        wolfRole = 'wolf';
      } else if (decForHole.decision === 'partner' && decForHole.partnerPlayerId === playerId) {
        wolfRole = 'partner';
      } else {
        wolfRole = 'opponent';
      }
    }
    holes.push({ holeNumber: holeNum, par: courseHole.par, grossScore, netScore, stablefordPoints, moneyNet, hasGreenie, hasPolie, relativeStrokes: relStrokes, wolfDecision: decForHole?.decision ?? null, wolfRole, wolfPlayerName: decForHole?.wolfPlayerId ? playerNameMap.get(decForHole.wolfPlayerId) ?? null : null, partnerPlayerName: decForHole?.partnerPlayerId ? playerNameMap.get(decForHole.partnerPlayerId) ?? null : null });
  }

  // Compute which holes are this player's wolf holes
  const wolfHoles: number[] = [];
  if (playerPos >= 0) {
    for (let h = 3; h <= 18; h++) {
      const assignment = buildHoleAssignment(h);
      if (assignment.type === 'wolf' && assignment.wolfBatterIndex === playerPos) {
        wolfHoles.push(h);
      }
    }
  }

  return c.json({
    playerId,
    playerName: playerRow?.name ?? 'Unknown',
    groupId,
    autoCalculateMoney: Boolean(round.autoCalculateMoney),
    battingPosition: playerPos >= 0 ? playerPos + 1 : null,
    wolfHoles,
    holes,
  });
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/highlights — per-round highlight reel
// ---------------------------------------------------------------------------

type Highlight = {
  emoji: string;
  title: string;
  detail: string;
  category: 'scoring' | 'money' | 'bonus' | 'wolf';
};

app.get('/rounds/:roundId/highlights', async (c) => {
  const roundId = Number(c.req.param('roundId'));

  // Validate round exists and is finalized
  const [round] = await db
    .select({ id: rounds.id, status: rounds.status, scheduledDate: rounds.scheduledDate })
    .from(rounds)
    .where(eq(rounds.id, roundId));
  if (!round) return c.json({ error: 'ROUND_NOT_FOUND' }, 404);
  if (round.status !== 'finalized') return c.json({ highlights: [] });

  // Fetch all data in parallel
  const [playerRows, scoreRows, resultRows, decisionRows] = await Promise.all([
    db.select({
      playerId: roundPlayers.playerId,
      name: players.name,
      handicapIndex: roundPlayers.handicapIndex,
      groupId: roundPlayers.groupId,
    })
    .from(roundPlayers)
    .innerJoin(players, eq(players.id, roundPlayers.playerId))
    .where(eq(roundPlayers.roundId, roundId)),

    db.select({
      playerId: holeScores.playerId,
      holeNumber: holeScores.holeNumber,
      grossScore: holeScores.grossScore,
    })
    .from(holeScores)
    .where(eq(holeScores.roundId, roundId)),

    db.select({
      playerId: roundResults.playerId,
      stablefordTotal: roundResults.stablefordTotal,
      moneyTotal: roundResults.moneyTotal,
    })
    .from(roundResults)
    .where(eq(roundResults.roundId, roundId)),

    db.select({
      holeNumber: wolfDecisions.holeNumber,
      wolfPlayerId: wolfDecisions.wolfPlayerId,
      decision: wolfDecisions.decision,
      outcome: wolfDecisions.outcome,
      bonusesJson: wolfDecisions.bonusesJson,
    })
    .from(wolfDecisions)
    .where(eq(wolfDecisions.roundId, roundId)),
  ]);

  const nameMap = new Map(playerRows.map((p) => [p.playerId, p.name]));
  const hiMap = new Map(playerRows.map((p) => [p.playerId, p.handicapIndex]));
  const highlights: Highlight[] = [];

  // --- Biggest money winner ---
  if (resultRows.length > 0) {
    const best = resultRows.reduce((a, b) => (b.moneyTotal > a.moneyTotal ? b : a));
    if (best.moneyTotal > 0) {
      highlights.push({
        emoji: '💰',
        title: 'Big Winner',
        detail: `${nameMap.get(best.playerId)} walked away +$${best.moneyTotal}`,
        category: 'money',
      });
    }

    // --- Biggest money loser ---
    const worst = resultRows.reduce((a, b) => (b.moneyTotal < a.moneyTotal ? b : a));
    if (worst.moneyTotal < 0) {
      highlights.push({
        emoji: '🕳️',
        title: 'Deepest Hole',
        detail: `${nameMap.get(worst.playerId)} dropped -$${Math.abs(worst.moneyTotal)}`,
        category: 'money',
      });
    }
  }

  // --- Most stableford points ---
  if (resultRows.length > 0) {
    const best = resultRows.reduce((a, b) => (b.stablefordTotal > a.stablefordTotal ? b : a));
    highlights.push({
      emoji: '⭐',
      title: 'Points Leader',
      detail: `${nameMap.get(best.playerId)} with ${best.stablefordTotal} stableford points`,
      category: 'scoring',
    });
  }

  // --- Best single hole (highest stableford on one hole) ---
  let bestHoleScore: { playerId: number; hole: number; points: number; gross: number; par: number } | null = null;
  for (const row of scoreRows) {
    const hi = hiMap.get(row.playerId) ?? 0;
    const ch = getCourseHole(row.holeNumber as Parameters<typeof getCourseHole>[0]);
    const pts = calculateStablefordPoints(row.grossScore, hi, ch.par, ch.strokeIndex);
    if (!bestHoleScore || pts > bestHoleScore.points || (pts === bestHoleScore.points && row.grossScore < bestHoleScore.gross)) {
      bestHoleScore = { playerId: row.playerId, hole: row.holeNumber, points: pts, gross: row.grossScore, par: ch.par };
    }
  }
  if (bestHoleScore && bestHoleScore.points >= 4) {
    const diff = bestHoleScore.gross - bestHoleScore.par;
    const shotName = diff <= -2 ? 'Eagle' : diff === -1 ? 'Birdie' : 'Net masterpiece';
    highlights.push({
      emoji: '🎯',
      title: `${bestHoleScore.points} Points on One Hole`,
      detail: `${nameMap.get(bestHoleScore.playerId)} — ${shotName} on Hole ${bestHoleScore.hole} (Par ${bestHoleScore.par})`,
      category: 'scoring',
    });
  }

  // --- Eagles and birdies ---
  const birdies: { playerId: number; hole: number; par: number; gross: number }[] = [];
  const eagles: { playerId: number; hole: number; par: number; gross: number }[] = [];
  for (const row of scoreRows) {
    const ch = getCourseHole(row.holeNumber as Parameters<typeof getCourseHole>[0]);
    const diff = row.grossScore - ch.par;
    if (diff <= -2) {
      eagles.push({ playerId: row.playerId, hole: row.holeNumber, par: ch.par, gross: row.grossScore });
    } else if (diff === -1) {
      birdies.push({ playerId: row.playerId, hole: row.holeNumber, par: ch.par, gross: row.grossScore });
    }
  }

  for (const e of eagles) {
    highlights.push({
      emoji: '🦅',
      title: 'Eagle!',
      detail: `${nameMap.get(e.playerId)} — ${e.gross} on Hole ${e.hole} (Par ${e.par})`,
      category: 'scoring',
    });
  }

  if (birdies.length > 0) {
    if (birdies.length === 1) {
      const b = birdies[0]!;
      highlights.push({
        emoji: '🐦',
        title: 'Birdie',
        detail: `${nameMap.get(b.playerId)} — ${b.gross} on Hole ${b.hole} (Par ${b.par})`,
        category: 'scoring',
      });
    } else {
      // Group by player
      const byPlayer = new Map<number, number>();
      for (const b of birdies) byPlayer.set(b.playerId, (byPlayer.get(b.playerId) ?? 0) + 1);
      const entries = [...byPlayer.entries()].sort((a, b) => b[1] - a[1]);
      const parts = entries.map(([pid, count]) => `${nameMap.get(pid)} ×${count}`);
      highlights.push({
        emoji: '🐦',
        title: `${birdies.length} Birdies`,
        detail: parts.join(', '),
        category: 'scoring',
      });
    }
  }

  // --- Greenies and polies ---
  const greenieCount = new Map<number, number>();
  const polieCount = new Map<number, number>();
  for (const dec of decisionRows) {
    if (!dec.bonusesJson) continue;
    try {
      const parsed = JSON.parse(dec.bonusesJson) as { greenies?: number[]; polies?: number[] };
      for (const pid of parsed.greenies ?? []) greenieCount.set(pid, (greenieCount.get(pid) ?? 0) + 1);
      for (const pid of parsed.polies ?? []) polieCount.set(pid, (polieCount.get(pid) ?? 0) + 1);
    } catch { /* skip malformed */ }
  }

  const totalGreenies = [...greenieCount.values()].reduce((a, b) => a + b, 0);
  if (totalGreenies > 0) {
    const best = [...greenieCount.entries()].sort((a, b) => b[1] - a[1]);
    if (totalGreenies === 1) {
      highlights.push({
        emoji: '🟢',
        title: 'Greenie',
        detail: `${nameMap.get(best[0]![0])} found the green`,
        category: 'bonus',
      });
    } else {
      const parts = best.map(([pid, count]) => `${nameMap.get(pid)} ×${count}`);
      highlights.push({
        emoji: '🟢',
        title: `${totalGreenies} Greenies`,
        detail: parts.join(', '),
        category: 'bonus',
      });
    }
  }

  const totalPolies = [...polieCount.values()].reduce((a, b) => a + b, 0);
  if (totalPolies > 0) {
    const best = [...polieCount.entries()].sort((a, b) => b[1] - a[1]);
    if (totalPolies === 1) {
      highlights.push({
        emoji: '🎱',
        title: 'Poly!',
        detail: `${nameMap.get(best[0]![0])} drained it`,
        category: 'bonus',
      });
    } else {
      const parts = best.map(([pid, count]) => `${nameMap.get(pid)} ×${count}`);
      highlights.push({
        emoji: '🎱',
        title: `${totalPolies} Polies`,
        detail: parts.join(', '),
        category: 'bonus',
      });
    }
  }

  // --- Lone wolf wins ---
  // Only highlight blind wolf wins (always special) or players with 2+ lone wolf wins
  // (everyone is required to go wolf once, so a single win isn't noteworthy)
  const blindWolfWins: { playerId: number; hole: number }[] = [];
  const loneWolfWinsByPlayer = new Map<number, number[]>(); // playerId → holes
  for (const dec of decisionRows) {
    if ((dec.decision === 'alone' || dec.decision === 'blind_wolf') && dec.outcome === 'win' && dec.wolfPlayerId) {
      if (dec.decision === 'blind_wolf') {
        blindWolfWins.push({ playerId: dec.wolfPlayerId, hole: dec.holeNumber });
      }
      const holes = loneWolfWinsByPlayer.get(dec.wolfPlayerId) ?? [];
      holes.push(dec.holeNumber);
      loneWolfWinsByPlayer.set(dec.wolfPlayerId, holes);
    }
  }

  // Blind wolf wins are always highlighted individually
  for (const bw of blindWolfWins) {
    highlights.push({
      emoji: '😎',
      title: 'Blind Wolf Victory',
      detail: `${nameMap.get(bw.playerId)} went blind on Hole ${bw.hole} and won`,
      category: 'wolf',
    });
  }

  // Players with 2+ lone wolf wins get a combined highlight
  for (const [pid, holes] of loneWolfWinsByPlayer) {
    // Exclude blind wolf holes already highlighted
    const _nonBlindHoles = holes.filter((h) => !blindWolfWins.some((bw) => bw.playerId === pid && bw.hole === h));
    const totalWins = holes.length;
    if (totalWins >= 2) {
      highlights.push({
        emoji: '🐺',
        title: `${totalWins} Lone Wolf Wins`,
        detail: `${nameMap.get(pid)} dominated going solo (Holes ${holes.join(', ')})`,
        category: 'wolf',
      });
    }
  }

  // --- Sandbagger alert: net-to-par ≤ -4 ---
  // Compute net-to-par per player from gross scores and handicap strokes
  const grossByPlayer = new Map<number, { gross: number; par: number; holes: number }>();
  for (const row of scoreRows) {
    const ch = getCourseHole(row.holeNumber as Parameters<typeof getCourseHole>[0]);
    const entry = grossByPlayer.get(row.playerId) ?? { gross: 0, par: 0, holes: 0 };
    entry.gross += row.grossScore;
    entry.par += ch.par;
    entry.holes += 1;
    grossByPlayer.set(row.playerId, entry);
  }

  for (const [pid, totals] of grossByPlayer) {
    if (totals.holes < 18) continue; // only full rounds
    const hi = hiMap.get(pid) ?? 0;
    const courseHandicap = Math.round(hi); // simplified — CH ≈ HI for net-to-par check
    const netToPar = totals.gross - courseHandicap - totals.par;
    if (netToPar <= -4) {
      highlights.push({
        emoji: '🔥',
        title: 'Round of the Day',
        detail: `${nameMap.get(pid)} went ${netToPar} net — absolutely dialed in`,
        category: 'scoring',
      });
    }
  }

  return c.json({ highlights });
});

export default app;
