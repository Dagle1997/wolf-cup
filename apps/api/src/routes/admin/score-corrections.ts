import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import {
  getCourseHole,
  calculateStablefordPoints,
  calculateHoleMoney,
  calculateHarveyPoints,
  applyBonusModifiers,
  getHandicapStrokes,
  getWolfAssignment,
  calcCourseHandicap,
} from '@wolf-cup/engine';
import type { HoleNumber, WolfDecision, HoleAssignment, BonusInput, BattingPosition } from '@wolf-cup/engine';
import type { Tee } from '@wolf-cup/engine';
import { db } from '../../db/index.js';
import {
  admins,
  rounds,
  groups,
  players,
  roundPlayers,
  holeScores,
  roundResults,
  wolfDecisions,
  scoreCorrections,
  harveyResults,
} from '../../db/schema.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import { createScoreCorrectionSchema } from '../../schemas/score-correction.js';
import { computeSideGameWinnerForRound } from '../../lib/side-game-calc-db.js';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

const PAR3_HOLES = new Set([6, 7, 12, 15]);

// ---------------------------------------------------------------------------
// Harvey recomputation after score corrections
// ---------------------------------------------------------------------------

/** Group-size bonus per player for Harvey points. */
function harveyBonus(playerCount: number): number {
  const lookup: Record<number, number> = { 1: 8, 2: 6, 3: 4, 4: 2 };
  return lookup[Math.floor(playerCount / 4)] ?? 0;
}

/** Recompute and store Harvey points for a round (after score correction). */
async function recomputeHarvey(roundId: number): Promise<void> {
  const results = await db
    .select({
      playerId: roundResults.playerId,
      stablefordTotal: roundResults.stablefordTotal,
      moneyTotal: roundResults.moneyTotal,
    })
    .from(roundResults)
    .where(eq(roundResults.roundId, roundId));

  if (results.length === 0) return;

  const harveyInput = results.map((r) => ({
    stableford: r.stablefordTotal,
    money: r.moneyTotal,
  }));

  const bonusPerPlayer = harveyBonus(results.length);
  const harveyOutput = calculateHarveyPoints(harveyInput, 'regular', bonusPerPlayer);
  const now = Date.now();

  // Tie-aware ranks
  const stablefordSorted = [...results].sort((a, b) => b.stablefordTotal - a.stablefordTotal);
  const moneySorted = [...results].sort((a, b) => b.moneyTotal - a.moneyTotal);

  function tieRank(sorted: typeof results, playerId: number, key: 'stablefordTotal' | 'moneyTotal'): number {
    const idx = sorted.findIndex((r) => r.playerId === playerId);
    // Walk back to find first player with this same value
    const val = sorted[idx]![key];
    let rank = idx + 1;
    while (rank > 1 && sorted[rank - 2]![key] === val) rank--;
    return rank;
  }

  for (let i = 0; i < results.length; i++) {
    const player = results[i]!;
    const harvey = harveyOutput[i]!;
    const stablefordRank = tieRank(stablefordSorted, player.playerId, 'stablefordTotal');
    const moneyRank = tieRank(moneySorted, player.playerId, 'moneyTotal');

    await db
      .insert(harveyResults)
      .values({
        roundId,
        playerId: player.playerId,
        stablefordRank,
        moneyRank,
        stablefordPoints: harvey.stablefordPoints,
        moneyPoints: harvey.moneyPoints,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [harveyResults.roundId, harveyResults.playerId],
        set: {
          stablefordRank,
          moneyRank,
          stablefordPoints: harvey.stablefordPoints,
          moneyPoints: harvey.moneyPoints,
          updatedAt: now,
        },
      });
  }
}

// ---------------------------------------------------------------------------
// Scoring helpers (mirrored from rounds.ts)
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
  if (!bonusesJson) return { greenies: [], polies: [], sandies: [] };
  const { greenies = [], polies = [], sandies = [] } = JSON.parse(bonusesJson) as {
    greenies?: number[];
    polies?: number[];
    sandies?: number[];
  };
  return {
    greenies: greenies.map((id) => battingOrder.indexOf(id) as BattingPosition).filter((p) => p >= 0),
    polies: polies.map((id) => battingOrder.indexOf(id) as BattingPosition).filter((p) => p >= 0),
    sandies: sandies.map((id) => battingOrder.indexOf(id) as BattingPosition).filter((p) => p >= 0),
  };
}

