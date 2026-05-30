import { Hono } from 'hono';
import { eq, and, inArray } from 'drizzle-orm';
import { getCourseHole, handicapTrend, volatility, bestWorstHoles, loneWolfWhenBehindRate } from '@wolf-cup/engine';
import type { HoleNumber } from '@wolf-cup/engine';
import { db } from '../db/index.js';
import { rounds, groups, roundPlayers, players, roundResults, holeScores, wolfDecisions } from '../db/schema.js';

const app = new Hono();

// ---------------------------------------------------------------------------
// GET /scouting/:roundId — current-season (2026) "scouting report" per group.
//
// For each group in the given round, returns per-player current-form stats
// (handicap trend, best/worst holes, birdie hole, best tee, boom-or-bust,
// lone-wolf-when-behind) plus two foursome-personal callouts: a RIVALRY (most
// lopsided intra-group money head-to-head) and a LUCKY CHARM (best intra-group
// wolf partnership). Scoped to the round's season, finalized official rounds.
//
// Stat conventions (match the league's existing stats):
//   - best/worst holes + birdies use GROSS vs par (a birdie is a real birdie).
//   - partnership win rate divides by wins+losses (pushes don't penalize).
//   - everything is "this year" — single-season, current form by design.
// ---------------------------------------------------------------------------

const MIN_TREND = 2;     // rounds needed to show a handicap trend
const MIN_HOLE = 2;      // rounds a hole needs to count for best/worst
const MIN_PARTNER = 3;   // partnered holes needed to flag a lucky charm

