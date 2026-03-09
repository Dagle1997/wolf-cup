import { Hono } from 'hono';
import { eq, and, gte, lte, inArray, desc, asc, sql } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import {
  getWolfAssignment,
  getCourseHole,
  calculateStablefordPoints,
  calculateHoleMoney,
  applyBonusModifiers,
  getHandicapStrokes,
} from '@wolf-cup/engine';
import type { HoleNumber, WolfDecision, HoleAssignment, BonusInput, BattingPosition } from '@wolf-cup/engine';
import { db } from '../db/index.js';
import { rounds, groups, roundPlayers, players, holeScores, roundResults, wolfDecisions, seasons, harveyResults } from '../db/schema.js';
import { battingOrderSchema, submitHoleScoresSchema, wolfDecisionSchema, addGuestSchema, createPracticeRoundSchema } from '../schemas/round.js';

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
  if (holeNumber <= 2) return { type: 'skins' };
  const wolfBatterIndex = ((holeNumber - 3) % 4) as BattingPosition;
  return { type: 'wolf', wolfBatterIndex };
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

async function recalculateMoney(roundId: number, groupId: number): Promise<Map<number, number>> {
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

  // Relative handicaps: subtract group's lowest HI ("play off the low man")
  const minHI = Math.min(...handicapRows.map((r) => r.handicapIndex));
  const handicapMap = new Map(handicapRows.map((r) => [r.playerId, r.handicapIndex - minHI]));

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
      type: rounds.type,
      status: rounds.status,
      scheduledDate: rounds.scheduledDate,
      autoCalculateMoney: rounds.autoCalculateMoney,
    })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .get();

  if (!round) return null;

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

  return {
    id: round.id,
    type: round.type,
    status: round.status,
    scheduledDate: round.scheduledDate,
    autoCalculateMoney: Boolean(round.autoCalculateMoney),
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
// GET /rounds — list scheduled/active rounds within ±1-day window of today
// ---------------------------------------------------------------------------

app.get('/rounds', async (c) => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  try {
    const rows = await db
      .select({
        id: rounds.id,
        type: rounds.type,
        status: rounds.status,
        scheduledDate: rounds.scheduledDate,
        autoCalculateMoney: rounds.autoCalculateMoney,
      })
      .from(rounds)
      .where(
        and(
          gte(rounds.scheduledDate, yesterday),
          lte(rounds.scheduledDate, tomorrow),
          inArray(rounds.status, ['scheduled', 'active']),
        ),
      )
      .orderBy(desc(rounds.scheduledDate));

    const items = rows.map((r) => ({
      ...r,
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
  let round: { id: number; type: string; status: string; entryCodeHash: string | null } | undefined;
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
    const wolfBatterIndex = (holeNumber - 3) % 4;
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
    playerMoneyTotals = await recalculateMoney(roundId, groupId);
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
    .select({ autoCalculateMoney: rounds.autoCalculateMoney })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .get();
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);

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

  const handicapMap = new Map(allHandicaps.map((r) => [r.playerId, r.handicapIndex]));

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
    grossScore: number;
    netScore: number;
    stablefordPoints: number;
    moneyNet: number;
  }[] = [];

  for (let holeNum = 1; holeNum <= 18; holeNum++) {
    const holeMap = scoresByHole.get(holeNum);
    const grossScore = holeMap?.get(playerId);
    if (grossScore === undefined) continue; // hole not yet played

    const courseHole = getCourseHole(holeNum as HoleNumber);
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
      const netScores = battingOrder.map((pid, i) => {
        // Reuse already-computed strokes for the target player; compute for all others
        const s = pid === playerId ? strokes : getHandicapStrokes(handicapMap.get(pid) ?? 0, courseHole.strokeIndex);
        return grossScores[i]! - s;
      }) as [number, number, number, number];

      const holeAssignment = buildHoleAssignment(holeNum);
      const decisionRecord = decisionByHole.get(holeNum);

      let wolfDecision: WolfDecision | null = null;
      if (holeNum > 2) {
        if (!decisionRecord?.decision) {
          // Wolf hole with no decision recorded yet — push hole with $0 and move on
          holes.push({ holeNumber: holeNum, par: courseHole.par, grossScore, netScore, stablefordPoints, moneyNet: 0 });
          continue;
        }
        wolfDecision = buildWolfDecision(
          decisionRecord.decision,
          decisionRecord.partnerPlayerId,
          battingOrder,
        );
      }

      const bonusInput = buildBonusInput(decisionRecord?.bonusesJson ?? null, battingOrder);
      const base = calculateHoleMoney(netScores, holeAssignment, wolfDecision, courseHole.par);
      const result =
        bonusInput.greenies.length > 0 || bonusInput.polies.length > 0
          ? applyBonusModifiers(
              base,
              netScores,
              grossScores,
              bonusInput,
              holeAssignment,
              wolfDecision,
              courseHole.par,
            )
          : base;
      moneyNet = result[playerPos]!.total;
    }

    holes.push({ holeNumber: holeNum, par: courseHole.par, grossScore, netScore, stablefordPoints, moneyNet });
  }

  return c.json({
    playerId,
    playerName: playerRow?.name ?? 'Unknown',
    groupId,
    autoCalculateMoney: Boolean(round.autoCalculateMoney),
    holes,
  });
});

export default app;
