import { Hono } from 'hono';
import { eq, and, inArray, lt, lte } from 'drizzle-orm';
import {
  getCourseHole, handicapTrend, volatility, bestWorstHoles, loneWolfWhenBehindRate,
  computeOddsLine, simulateWeekHousePnl, logLossAndBrier, bootstrapMeanCI,
  DEFAULT_ODDS_CONSTANTS, HOUSE_CONSTANTS,
} from '@wolf-cup/engine';
import type { HoleNumber, OddsFieldEntry, OddsResult } from '@wolf-cup/engine';
import { db } from '../db/index.js';
import { rounds, groups, roundPlayers, players, roundResults, holeScores, wolfDecisions, harveyResults } from '../db/schema.js';

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
// Additive blocks (scouting-harvey-win-odds spec):
//   - `odds`        — "The Line": deterministic Monte-Carlo win odds per member.
//   - `retrospective` — past finalized weeks: graded opening line vs. actual winner.
//   - `houseLedger` — cumulative House P&L + calibration vs. baselines (weeks ≥3).
//   - `weeks`       — season round list for the UI week selector.
//
// Stat conventions (match the league's existing stats):
//   - best/worst holes + birdies use GROSS vs par (a birdie is a real birdie).
//   - partnership win rate divides by wins+losses (pushes don't penalize).
//   - everything is "this year" — single-season, current form by design.
// ---------------------------------------------------------------------------

const MIN_TREND = 2;     // rounds needed to show a handicap trend
const MIN_HOLE = 2;      // rounds a hole needs to count for best/worst
const MIN_PARTNER = 3;   // partnered holes needed to flag a lucky charm

type ResultRow = { roundId: number; playerId: number; stableford: number; money: number };

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r2 = (x: number) => Math.round(x * 1e2) / 1e2;

/** Build a sim field (members + subs) from per-player history rows. */
function buildField(
  roster: Array<{ playerId: number; isSub: boolean }>,
  results: ResultRow[],
  order: Map<number, number>,
): OddsFieldEntry[] {
  const byPlayer = new Map<number, ResultRow[]>();
  for (const r of results) {
    const arr = byPlayer.get(r.playerId) ?? [];
    arr.push(r);
    byPlayer.set(r.playerId, arr);
  }
  return roster.map((rp) => ({
    playerId: rp.playerId,
    isSub: rp.isSub,
    history: (byPlayer.get(rp.playerId) ?? []).map((r) => ({
      stableford: r.stableford,
      money: r.money,
      orderIndex: order.get(r.roundId) ?? 0,
    })),
  }));
}