app.get('/scouting/:roundId', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  const round = await db.select({ seasonId: rounds.seasonId }).from(rounds).where(eq(rounds.id, roundId)).get();
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);

  // This season's finalized official rounds, oldest → newest.
  const seasonRounds = await db
    .select({ id: rounds.id, scheduledDate: rounds.scheduledDate, tee: rounds.tee })
    .from(rounds)
    .where(and(eq(rounds.seasonId, round.seasonId), eq(rounds.type, 'official'), eq(rounds.status, 'finalized')))
    .orderBy(rounds.scheduledDate, rounds.id);
  const seasonRoundIds = seasonRounds.map((r) => r.id);
  const roundOrder = new Map(seasonRounds.map((r, i) => [r.id, i]));
  const teeByRound = new Map(seasonRounds.map((r) => [r.id, r.tee]));

  // This round's groups + players.
  const rosterRows = await db
    .select({ groupId: roundPlayers.groupId, groupNumber: groups.groupNumber, playerId: roundPlayers.playerId, name: players.name })
    .from(roundPlayers)
    .innerJoin(groups, eq(groups.id, roundPlayers.groupId))
    .innerJoin(players, eq(players.id, roundPlayers.playerId))
    .where(eq(roundPlayers.roundId, roundId))
    .orderBy(groups.groupNumber);

  const scoutedIds = [...new Set(rosterRows.map((r) => r.playerId))];
  const nameOf = new Map(rosterRows.map((r) => [r.playerId, r.name]));
  if (scoutedIds.length === 0 || seasonRoundIds.length === 0) {
    return c.json({ roundId, seasonRounds: seasonRoundIds.length, groups: [] }, 200);
  }

  // Bulk-load this season's data for the scouted players.
  const [resultRows, hiRows, scoreRows, decisionRows] = await Promise.all([
    db.select({ roundId: roundResults.roundId, playerId: roundResults.playerId, stableford: roundResults.stablefordTotal, money: roundResults.moneyTotal })
      .from(roundResults).where(and(inArray(roundResults.roundId, seasonRoundIds), inArray(roundResults.playerId, scoutedIds))),
    db.select({ roundId: roundPlayers.roundId, playerId: roundPlayers.playerId, hi: roundPlayers.handicapIndex })
      .from(roundPlayers).where(and(inArray(roundPlayers.roundId, seasonRoundIds), inArray(roundPlayers.playerId, scoutedIds))),
    db.select({ roundId: holeScores.roundId, playerId: holeScores.playerId, holeNumber: holeScores.holeNumber, gross: holeScores.grossScore })
      .from(holeScores).where(and(inArray(holeScores.roundId, seasonRoundIds), inArray(holeScores.playerId, scoutedIds))),
    db.select({ roundId: wolfDecisions.roundId, decision: wolfDecisions.decision, wolfPlayerId: wolfDecisions.wolfPlayerId, partnerPlayerId: wolfDecisions.partnerPlayerId, outcome: wolfDecisions.outcome })
      .from(wolfDecisions).where(inArray(wolfDecisions.roundId, seasonRoundIds)),
  ]);

  // Index by player.
  const byPlayer = (id: number) => ({
    results: resultRows.filter((r) => r.playerId === id).sort((a, b) => (roundOrder.get(a.roundId) ?? 0) - (roundOrder.get(b.roundId) ?? 0)),
    his: hiRows.filter((r) => r.playerId === id).sort((a, b) => (roundOrder.get(a.roundId) ?? 0) - (roundOrder.get(b.roundId) ?? 0)),
    scores: scoreRows.filter((r) => r.playerId === id),
  });

  function playerStats(id: number) {
    const { results, his, scores } = byPlayer(id);
    const roundsPlayed = results.length;

    // Handicap trend (last 3).
    const trend = handicapTrend(his.map((h) => h.hi), 3);

    // Boom-or-bust + money swings.
    const boom = volatility(results.map((r) => r.stableford));
    const monies = results.map((r) => r.money);
    const biggestWin = monies.length ? Math.max(...monies) : 0;
    const biggestLoss = monies.length ? Math.min(...monies) : 0;

    // Per-hole gross vs par.
    const perHole = new Map<number, { sumToPar: number; rounds: number; birdies: number }>();
    for (const s of scores) {
      const par = getCourseHole(s.holeNumber as HoleNumber).par;
      const cur = perHole.get(s.holeNumber) ?? { sumToPar: 0, rounds: 0, birdies: 0 };
      cur.sumToPar += s.gross - par;
      cur.rounds += 1;
      if (s.gross <= par - 1) cur.birdies += 1; // birdie-or-better
      perHole.set(s.holeNumber, cur);
    }
    const holesForBW = [...perHole.entries()].map(([hole, v]) => ({ hole, avgToPar: v.sumToPar / v.rounds, rounds: v.rounds }));
    const { best, worst } = bestWorstHoles(holesForBW, MIN_HOLE);
    let topBirdieHole: { hole: number; count: number; rounds: number } | null = null;
    for (const [hole, v] of perHole) {
      if (v.birdies > 0 && (!topBirdieHole || v.birdies > topBirdieHole.count)) {
        topBirdieHole = { hole, count: v.birdies, rounds: v.rounds };
      }
    }

    // Best tee (avg stableford per tee color this season).
    const teeAgg = new Map<string, { sum: number; n: number }>();
    for (const r of results) {
      const tee = teeByRound.get(r.roundId) ?? null;
      if (!tee) continue;
      const cur = teeAgg.get(tee) ?? { sum: 0, n: 0 };
      cur.sum += r.stableford; cur.n += 1;
      teeAgg.set(tee, cur);
    }
    let bestTee: { tee: string; avgStableford: number; rounds: number } | null = null;
    for (const [tee, v] of teeAgg) {
      const avg = Math.round((v.sum / v.n) * 10) / 10;
      if (!bestTee || avg > bestTee.avgStableford) bestTee = { tee, avgStableford: avg, rounds: v.n };
    }

    // Lone-wolf-when-behind (round-level proxy: behind = net-negative money that round;
    // wentAlone = any alone/blind wolf call that round).
    const moneyByRound = new Map(results.map((r) => [r.roundId, r.money]));
    const aloneByRound = new Map<number, boolean>();
    for (const d of decisionRows) {
      if (d.wolfPlayerId !== id) continue;
      if (d.decision === 'alone' || d.decision === 'blind_wolf') aloneByRound.set(d.roundId, true);
    }
    const lwb = loneWolfWhenBehindRate(
      results.map((r) => ({ wentAlone: aloneByRound.get(r.roundId) ?? false, behindInMoney: (moneyByRound.get(r.roundId) ?? 0) < 0 })),
    );

    return {
      playerId: id,
      name: nameOf.get(id) ?? `#${id}`,
      rounds: roundsPlayed,
      handicapTrend: trend.sample >= MIN_TREND ? trend : null,
      bestHoles: best,
      worstHoles: worst,
      topBirdieHole,
      bestTee,
      biggestWin,
      biggestLoss,
      boomOrBust: boom.sample >= 2 ? boom : null,
      loneWolfWhenBehind: lwb.behind > 0 ? lwb : null,
    };
  }

  // Intra-group rivalry (money H2H) + lucky charm (wolf partnership).
  function rivalry(ids: number[]) {
    let top: { aId: number; aName: string; bId: number; bName: string; leaderName: string; aWins: number; bWins: number; moneyDiff: number; shared: number } | null = null;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!, b = ids[j]!;
        const aMoney = new Map(resultRows.filter((r) => r.playerId === a).map((r) => [r.roundId, r.money]));
        const bMoney = new Map(resultRows.filter((r) => r.playerId === b).map((r) => [r.roundId, r.money]));
        let aWins = 0, bWins = 0, diff = 0, shared = 0;
        for (const [rid, am] of aMoney) {
          if (!bMoney.has(rid)) continue;
          const bm = bMoney.get(rid)!;
          shared += 1; diff += am - bm;
          if (am > bm) aWins += 1; else if (bm > am) bWins += 1;
        }
        if (shared < 2) continue;
        const spread = Math.abs(aWins - bWins);
        if (!top || spread > Math.abs(top.aWins - top.bWins) || (spread === Math.abs(top.aWins - top.bWins) && Math.abs(diff) > Math.abs(top.moneyDiff))) {
          const leaderName = diff >= 0 ? (nameOf.get(a) ?? '') : (nameOf.get(b) ?? '');
          top = { aId: a, aName: nameOf.get(a) ?? '', bId: b, bName: nameOf.get(b) ?? '', leaderName, aWins, bWins, moneyDiff: diff, shared };
        }
      }
    }
    return top;
  }

  function luckyCharm(ids: number[]) {
    const idSet = new Set(ids);
    // partnered holes among these players: decision='partner' with both wolf & partner in the group.
    const pairKey = (x: number, y: number) => (x < y ? `${x}-${y}` : `${y}-${x}`);
    const agg = new Map<string, { wins: number; losses: number; pushes: number }>();
    for (const d of decisionRows) {
      if (d.decision !== 'partner' || d.wolfPlayerId == null || d.partnerPlayerId == null) continue;
      if (!idSet.has(d.wolfPlayerId) || !idSet.has(d.partnerPlayerId)) continue;
      const k = pairKey(d.wolfPlayerId, d.partnerPlayerId);
      const cur = agg.get(k) ?? { wins: 0, losses: 0, pushes: 0 };
      if (d.outcome === 'win') cur.wins += 1; else if (d.outcome === 'loss') cur.losses += 1; else if (d.outcome === 'push') cur.pushes += 1;
      agg.set(k, cur);
    }
    let top: { aId: number; aName: string; bId: number; bName: string; wins: number; losses: number; pushes: number; winRate: number } | null = null;
    for (const [k, v] of agg) {
      const total = v.wins + v.losses + v.pushes;
      if (total < MIN_PARTNER) continue;
      const decisive = v.wins + v.losses;
      const winRate = decisive === 0 ? 0 : Math.round((v.wins / decisive) * 100) / 100; // pushes don't penalize
      if (!top || winRate > top.winRate) {
        const [x, y] = k.split('-').map(Number) as [number, number];
        top = { aId: x, aName: nameOf.get(x) ?? '', bId: y, bName: nameOf.get(y) ?? '', wins: v.wins, losses: v.losses, pushes: v.pushes, winRate };
      }
    }
    return top;
  }

  // Assemble per group.
  const groupMap = new Map<number, { groupNumber: number; ids: number[] }>();
  for (const r of rosterRows) {
    const g = groupMap.get(r.groupId) ?? { groupNumber: r.groupNumber, ids: [] };
    if (!g.ids.includes(r.playerId)) g.ids.push(r.playerId);
    groupMap.set(r.groupId, g);
  }
  const groupsOut = [...groupMap.values()]
    .sort((a, b) => a.groupNumber - b.groupNumber)
    .map((g) => ({
      groupNumber: g.groupNumber,
      players: g.ids.map(playerStats),
      rivalry: rivalry(g.ids),
      luckyCharm: luckyCharm(g.ids),
    }));

  return c.json({ roundId, seasonRounds: seasonRoundIds.length, groups: groupsOut }, 200);
});

export default app;