// ---------------------------------------------------------------------------
// rescoreGroup — recalculate Stableford + money and write to round_results
// ---------------------------------------------------------------------------

async function rescoreGroup(roundId: number, groupId: number, tee: Tee = 'blue'): Promise<void> {
  const group = await db
    .select({ battingOrder: groups.battingOrder })
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.roundId, roundId)))
    .get();
  if (!group?.battingOrder) return;
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

  // Stableford uses full HI; money uses relative course handicaps ("play off the low man")
  const fullHandicapMap = new Map(handicapRows.map((r) => [r.playerId, r.handicapIndex]));
  const courseHandicaps = handicapRows.map((r) => ({
    playerId: r.playerId,
    courseHandicap: calcCourseHandicap(r.handicapIndex, tee),
  }));
  const minCH = Math.min(...courseHandicaps.map((r) => r.courseHandicap));
  const handicapMap = new Map(courseHandicaps.map((r) => [r.playerId, r.courseHandicap - minCH]));

  // Recalculate Stableford
  const stablefordTotals = new Map<number, number>();
  for (const row of allScoresRows) {
    const hi = fullHandicapMap.get(row.playerId) ?? 0;
    const courseHole = getCourseHole(row.holeNumber as HoleNumber);
    const points = calculateStablefordPoints(row.grossScore, hi, courseHole.par, courseHole.strokeIndex);
    stablefordTotals.set(row.playerId, (stablefordTotals.get(row.playerId) ?? 0) + points);
  }

  // Recalculate money
  const scoresByHole = new Map<number, Map<number, number>>();
  for (const row of allScoresRows) {
    if (!scoresByHole.has(row.holeNumber)) scoresByHole.set(row.holeNumber, new Map());
    scoresByHole.get(row.holeNumber)!.set(row.playerId, row.grossScore);
  }
  const decisionByHole = new Map(allDecisionRows.map((r) => [r.holeNumber, r]));
  const moneyTotals = new Map<number, number>();

  for (let holeNum = 1; holeNum <= 18; holeNum++) {
    const holeMap = scoresByHole.get(holeNum);
    if (!holeMap || holeMap.size < 4) continue;

    const courseHole = getCourseHole(holeNum as HoleNumber);
    const grossScores = battingOrder.map((pid) => holeMap.get(pid) ?? 0) as [number, number, number, number];
    const netScores = battingOrder.map((pid, i) => {
      const strokes = getHandicapStrokes(handicapMap.get(pid) ?? 0, courseHole.strokeIndex);
      return grossScores[i]! - strokes;
    }) as [number, number, number, number];

    const holeAssignment = buildHoleAssignment(holeNum);
    const decisionRecord = decisionByHole.get(holeNum);

    let wolfDecision: WolfDecision | null = null;
    if (holeAssignment.type === 'wolf') {
      if (!decisionRecord?.decision) continue;
      wolfDecision = buildWolfDecision(decisionRecord.decision, decisionRecord.partnerPlayerId, battingOrder);
    }

    const base = calculateHoleMoney(netScores, holeAssignment, wolfDecision, courseHole.par);
    // Wolf holes: always apply bonus modifiers (birdie/eagle/double-birdie are score-detected)
    let result = base;
    if (holeAssignment.type === 'wolf') {
      const bonusInput = buildBonusInput(decisionRecord?.bonusesJson ?? null, battingOrder);
      result = applyBonusModifiers(base, netScores, grossScores, bonusInput, holeAssignment, wolfDecision, courseHole.par);
    }

    for (let pos = 0; pos < 4; pos++) {
      const pid = battingOrder[pos]!;
      moneyTotals.set(pid, (moneyTotals.get(pid) ?? 0) + result[pos]!.total);
    }

    // Write wolf outcome for non-skins holes
    if (holeAssignment.type === 'wolf') {
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

  // Upsert round_results
  const now = Date.now();
  const allPlayerIds = new Set([...stablefordTotals.keys(), ...moneyTotals.keys()]);
  for (const pid of allPlayerIds) {
    await db
      .insert(roundResults)
      .values({
        roundId,
        playerId: pid,
        stablefordTotal: stablefordTotals.get(pid) ?? 0,
        moneyTotal: moneyTotals.get(pid) ?? 0,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [roundResults.roundId, roundResults.playerId],
        set: {
          stablefordTotal: stablefordTotals.get(pid) ?? 0,
          moneyTotal: moneyTotals.get(pid) ?? 0,
          updatedAt: now,
        },
      });
  }
}

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/corrections
// ---------------------------------------------------------------------------

app.post('/rounds/:roundId/corrections', adminAuthMiddleware, async (c) => {
  const roundId = Number(c.req.param('roundId'));
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'VALIDATION_ERROR' }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const result = createScoreCorrectionSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  const round = await db
    .select({ id: rounds.id, status: rounds.status, tee: rounds.tee, seasonId: rounds.seasonId })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .get();
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  if (round.status !== 'finalized') {
    return c.json({ error: 'Round is not finalized', code: 'ROUND_NOT_FINALIZED' }, 422);
  }

  const { holeNumber, fieldName, playerId, groupId, newValue } = result.data;
  const adminUserId = c.get('adminId' as never) as number;
  let oldValue: string;
  let rescoreGroupId: number | null = null;
  let auditNewValue = newValue;

  // -------------------------------------------------------------------------
  if (fieldName === 'grossScore') {
    const row = await db
      .select({ grossScore: holeScores.grossScore, id: holeScores.id, groupId: holeScores.groupId })
      .from(holeScores)
      .where(
        and(
          eq(holeScores.roundId, roundId),
          eq(holeScores.playerId, playerId!),
          eq(holeScores.holeNumber, holeNumber),
        ),
      )
      .get();
    if (!row) return c.json({ error: 'Score not found', code: 'NOT_FOUND' }, 404);

    const parsed = Number(newValue);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 9) {
      return c.json({
        error: 'Validation error', code: 'VALIDATION_ERROR',
        issues: [{ message: 'grossScore must be an integer 1–9' }],
      }, 400);
    }

    oldValue = String(row.grossScore);
    await db.update(holeScores).set({ grossScore: parsed, updatedAt: Date.now() }).where(eq(holeScores.id, row.id));
    rescoreGroupId = row.groupId;

  // -------------------------------------------------------------------------
  } else if (fieldName === 'wolfDecision') {
    const row = await db
      .select({ decision: wolfDecisions.decision, id: wolfDecisions.id, groupId: wolfDecisions.groupId })
      .from(wolfDecisions)
      .where(
        and(
          eq(wolfDecisions.roundId, roundId),
          eq(wolfDecisions.groupId, groupId!),
          eq(wolfDecisions.holeNumber, holeNumber),
        ),
      )
      .get();
    if (!row) return c.json({ error: 'Wolf decision not found', code: 'NOT_FOUND' }, 404);

    const validDecisions = ['alone', 'partner', 'blind_wolf'];
    if (!validDecisions.includes(newValue)) {
      return c.json({
        error: 'Validation error', code: 'VALIDATION_ERROR',
        issues: [{ message: 'wolfDecision must be alone, partner, or blind_wolf' }],
      }, 400);
    }

    oldValue = row.decision ?? '';
    await db.update(wolfDecisions).set({ decision: newValue }).where(eq(wolfDecisions.id, row.id));
    rescoreGroupId = row.groupId;

  // -------------------------------------------------------------------------
  } else if (fieldName === 'wolfPartnerId') {
    const row = await db
      .select({ partnerPlayerId: wolfDecisions.partnerPlayerId, id: wolfDecisions.id, groupId: wolfDecisions.groupId })
      .from(wolfDecisions)
      .where(
        and(
          eq(wolfDecisions.roundId, roundId),
          eq(wolfDecisions.groupId, groupId!),
          eq(wolfDecisions.holeNumber, holeNumber),
        ),
      )
      .get();
    if (!row) return c.json({ error: 'Wolf decision not found', code: 'NOT_FOUND' }, 404);

    let newPartnerId: number | null;
    if (newValue === 'null') {
      newPartnerId = null;
    } else {
      const parsed = Number(newValue);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return c.json({
          error: 'Validation error', code: 'VALIDATION_ERROR',
          issues: [{ message: 'wolfPartnerId must be a positive integer or null' }],
        }, 400);
      }
      const playerRow = await db.select({ id: players.id }).from(players).where(eq(players.id, parsed)).get();
      if (!playerRow) return c.json({ error: 'Player not found', code: 'NOT_FOUND' }, 404);
      newPartnerId = parsed;
    }

    oldValue = row.partnerPlayerId !== null ? String(row.partnerPlayerId) : 'null';
    await db.update(wolfDecisions).set({ partnerPlayerId: newPartnerId }).where(eq(wolfDecisions.id, row.id));
    rescoreGroupId = row.groupId;

  // -------------------------------------------------------------------------
  } else if (fieldName === 'greenie' || fieldName === 'polie' || fieldName === 'sandie') {
    if (fieldName === 'greenie' && !PAR3_HOLES.has(holeNumber)) {
      return c.json({ error: 'Greenie only valid on par-3 holes (6, 7, 12, 15)', code: 'VALIDATION_ERROR' }, 422);
    }
    if (newValue !== 'add' && newValue !== 'remove') {
      return c.json({
        error: 'Validation error', code: 'VALIDATION_ERROR',
        issues: [{ message: 'newValue must be "add" or "remove"' }],
      }, 400);
    }

    const row = await db
      .select({ id: wolfDecisions.id, bonusesJson: wolfDecisions.bonusesJson, groupId: wolfDecisions.groupId })
      .from(wolfDecisions)
      .where(
        and(
          eq(wolfDecisions.roundId, roundId),
          eq(wolfDecisions.groupId, groupId!),
          eq(wolfDecisions.holeNumber, holeNumber),
        ),
      )
      .get();
    if (!row) return c.json({ error: 'Wolf decision not found for this hole/group', code: 'NOT_FOUND' }, 404);

    const bonuses = row.bonusesJson
      ? (JSON.parse(row.bonusesJson) as { greenies?: number[]; polies?: number[]; sandies?: number[] })
      : { greenies: [], polies: [], sandies: [] };
    const arr =
      fieldName === 'greenie' ? (bonuses.greenies ?? [])
        : fieldName === 'polie' ? (bonuses.polies ?? [])
        : (bonuses.sandies ?? []);
    oldValue = JSON.stringify(arr);

    const newArr = newValue === 'add'
      ? (arr.includes(playerId!) ? arr : [...arr, playerId!])
      : arr.filter((id) => id !== playerId!);

    if (fieldName === 'greenie') bonuses.greenies = newArr;
    else if (fieldName === 'polie') bonuses.polies = newArr;
    else bonuses.sandies = newArr;

    const newBonusesJson = ((bonuses.greenies?.length ?? 0) > 0 || (bonuses.polies?.length ?? 0) > 0 || (bonuses.sandies?.length ?? 0) > 0)
      ? JSON.stringify(bonuses)
      : null;

    await db.update(wolfDecisions).set({ bonusesJson: newBonusesJson }).where(eq(wolfDecisions.id, row.id));
    auditNewValue = JSON.stringify(newArr);
    rescoreGroupId = row.groupId;

  // -------------------------------------------------------------------------
  } else if (fieldName === 'putts') {
    const row = await db
      .select({ putts: holeScores.putts, id: holeScores.id, groupId: holeScores.groupId })
      .from(holeScores)
      .where(
        and(
          eq(holeScores.roundId, roundId),
          eq(holeScores.playerId, playerId!),
          eq(holeScores.holeNumber, holeNumber),
        ),
      )
      .get();
    if (!row) return c.json({ error: 'Score not found', code: 'NOT_FOUND' }, 404);

    const parsed = Number(newValue);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9) {
      return c.json({
        error: 'Validation error', code: 'VALIDATION_ERROR',
        issues: [{ message: 'putts must be an integer 0–9' }],
      }, 400);
    }

    oldValue = row.putts !== null ? String(row.putts) : 'null';
    await db.update(holeScores).set({ putts: parsed, updatedAt: Date.now() }).where(eq(holeScores.id, row.id));
    rescoreGroupId = row.groupId;

  // -------------------------------------------------------------------------
  } else {
    // handicapIndex — holeNumber is 0 (round-wide sentinel)
    const rpRow = await db
      .select({ handicapIndex: roundPlayers.handicapIndex, groupId: roundPlayers.groupId })
      .from(roundPlayers)
      .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.playerId, playerId!)))
      .get();
    if (!rpRow) return c.json({ error: 'Player not in this round', code: 'NOT_FOUND' }, 404);

    const newHI = Number(newValue);
    if (isNaN(newHI) || newHI < 0 || newHI > 54) {
      return c.json({
        error: 'Validation error', code: 'VALIDATION_ERROR',
        issues: [{ message: 'handicapIndex must be between 0 and 54' }],
      }, 400);
    }

    oldValue = String(rpRow.handicapIndex);
    await db
      .update(roundPlayers)
      .set({ handicapIndex: newHI })
      .where(and(eq(roundPlayers.roundId, roundId), eq(roundPlayers.playerId, playerId!)));
    rescoreGroupId = rpRow.groupId;
  }

  // Rescore the affected group, recompute Harvey, then write audit log
  await rescoreGroup(roundId, rescoreGroupId!, (round.tee as Tee) ?? 'blue');

  // Recompute Harvey points since round_results changed
  try {
    await recomputeHarvey(roundId);
  } catch (err) {
    console.error('Failed to recompute Harvey after correction:', err);
    return c.json({ error: 'Correction applied but Harvey recomputation failed', code: 'INTERNAL_ERROR' }, 500);
  }

  // Recompute side game results (non-fatal)
  try {
    const roundTee = (round.tee as Tee) ?? 'blue';
    await computeSideGameWinnerForRound(roundId, round.seasonId, roundTee);
  } catch (err) {
    console.error('Failed to recompute side game after correction (non-fatal):', err);
  }

  const [correction] = await db
    .insert(scoreCorrections)
    .values({
      adminUserId,
      roundId,
      holeNumber,
      playerId: playerId ?? null,
      fieldName,
      oldValue,
      newValue: auditNewValue,
      correctedAt: Date.now(),
    })
    .returning();

  return c.json({ correction }, 201);
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/corrections — enriched with adminUsername + playerName
// ---------------------------------------------------------------------------