app.get('/scouting/:roundId', async (c) => {
  const roundId = Number(c.req.param('roundId'));
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
  }

  const round = await db.select({ seasonId: rounds.seasonId, scheduledDate: rounds.scheduledDate, status: rounds.status }).from(rounds).where(eq(rounds.id, roundId)).get();
  if (!round) return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);

  // Form going INTO this round: this season's finalized official rounds BEFORE the
  // target round's date. Makes the report a true scouting report (pre-round intel)
  // and — because it never looks at later rounds — a frozen snapshot for that week
  // that won't change as the season goes on.
  const seasonRounds = await db
    .select({ id: rounds.id, scheduledDate: rounds.scheduledDate, tee: rounds.tee })
    .from(rounds)
    .where(and(
      eq(rounds.seasonId, round.seasonId),
      eq(rounds.type, 'official'),
      eq(rounds.status, 'finalized'),
      lt(rounds.scheduledDate, round.scheduledDate),
    ))
    .orderBy(rounds.scheduledDate, rounds.id);
  const seasonRoundIds = seasonRounds.map((r) => r.id);
  const roundOrder = new Map(seasonRounds.map((r, i) => [r.id, i]));
  const teeByRound = new Map(seasonRounds.map((r) => [r.id, r.tee]));

  // Season round list for the UI week selector (all official rounds, any status).
  const weekRows = await db
    .select({ id: rounds.id, scheduledDate: rounds.scheduledDate, status: rounds.status })
    .from(rounds)
    .where(and(eq(rounds.seasonId, round.seasonId), eq(rounds.type, 'official')))
    .orderBy(rounds.scheduledDate, rounds.id);
  const weeks = weekRows.map((w) => ({ roundId: w.id, date: w.scheduledDate, label: w.scheduledDate, status: w.status }));

  // This round's groups + players (with sub flag for the field/odds).
  const rosterRows = await db
    .select({ groupId: roundPlayers.groupId, groupNumber: groups.groupNumber, playerId: roundPlayers.playerId, name: players.name, isSub: roundPlayers.isSub })
    .from(roundPlayers)
    .innerJoin(groups, eq(groups.id, roundPlayers.groupId))
    .innerJoin(players, eq(players.id, roundPlayers.playerId))
    .where(eq(roundPlayers.roundId, roundId))
    .orderBy(groups.groupNumber);

  const scoutedIds = [...new Set(rosterRows.map((r) => r.playerId))];
  const nameOf = new Map(rosterRows.map((r) => [r.playerId, r.name]));
  const targetRoster = scoutedIds.map((id) => ({ playerId: id, isSub: (rosterRows.find((r) => r.playerId === id)?.isSub ?? 0) === 1 }));

  // ----- House ledger (season-wide, recompute-on-read) -------------------
  // Built independently of the target roster so it appears on every response.
  // Error-isolated (F6/F13): a bug here must never 500 the core scouting report.
  let houseLedger: HouseLedger;
  try {
    houseLedger = await buildHouseLedger(round.seasonId, round.scheduledDate);
  } catch (err) {
    console.error('scouting houseLedger failed (non-fatal):', err);
    houseLedger = emptyLedger();
  }

  // ----- Odds for the target round --------------------------------------
  // Members + subs from the target roster; histories from prior finalized rounds.
  // Subs are non-bettable rank fillers drawn from a pooled sub-class prior (a NEW
  // access pattern, NOT filtered by scoutedIds — NEW-3) with field-baseline fallback.
  // Error-isolated (F6): a throw downgrades to a gated line, never a 500.
  let odds: OddsResult | { gated: true; reason: string };
  try {
    if (targetRoster.length === 0) {
      odds = { gated: true, reason: 'line opens when pairings are set' };
    } else if (seasonRoundIds.length === 0) {
      odds = { gated: true, reason: 'odds open in a few weeks' };
    } else {
      const oddsResultRows = await db
        .select({ roundId: roundResults.roundId, playerId: roundResults.playerId, stableford: roundResults.stablefordTotal, money: roundResults.moneyTotal })
        .from(roundResults)
        .where(and(inArray(roundResults.roundId, seasonRoundIds), inArray(roundResults.playerId, scoutedIds)));
      const subPriorRows = await db
        .select({ stableford: roundResults.stablefordTotal, money: roundResults.moneyTotal })
        .from(roundResults)
        .innerJoin(roundPlayers, and(eq(roundPlayers.roundId, roundResults.roundId), eq(roundPlayers.playerId, roundResults.playerId)))
        .where(and(inArray(roundResults.roundId, seasonRoundIds), eq(roundPlayers.isSub, 1)));

      const field = buildField(targetRoster, oddsResultRows, roundOrder);
      odds = computeOddsLine({ field, subPrior: subPriorRows, priorRoundCount: seasonRoundIds.length, seed: roundId });
    }
  } catch (err) {
    console.error('scouting odds failed (non-fatal):', err);
    odds = { gated: true, reason: 'odds unavailable' };
  }

  // Retrospective — only when finalized AND has harvey_results. Isolated in its
  // OWN try/catch (R2-F1): a retrospective DB failure must NOT wipe a valid line.
  let retrospective: Retrospective | null = null;
  if (round.status === 'finalized' && targetRoster.length > 0) {
    try {
      retrospective = await buildRetrospective(roundId, targetRoster, nameOf, odds);
    } catch (err) {
      console.error('scouting retrospective failed (non-fatal):', err);
      retrospective = null;
    }
  }

  // Attach names to the odds lines for the UI.
  const oddsOut = ('gated' in odds && odds.gated)
    ? odds
    : { ...odds, lines: (odds as Extract<OddsResult, { gated: false }>).lines.map((l) => ({ ...l, name: nameOf.get(l.playerId) ?? `#${l.playerId}` })) };

  // ----- Per-group scouting stats (unchanged) ----------------------------
  if (scoutedIds.length === 0 || seasonRoundIds.length === 0) {
    return c.json({ roundId, seasonRounds: seasonRoundIds.length, groups: [], weeks, odds: oddsOut, retrospective, houseLedger }, 200);
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
    const biggestLoss = monies.length ? Math.min(0, ...monies) : 0; // 0 = never lost (codex F3)

    // Per-hole gross vs par.
    const perHole = new Map<number, { par: number; sumToPar: number; rounds: number; birdies: number }>();
    for (const s of scores) {
      if (s.holeNumber < 1 || s.holeNumber > 18) continue; // guard getCourseHole (codex F5)
      const par = getCourseHole(s.holeNumber as HoleNumber).par;
      const cur = perHole.get(s.holeNumber) ?? { par, sumToPar: 0, rounds: 0, birdies: 0 };
      cur.sumToPar += s.gross - par;
      cur.rounds += 1;
      if (s.gross <= par - 1) cur.birdies += 1; // birdie-or-better
      perHole.set(s.holeNumber, cur);
    }
    // Per-hole average gross — shipped WITH the card so the tap-to-expand hole-by-hole
    // is instant (no second fetch, no layout shift on expand).
    const holes = [...perHole.entries()]
      .map(([hole, v]) => ({ hole, par: v.par, avg: Math.round((v.par + v.sumToPar / v.rounds) * 10) / 10 }))
      .sort((a, b) => a.hole - b.hole);
    const holesForBW = [...perHole.entries()].map(([hole, v]) => ({ hole, avgToPar: v.sumToPar / v.rounds, rounds: v.rounds }));
    const { best, worst } = bestWorstHoles(holesForBW, MIN_HOLE);
    let topBirdieHole: { hole: number; count: number; rounds: number } | null = null;
    for (const [hole, v] of perHole) {
      // deterministic on ties: most birdies, then lowest hole number (codex F4)
      if (v.birdies > 0 && (!topBirdieHole || v.birdies > topBirdieHole.count || (v.birdies === topBirdieHole.count && hole < topBirdieHole.hole))) {
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
      holes,
    };
  }

  // Intra-group rivalry (money H2H) + lucky charm (wolf partnership).
  function rivalry(ids: number[]) {
    // Find the most lopsided money head-to-head among the group (by round-wins,
    // tiebreak by total money). diff is kept from a's perspective (a - b).
    let top: { a: number; b: number; aWins: number; bWins: number; diff: number; shared: number } | null = null;
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
        if (!top || spread > Math.abs(top.aWins - top.bWins) || (spread === Math.abs(top.aWins - top.bWins) && Math.abs(diff) > Math.abs(top.diff))) {
          top = { a, b, aWins, bWins, diff, shared };
        }
      }
    }
    if (!top) return null;
    // Report from the LEADER's perspective (more round-wins; tiebreak money) so the
    // record and the money sign always agree with who "owns it".
    const aIsLeader = top.aWins > top.bWins || (top.aWins === top.bWins && top.diff >= 0);
    return {
      leaderName: nameOf.get(aIsLeader ? top.a : top.b) ?? '',
      trailerName: nameOf.get(aIsLeader ? top.b : top.a) ?? '',
      leaderWins: aIsLeader ? top.aWins : top.bWins,
      trailerWins: aIsLeader ? top.bWins : top.aWins,
      moneyDiff: aIsLeader ? top.diff : -top.diff,
      shared: top.shared,
    };
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
      const topTotal = top ? top.wins + top.losses + top.pushes : 0;
      // deterministic on ties: higher win rate, then larger sample (codex F6)
      if (!top || winRate > top.winRate || (winRate === top.winRate && total > topTotal)) {
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

  return c.json({ roundId, seasonRounds: seasonRoundIds.length, groups: groupsOut, weeks, odds: oddsOut, retrospective, houseLedger }, 200);
});

