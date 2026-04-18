/**
 * Per-round money-breakdown helper — exposes per-hole and per-player
 * money attribution decomposed into skins / wolfSettlement / bonuses buckets.
 *
 * SIDE-EFFECT-FREE. Unlike `recalculateMoney()` in rounds.ts which also
 * writes `wolf_decisions.outcome` as part of its loop, this helper is a
 * read-only computation for consumers that need to aggregate money across
 * groups (highlights, stats rivals).
 *
 * Consumer-of-note: highlight reel (Pack Leader / Fed to the Pack / Biggest
 * Wolf Win / Loss) and the per-player-per-hole rival aggregator (B.8).
 */

import { eq } from 'drizzle-orm';
import {
  getWolfAssignment,
  getCourseHole,
  calculateHoleMoney,
  applyBonusModifiers,
  getHandicapStrokes,
  calcCourseHandicap,
} from '@wolf-cup/engine';
import type {
  HoleNumber,
  WolfDecision,
  HoleAssignment,
  BonusInput,
  BattingPosition,
  Tee,
} from '@wolf-cup/engine';
import { db } from '../db/index.js';
import { rounds, groups, roundPlayers, holeScores, wolfDecisions } from '../db/schema.js';

export type HoleMoneyBreakdown = {
  holeNumber: number;
  groupId: number;
  holeType: 'skins' | 'wolf';
  wolfPlayerId: number | null;      // null on skins holes
  partnerPlayerId: number | null;   // null on skins, alone, blind_wolf
  decision: 'alone' | 'partner' | 'blind_wolf' | null; // null on skins holes
  // playerId → { skins, wolfSettlement, bonuses, total }
  perPlayer: Map<number, {
    skins: number;         // $ from skins pot on this hole (0 on wolf holes)
    wolfSettlement: number; // $ from wolf resolution pre-bonus (0 on skins)
    bonuses: number;       // greenies + polies + sandies bonus-skin component (0 on skins)
    total: number;         // skins + wolfSettlement + bonuses
  }>;
};

export type RoundMoneyBreakdown = {
  holes: HoleMoneyBreakdown[];      // flattened across all groups × 18 holes
  perPlayerTotals: Map<number, {
    skins: number;
    wolfSettlement: number;
    bonuses: number;
    total: number;
  }>;
};

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

function buildBonusInput(bonusesJson: string | null, battingOrder: number[]): BonusInput {
  if (!bonusesJson) return { greenies: [], polies: [], sandies: [] };
  const parsed = JSON.parse(bonusesJson) as {
    greenies?: number[];
    polies?: number[];
    sandies?: number[];
  };
  const mapToBatter = (ids: number[] = []) =>
    ids
      .map((id) => battingOrder.indexOf(id) as BattingPosition)
      .filter((p) => p >= 0);
  return {
    greenies: mapToBatter(parsed.greenies),
    polies: mapToBatter(parsed.polies),
    sandies: mapToBatter(parsed.sandies),
  };
}

/**
 * Compute per-hole money breakdown across every group in a round.
 * Skips holes with missing scores and wolf holes with missing decisions —
 * those slots simply don't appear in the returned `holes` array.
 */