app.get('/rounds/:roundId/corrections', adminAuthMiddleware, async (c) => {
  const roundId = Number(c.req.param('roundId'));
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'VALIDATION_ERROR' }, 400);
  }

  const round = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .get();
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);

  const rawItems = await db
    .select()
    .from(scoreCorrections)
    .where(eq(scoreCorrections.roundId, roundId))
    .orderBy(desc(scoreCorrections.correctedAt));

  if (rawItems.length === 0) return c.json({ items: [] }, 200);

  // Resolve admin usernames
  const adminIds = [...new Set(rawItems.map((r) => r.adminUserId))];
  const adminMap = new Map<number, string>();
  for (const adminId of adminIds) {
    const row = await db.select({ username: admins.username }).from(admins).where(eq(admins.id, adminId)).get();
    if (row) adminMap.set(adminId, row.username);
  }

  // Resolve player names
  const playerIds = [...new Set(rawItems.filter((r) => r.playerId !== null).map((r) => r.playerId!))];
  const playerMap = new Map<number, string>();
  for (const pid of playerIds) {
    const row = await db.select({ name: players.name }).from(players).where(eq(players.id, pid)).get();
    if (row) playerMap.set(pid, row.name);
  }

  const items = rawItems.map((r) => ({
    ...r,
    adminUsername: adminMap.get(r.adminUserId) ?? 'unknown',
    playerName: r.playerId !== null ? (playerMap.get(r.playerId) ?? null) : null,
  }));

  return c.json({ items }, 200);
});

export default app;