// ===========================================================================
// Retrospective (Block B) — presentation-only grade of the frozen opening line
// against the actual Harvey winner. Reads harvey_results separately; never feeds
// the model. (F2: settle on the top MEMBER; a sub posting the overall high is
// surfaced as `subSpoiled` color only.)
// ===========================================================================

interface Retrospective {
  winningMemberId: number | null;
  winningMemberName: string | null;
  subSpoiled: boolean;
  verdict: 'chalk' | 'upset' | 'busted';
  favoriteId: number | null;
  favoriteName: string | null;
  winnerPostedAmerican: number | null;
}

async function buildRetrospective(
  roundId: number,
  roster: Array<{ playerId: number; isSub: boolean }>,
  nameOf: Map<number, string>,
  odds: OddsResult | { gated: true; reason: string },
): Promise<Retrospective | null> {
  const hr = await db
    .select({ playerId: harveyResults.playerId, sp: harveyResults.stablefordPoints, mp: harveyResults.moneyPoints })
    .from(harveyResults)
    .where(eq(harveyResults.roundId, roundId));
  if (hr.length === 0) return null; // not graded yet → "line still open"

  // Known roster only — guard against harvey rows for players no longer on the
  // roster, which must not be silently treated as members (R2-F4).
  const memberIds = new Set(roster.filter((r) => !r.isSub).map((r) => r.playerId));
  const subIds = new Set(roster.filter((r) => r.isSub).map((r) => r.playerId));
  // Overall high (incl. subs) — for subSpoiled color only.
  let overallMax = -Infinity;
  for (const h of hr) overallMax = Math.max(overallMax, h.sp + h.mp);
  const overallWinnerIsSub = hr.some((h) => h.sp + h.mp === overallMax && subIds.has(h.playerId));

  // The bet's winner = top MEMBER. Dead-heats (F7/F12) keep ALL co-winners; the
  // verdict grades on the set. Display picks the lowest-id winner (deterministic).
  let memberMax = -Infinity;
  for (const h of hr) {
    if (!memberIds.has(h.playerId)) continue; // known members only
    memberMax = Math.max(memberMax, h.sp + h.mp);
  }
  const winnerSet = hr
    .filter((h) => memberIds.has(h.playerId) && h.sp + h.mp === memberMax)
    .map((h) => h.playerId)
    .sort((a, b) => a - b);
  const winningMemberId = winnerSet.length ? winnerSet[0]! : null;

  const lines = ('gated' in odds && odds.gated) ? [] : odds.lines;
  const favoriteId = lines.length ? lines[0]!.playerId : null;
  const winnerLine = lines.find((l) => l.playerId === winningMemberId) ?? null;
  const anyWinnerPriced = winnerSet.some((id) => lines.find((l) => l.playerId === id)?.postedAmerican != null);
  const favoriteWon = favoriteId !== null && winnerSet.includes(favoriteId);

  let verdict: Retrospective['verdict'];
  if (winningMemberId === null || !anyWinnerPriced) {
    verdict = 'busted'; // no winning member was on the posted board (ungated / "—")
  } else if (favoriteWon) {
    verdict = 'chalk';
  } else {
    verdict = 'upset';
  }

  return {
    winningMemberId,
    winningMemberName: winningMemberId !== null ? nameOf.get(winningMemberId) ?? `#${winningMemberId}` : null,
    subSpoiled: overallWinnerIsSub,
    verdict,
    favoriteId,
    favoriteName: favoriteId !== null ? nameOf.get(favoriteId) ?? `#${favoriteId}` : null,
    winnerPostedAmerican: winnerLine?.postedAmerican ?? null,
  };
}

