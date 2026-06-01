// ---------------------------------------------------------------------------
// "The House" — season-wide House P&L + calibration ledger (recompute-on-read).
//
// ADMIN-ONLY (surfaced via GET /admin/the-house). Originally lived on the public
// /scouting response, but it's an operator/validity tool (and the heaviest part
// of the read — N weeks × SIM_COUNT sims), so it was pulled off the public page.
//
// Entertainment-only: off-board winner ⇒ house keeps all stakes; below-gate
// weeks excluded from the cumulative. (F4/F11/F13/NEW-1)
// ---------------------------------------------------------------------------

import { eq, and, inArray, lte } from 'drizzle-orm';
import {
  computeOddsLine, simulateWeekHousePnl, logLossAndBrier, bootstrapMeanCI,
  DEFAULT_ODDS_CONSTANTS, HOUSE_CONSTANTS,
} from '@wolf-cup/engine';
import { db } from '../db/index.js';
import { rounds, roundPlayers, roundResults, harveyResults } from '../db/schema.js';

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r2 = (x: number) => Math.round(x * 1e2) / 1e2;

export interface HouseLedger {
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

export function emptyLedger(): HouseLedger {
  return {
    openWeeks: 0, cumulativeUnits: 0, totalStakes: 0,
    theoreticalHold: r4(1 - 1 / DEFAULT_ODDS_CONSTANTS.OVERROUND), effectiveHold: 0, realizedHold: 0,
    perWeek: [], validity: null,
  };
}

export async function buildHouseLedger(seasonId: number, uptoDate: string): Promise<HouseLedger> {
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