export async function computeRoundMoneyBreakdown(roundId: number): Promise<RoundMoneyBreakdown> {
  // Round → tee (needed for course-handicap calc)
  const round = await db
    .select({ tee: rounds.tee })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .get();
  const tee: Tee = (round?.tee as Tee | null) ?? 'blue';

  // All groups for this round
  const groupRows = await db
    .select({ id: groups.id, battingOrder: groups.battingOrder })
    .from(groups)
    .where(eq(groups.roundId, roundId));

  // All hole scores for this round
  const allScores = await db
    .select({
      groupId: holeScores.groupId,
      playerId: holeScores.playerId,
      holeNumber: holeScores.holeNumber,
      grossScore: holeScores.grossScore,
    })
    .from(holeScores)
    .where(eq(holeScores.roundId, roundId));

  // All wolf decisions for this round
  const allDecisions = await db
    .select({
      groupId: wolfDecisions.groupId,
      holeNumber: wolfDecisions.holeNumber,
      decision: wolfDecisions.decision,
      wolfPlayerId: wolfDecisions.wolfPlayerId,
      partnerPlayerId: wolfDecisions.partnerPlayerId,
      bonusesJson: wolfDecisions.bonusesJson,
    })
    .from(wolfDecisions)
    .where(eq(wolfDecisions.roundId, roundId));

  // Handicaps per player (from round_players)
  const handicapRows = await db
    .select({
      groupId: roundPlayers.groupId,
      playerId: roundPlayers.playerId,
      handicapIndex: roundPlayers.handicapIndex,
    })
    .from(roundPlayers)
    .where(eq(roundPlayers.roundId, roundId));

  const holes: HoleMoneyBreakdown[] = [];
  const perPlayerTotals = new Map<number, {
    skins: number;
    wolfSettlement: number;
    bonuses: number;
    total: number;
  }>();

  function addToTotal(playerId: number, skins: number, wolfSettlement: number, bonuses: number) {
    const entry = perPlayerTotals.get(playerId) ?? { skins: 0, wolfSettlement: 0, bonuses: 0, total: 0 };
    entry.skins += skins;
    entry.wolfSettlement += wolfSettlement;
    entry.bonuses += bonuses;
    entry.total += skins + wolfSettlement + bonuses;
    perPlayerTotals.set(playerId, entry);
  }

  for (const g of groupRows) {
    if (!g.battingOrder) continue;
    const battingOrder = JSON.parse(g.battingOrder) as number[];
    if (battingOrder.length !== 4) continue;

    // Group-scoped scores keyed by hole → playerId → gross
    const scoresByHole = new Map<number, Map<number, number>>();
    for (const s of allScores) {
      if (s.groupId !== g.id) continue;
      if (!scoresByHole.has(s.holeNumber)) scoresByHole.set(s.holeNumber, new Map());
      scoresByHole.get(s.holeNumber)!.set(s.playerId, s.grossScore);
    }

    // Group-scoped decisions keyed by hole
    const decisionByHole = new Map<number, typeof allDecisions[number]>();
    for (const d of allDecisions) {
      if (d.groupId !== g.id) continue;
      decisionByHole.set(d.holeNumber, d);
    }

    // Course handicaps for this group (relative to low-man)
    const groupHandicaps = handicapRows
      .filter((r) => r.groupId === g.id)
      .map((r) => ({ playerId: r.playerId, courseHandicap: calcCourseHandicap(r.handicapIndex, tee) }));
    if (groupHandicaps.length !== 4) continue;
    const minCH = Math.min(...groupHandicaps.map((r) => r.courseHandicap));
    const handicapMap = new Map(groupHandicaps.map((r) => [r.playerId, r.courseHandicap - minCH]));

    for (let holeNum = 1; holeNum <= 18; holeNum++) {
      const scoreMap = scoresByHole.get(holeNum);
      if (!scoreMap || scoreMap.size < 4) continue; // incomplete hole — skip

      const courseHole = getCourseHole(holeNum as HoleNumber);
      const assignment: HoleAssignment = getWolfAssignment([0, 1, 2, 3], holeNum as HoleNumber);

      const grossScores = battingOrder.map((pid) => scoreMap.get(pid) ?? 0) as [number, number, number, number];
      const netScores = battingOrder.map((pid, i) => {
        const strokes = getHandicapStrokes(handicapMap.get(pid) ?? 0, courseHole.strokeIndex);
        return grossScores[i]! - strokes;
      }) as [number, number, number, number];

      const holeDecision = decisionByHole.get(holeNum) ?? null;

      let wolfDec: WolfDecision | null = null;
      if (assignment.type === 'wolf') {
        if (!holeDecision?.decision) continue; // wolf hole without decision — skip
        wolfDec = buildWolfDecision(holeDecision.decision, holeDecision.partnerPlayerId, battingOrder);
      }

      // Compute base (skins or wolf-settlement without bonuses)
      const baseResult = calculateHoleMoney(netScores, assignment, wolfDec, courseHole.par);

      // Apply bonuses on wolf holes only (applyBonusModifiers is a no-op on skins in the engine,
      // but we skip the call entirely to mirror recalculateMoney's behavior).
      const withBonuses = assignment.type === 'wolf'
        ? applyBonusModifiers(
            baseResult,
            netScores,
            grossScores,
            buildBonusInput(holeDecision?.bonusesJson ?? null, battingOrder),
            assignment,
            wolfDec!,
            courseHole.par,
          )
        : baseResult;

      const holeType: 'skins' | 'wolf' = assignment.type;
      const perPlayer = new Map<number, { skins: number; wolfSettlement: number; bonuses: number; total: number }>();

      for (let pos = 0; pos < 4; pos++) {
        const pid = battingOrder[pos]!;
        const total = withBonuses[pos]!.total;
        // Decomposition:
        //   - skins hole: entire total is the skins bucket.
        //   - wolf hole: bonuses bucket = bonusSkins component (greenie/polie/sandie/double-birdie etc).
        //                wolfSettlement bucket = total - bonusSkins (i.e., lowBall + skin + teamTotalOrBonus + blindWolf).
        let skins = 0;
        let wolfSettlement = 0;
        let bonuses = 0;
        if (holeType === 'skins') {
          skins = total;
        } else {
          bonuses = withBonuses[pos]!.bonusSkins;
          wolfSettlement = total - bonuses;
        }
        perPlayer.set(pid, { skins, wolfSettlement, bonuses, total });
        addToTotal(pid, skins, wolfSettlement, bonuses);
      }

      holes.push({
        holeNumber: holeNum,
        groupId: g.id,
        holeType,
        wolfPlayerId: holeType === 'wolf' && assignment.type === 'wolf'
          ? battingOrder[assignment.wolfBatterIndex]!
          : null,
        partnerPlayerId: holeDecision?.partnerPlayerId ?? null,
        decision: (holeDecision?.decision as 'alone' | 'partner' | 'blind_wolf' | null) ?? null,
        perPlayer,
      });
    }
  }

  return { holes, perPlayerTotals };
}