// ===========================================================================
// House ledger (Block C) — recompute-on-read House P&L + calibration vs.
// baselines over finalized weeks with ≥ MIN_FIELD_ROUNDS prior rounds.
// Entertainment-only; off-board winner ⇒ house keeps all stakes; below-gate
// weeks excluded from the cumulative. (F4/F11/F13/NEW-1)
// ===========================================================================

interface HouseLedger {
  openWeeks: number;
  cumulativeUnits: number;
  totalStakes: number;
  theoreticalHold: number;
  effectiveHold: number;
  realizedHold: number;
  perWeek: Array<{ roundId: number; date: string; housePnl: number; cumulative: number; effectiveHold: number }>;
  validity: {
    logLoss: number;
    brier: number;
    baselines: {
      uniform: { logLoss: number; brier: number };
      handicapOnly: { logLoss: number; brier: number };
      lastWeek: { logLoss: number; brier: number };
    };
    ci: {
      logLoss: { mean: number; lo: number; hi: number };
      vsUniform: { mean: number; lo: number; hi: number };
      vsHandicapOnly: { mean: number; lo: number; hi: number };
      vsLastWeek: { mean: number; lo: number; hi: number };
    };
  } | null;
}

function emptyLedger(): HouseLedger {
  return {
    openWeeks: 0, cumulativeUnits: 0, totalStakes: 0,
    theoreticalHold: r4(1 - 1 / DEFAULT_ODDS_CONSTANTS.OVERROUND), effectiveHold: 0, realizedHold: 0,
    perWeek: [], validity: null,
  };
}

