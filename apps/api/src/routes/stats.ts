import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { players, rounds, wolfDecisions, holeScores, roundPlayers, roundResults } from '../db/schema.js';
import { getCourseHole, getHandicapStrokes } from '@wolf-cup/engine';

const app = new Hono();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlayerStats = {
  playerId: number;
  name: string;
  wolfCallsTotal: number;
  wolfCallsAlone: number;
  wolfCallsPartner: number;
  wolfWins: number;
  wolfLosses: number;
  wolfPushes: number;
  netBirdies: number;
  netEagles: number;
  greenies: number;
  polies: number;
  biggestRoundWin: number;
  biggestRoundLoss: number;
};

// ---------------------------------------------------------------------------
// GET /stats — public, no auth middleware
// ---------------------------------------------------------------------------

app.get('/stats', async (c) => {
  try {
    // Step 1: All non-guest active players, sorted by name
    const allPlayers = await db
      .select({ id: players.id, name: players.name })
      .from(players)
      .where(and(eq(players.isActive, 1), eq(players.isGuest, 0)))
      .orderBy(players.name);

    // Step 2: Wolf decisions for official finalized rounds
    const wdRows = await db
      .select({
        wolfPlayerId: wolfDecisions.wolfPlayerId,
        decision: wolfDecisions.decision,
        outcome: wolfDecisions.outcome,
        bonusesJson: wolfDecisions.bonusesJson,
      })
      .from(wolfDecisions)
      .innerJoin(rounds, eq(rounds.id, wolfDecisions.roundId))
      .where(and(eq(rounds.type, 'official'), eq(rounds.status, 'finalized')));

    // Step 3: Hole scores for birdies/eagles
    const hsRows = await db
      .select({
        playerId: holeScores.playerId,
        holeNumber: holeScores.holeNumber,
        grossScore: holeScores.grossScore,
        handicapIndex: roundPlayers.handicapIndex,
      })
      .from(holeScores)
      .innerJoin(rounds, eq(rounds.id, holeScores.roundId))
      .innerJoin(
        roundPlayers,
        and(
          eq(roundPlayers.roundId, holeScores.roundId),
          eq(roundPlayers.playerId, holeScores.playerId),
        ),
      )
      .where(and(eq(rounds.type, 'official'), eq(rounds.status, 'finalized')));

    // Step 4: Round money totals
    const rrRows = await db
      .select({ playerId: roundResults.playerId, moneyTotal: roundResults.moneyTotal })
      .from(roundResults)
      .innerJoin(rounds, eq(rounds.id, roundResults.roundId))
      .where(and(eq(rounds.type, 'official'), eq(rounds.status, 'finalized')));

    // Step 5: Aggregate wolf record per player
    const wolfMap = new Map<
      number,
      { total: number; alone: number; partner: number; wins: number; losses: number; pushes: number }
    >();
    for (const row of wdRows) {
      if (row.wolfPlayerId == null) continue; // skip skins holes
      const s = wolfMap.get(row.wolfPlayerId) ?? {
        total: 0,
        alone: 0,
        partner: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
      };
      s.total++;
      if (row.decision === 'alone' || row.decision === 'blind_wolf') s.alone++;
      else if (row.decision === 'partner') s.partner++;
      if (row.outcome === 'win') s.wins++;
      else if (row.outcome === 'loss') s.losses++;
      else if (row.outcome === 'push') s.pushes++;
      wolfMap.set(row.wolfPlayerId, s);
    }

    // Step 6: Greenies + polies from bonusesJson
    const greenieMap = new Map<number, number>();
    const polieMap = new Map<number, number>();
    for (const row of wdRows) {
      if (!row.bonusesJson) continue;
      try {
        const b = JSON.parse(row.bonusesJson) as { greenies?: number[]; polies?: number[] };
        for (const pid of b.greenies ?? []) greenieMap.set(pid, (greenieMap.get(pid) ?? 0) + 1);
        for (const pid of b.polies ?? []) polieMap.set(pid, (polieMap.get(pid) ?? 0) + 1);
      } catch {
        // ignore malformed JSON
      }
    }

    // Step 7: Net birdies / eagles
    const birdieMap = new Map<number, number>();
    const eagleMap = new Map<number, number>();
    for (const row of hsRows) {
      const courseHole = getCourseHole(row.holeNumber as Parameters<typeof getCourseHole>[0]);
      const strokes = getHandicapStrokes(row.handicapIndex, courseHole.strokeIndex);
      const netScore = row.grossScore - strokes;
      if (netScore === courseHole.par - 1) {
        birdieMap.set(row.playerId, (birdieMap.get(row.playerId) ?? 0) + 1);
      } else if (netScore <= courseHole.par - 2) {
        eagleMap.set(row.playerId, (eagleMap.get(row.playerId) ?? 0) + 1);
      }
    }

    // Step 8: Biggest round win / loss
    const winMap = new Map<number, number>();
    const lossMap = new Map<number, number>();
    for (const row of rrRows) {
      winMap.set(row.playerId, Math.max(winMap.get(row.playerId) ?? 0, row.moneyTotal));
      lossMap.set(row.playerId, Math.min(lossMap.get(row.playerId) ?? 0, row.moneyTotal));
    }

    // Step 9: Build response array
    const playerStats: PlayerStats[] = allPlayers.map((p) => {
      const w = wolfMap.get(p.id);
      return {
        playerId: p.id,
        name: p.name,
        wolfCallsTotal: w?.total ?? 0,
        wolfCallsAlone: w?.alone ?? 0,
        wolfCallsPartner: w?.partner ?? 0,
        wolfWins: w?.wins ?? 0,
        wolfLosses: w?.losses ?? 0,
        wolfPushes: w?.pushes ?? 0,
        netBirdies: birdieMap.get(p.id) ?? 0,
        netEagles: eagleMap.get(p.id) ?? 0,
        greenies: greenieMap.get(p.id) ?? 0,
        polies: polieMap.get(p.id) ?? 0,
        biggestRoundWin: winMap.get(p.id) ?? 0,
        biggestRoundLoss: lossMap.get(p.id) ?? 0,
      };
    });

    return c.json({ players: playerStats, lastUpdated: new Date().toISOString() }, 200);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }
});

export default app;