async function buildHouseLedger(seasonId: number, uptoDate: string): Promise<HouseLedger> {
  const C = DEFAULT_ODDS_CONSTANTS;
  const H = HOUSE_CONSTANTS;
  const empty = emptyLedger();

  // Finalized official rounds in the season up to (and including) the viewed week.
  const ledgerRounds = await db
    .select({ id: rounds.id, date: rounds.scheduledDate })
    .from(rounds)
    .where(and(eq(rounds.seasonId, seasonId), eq(rounds.type, 'official'), eq(rounds.status, 'finalized'), lte(rounds.scheduledDate, uptoDate)))
    .orderBy(rounds.scheduledDate, rounds.id);
  if (ledgerRounds.length <= C.MIN_FIELD_ROUNDS) return empty; // no week clears the gate

  const ids = ledgerRounds.map((r) => r.id);
  const [rosterAll, resultAll, harveyAll] = await Promise.all([
    db.select({ roundId: roundPlayers.roundId, playerId: roundPlayers.playerId, isSub: roundPlayers.isSub, hi: roundPlayers.handicapIndex })
      .from(roundPlayers).where(inArray(roundPlayers.roundId, ids)),
    db.select({ roundId: roundResults.roundId, playerId: roundResults.playerId, stableford: roundResults.stablefordTotal, money: roundResults.moneyTotal })
      .from(roundResults).where(inArray(roundResults.roundId, ids)),
    db.select({ roundId: harveyResults.roundId, playerId: harveyResults.playerId, sp: harveyResults.stablefordPoints, mp: harveyResults.moneyPoints })
      .from(harveyResults).where(inArray(harveyResults.roundId, ids)),
  ]);

  const rosterByRound = new Map<number, Array<{ playerId: number; isSub: boolean; hi: number }>>();
  for (const r of rosterAll) {
    const arr = rosterByRound.get(r.roundId) ?? [];
    arr.push({ playerId: r.playerId, isSub: r.isSub === 1, hi: r.hi });
    rosterByRound.set(r.roundId, arr);
  }
  const harveyByRound = new Map<number, Map<number, number>>(); // roundId → (playerId → combined points)
  for (const h of harveyAll) {
    const m = harveyByRound.get(h.roundId) ?? new Map<number, number>();
    m.set(h.playerId, h.sp + h.mp);
    harveyByRound.set(h.roundId, m);
  }
  // Pre-index results by (round → player) so per-week field/sub-prior assembly is
  // O(1) lookups instead of `.filter`/`.find` over the whole season each week (F5).
  const resultByRound = new Map<number, Map<number, { stableford: number; money: number }>>();
  for (const r of resultAll) {
    const m = resultByRound.get(r.roundId) ?? new Map<number, { stableford: number; money: number }>();
    m.set(r.playerId, { stableford: r.stableford, money: r.money });
    resultByRound.set(r.roundId, m);
  }

  const perWeek: HouseLedger['perWeek'] = [];
  const series = { ours: [] as number[], uniform: [] as number[], handicapOnly: [] as number[], lastWeek: [] as number[] };
  const brierSeries = { ours: [] as number[], uniform: [] as number[], handicapOnly: [] as number[], lastWeek: [] as number[] };
  let cumulativeUnits = 0;
  let totalStakes = 0;
  let effectiveHoldSum = 0;

  for (let w = 0; w < ledgerRounds.length; w++) {
    if (w < C.MIN_FIELD_ROUNDS) continue; // need ≥ MIN_FIELD_ROUNDS prior rounds
    const W = ledgerRounds[w]!;
    const roster = rosterByRound.get(W.id) ?? [];
    if (roster.length === 0) continue;
    const priorRounds = ledgerRounds.slice(0, w);

    // Field histories + pooled sub prior from prior finalized rounds (indexed lookups).
    const field = roster.map((p) => ({
      playerId: p.playerId,
      isSub: p.isSub,
      history: priorRounds.flatMap((pr, i) => {
        const res = resultByRound.get(pr.id)?.get(p.playerId);
        return res ? [{ stableford: res.stableford, money: res.money, orderIndex: i }] : [];
      }),
    }));
    const subPrior: Array<{ stableford: number; money: number }> = [];
    for (const pr of priorRounds) {
      for (const p of rosterByRound.get(pr.id) ?? []) {
        if (!p.isSub) continue;
        const res = resultByRound.get(pr.id)?.get(p.playerId);
        if (res) subPrior.push({ stableford: res.stableford, money: res.money });
      }
    }

    const odds = computeOddsLine({ field, subPrior, priorRoundCount: w, seed: W.id });
    if (odds.gated) continue;

    // Actual top member(s) this week.
    const wHarvey = harveyByRound.get(W.id);
    if (!wHarvey) continue;
    const members = roster.filter((p) => !p.isSub).map((p) => p.playerId);
    let memberMax = -Infinity;
    for (const id of members) memberMax = Math.max(memberMax, wHarvey.get(id) ?? -Infinity);
    // Sorted so the dead-heat winner picked for calibration is order-independent (F7).
    const winners = members.filter((id) => (wHarvey.get(id) ?? -Infinity) === memberMax).sort((a, b) => a - b);
    if (winners.length === 0) continue;
    const winnerShare = 1 / winners.length;

    // Priced members (a posted price) + recent-form z (last RECENCY_HALF_LIFE prior rounds of combined Harvey pts).
    const priced = odds.lines.filter((l) => l.postedAmerican !== null);
    const recentMeanOf = (pid: number): number => {
      const pts: number[] = [];
      for (const pr of priorRounds) pts.push(harveyByRound.get(pr.id)?.get(pid) ?? NaN);
      const recent = pts.filter((x) => !Number.isNaN(x)).slice(-C.RECENCY_HALF_LIFE);
      return recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    };
    const formMeans = priced.map((l) => recentMeanOf(l.playerId));
    const fm = formMeans.reduce((a, b) => a + b, 0) / (formMeans.length || 1);
    const fsd = Math.sqrt(formMeans.reduce((a, b) => a + (b - fm) ** 2, 0) / (formMeans.length || 1)) || 1;
    const formZ = formMeans.map((m) => (m - fm) / fsd);

    const { housePnl, totalStakes: stakes } = simulateWeekHousePnl({
      pricedMemberIds: priced.map((l) => l.playerId),
      postedAmerican: priced.map((l) => l.postedAmerican!),
      formZ,
      winningMemberIds: winners,
      winnerShare,
      seed: (W.id * 0x9e3779b1) >>> 0,
      nBettors: H.N_BETTORS,
      stakeUnit: H.STAKE_UNIT,
      bias: H.PUBLIC_FAV_BIAS,
    });
    cumulativeUnits += housePnl;
    totalStakes += stakes;
    effectiveHoldSum += odds.effectiveHold;
    perWeek.push({ roundId: W.id, date: W.date, housePnl: r2(housePnl), cumulative: r2(cumulativeUnits), effectiveHold: r4(odds.effectiveHold) });

    // ---- Calibration: our line vs. baselines (fair prob; winner floored) ----
    const memberList = odds.lines.map((l) => l.playerId);
    const N = memberList.length;
    const winnerForScore = winners[0]!; // deterministic single winner for log-loss
    const ourMap = new Map(odds.lines.map((l) => [l.playerId, l.fairProb]));
    const uniformMap = new Map(memberList.map((id) => [id, 1 / N]));
    // handicap-only: softmax(−HI) over members (deliberately naive — net Stableford equalizes).
    const hiOf = new Map(roster.map((p) => [p.playerId, p.hi]));
    const negHi = memberList.map((id) => -(hiOf.get(id) ?? 0));
    const maxNh = Math.max(...negHi);
    const exps = negHi.map((x) => Math.exp(x - maxNh));
    const expSum = exps.reduce((a, b) => a + b, 0) || 1;
    const handicapMap = new Map(memberList.map((id, i) => [id, exps[i]! / expSum]));
    // last-week-winner: mass on the previous finalized week's top member.
    // Tie-break to the lowest id so the baseline is order-independent (R2-F2).
    const prevW = ledgerRounds[w - 1]!;
    const prevHarvey = harveyByRound.get(prevW.id);
    const prevRoster = rosterByRound.get(prevW.id) ?? [];
    let prevWinner: number | null = null;
    if (prevHarvey) {
      let mx = -Infinity;
      for (const p of prevRoster) {
        if (p.isSub) continue;
        const v = prevHarvey.get(p.playerId) ?? -Infinity;
        if (v > mx || (v === mx && prevWinner !== null && p.playerId < prevWinner)) { mx = v; prevWinner = p.playerId; }
      }
    }
    const lastWeekMap = new Map<number, number>();
    // N=1 (or prev winner absent): a valid distribution is just {member: 1} (R2-F3).
    const others = N > 1 ? (1 - H.LAST_WEEK_P) / (N - 1) : 0;
    for (const id of memberList) lastWeekMap.set(id, id === prevWinner ? H.LAST_WEEK_P : others);
    if (N === 1 || prevWinner === null || !memberList.includes(prevWinner)) {
      for (const id of memberList) lastWeekMap.set(id, 1 / N); // fall back to uniform
    }

    const ours = logLossAndBrier(ourMap, memberList, winnerForScore);
    const uni = logLossAndBrier(uniformMap, memberList, winnerForScore);
    const hcp = logLossAndBrier(handicapMap, memberList, winnerForScore);
    const lw = logLossAndBrier(lastWeekMap, memberList, winnerForScore);
    series.ours.push(ours.logLoss); series.uniform.push(uni.logLoss); series.handicapOnly.push(hcp.logLoss); series.lastWeek.push(lw.logLoss);
    brierSeries.ours.push(ours.brier); brierSeries.uniform.push(uni.brier); brierSeries.handicapOnly.push(hcp.brier); brierSeries.lastWeek.push(lw.brier);
  }

  const openWeeks = perWeek.length;
  if (openWeeks === 0) return empty;

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const paired = (a: number[], b: number[]) => a.map((x, i) => x - b[i]!);
  // Deterministic bootstrap seed off the season + week count.
  const bootSeed = ((seasonId * 0x85ebca6b) ^ (openWeeks * 0xc2b2ae35)) >>> 0;

  const validity: HouseLedger['validity'] = {
    logLoss: r4(mean(series.ours)),
    brier: r4(mean(brierSeries.ours)),
    baselines: {
      uniform: { logLoss: r4(mean(series.uniform)), brier: r4(mean(brierSeries.uniform)) },
      handicapOnly: { logLoss: r4(mean(series.handicapOnly)), brier: r4(mean(brierSeries.handicapOnly)) },
      lastWeek: { logLoss: r4(mean(series.lastWeek)), brier: r4(mean(brierSeries.lastWeek)) },
    },
    ci: {
      logLoss: ((b) => ({ mean: r4(b.mean), lo: r4(b.lo), hi: r4(b.hi) }))(bootstrapMeanCI(series.ours, bootSeed)),
      vsUniform: ((b) => ({ mean: r4(b.mean), lo: r4(b.lo), hi: r4(b.hi) }))(bootstrapMeanCI(paired(series.ours, series.uniform), bootSeed ^ 0x1)),
      vsHandicapOnly: ((b) => ({ mean: r4(b.mean), lo: r4(b.lo), hi: r4(b.hi) }))(bootstrapMeanCI(paired(series.ours, series.handicapOnly), bootSeed ^ 0x2)),
      vsLastWeek: ((b) => ({ mean: r4(b.mean), lo: r4(b.lo), hi: r4(b.hi) }))(bootstrapMeanCI(paired(series.ours, series.lastWeek), bootSeed ^ 0x3)),
    },
  };

  return {
    openWeeks,
    cumulativeUnits: r2(cumulativeUnits),
    totalStakes: r2(totalStakes),
    theoreticalHold: r4(1 - 1 / C.OVERROUND),
    effectiveHold: r4(effectiveHoldSum / openWeeks),
    realizedHold: r4(totalStakes > 0 ? cumulativeUnits / totalStakes : 0),
    perWeek,
    validity,
  };
}

export default app;
