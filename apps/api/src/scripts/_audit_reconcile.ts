/**
 * AUDIT (throwaway): independent money re-derivation + 3-way reconciliation.
 *
 * For each finalized 2026 round, compute each player's money THREE ways and compare:
 *   (1) PERSISTED   — round_results.money_total (what the app stored / was "paid")
 *   (2) APP-STATS   — computeRoundMoneyBreakdown() (the read-only stats aggregator)
 *   (3) INDEPENDENT — this file's own assembly over the engine's pure primitives
 *
 * Also checks the per-group zero-sum invariant on the independent path.
 * Read-only. Point DB_PATH at the prod snapshot copy.
 */
import { eq } from 'drizzle-orm';
import {
  getWolfAssignment,
  getCourseHole,
  calculateHoleMoney,
  applyBonusModifiers,
  getHandicapStrokes,
  calcCourseHandicap,
  type Tee,
  type WolfDecision,
  type BonusInput,
  type BattingPosition,
  type HoleNumber,
  type HoleAssignment,
} from '@wolf-cup/engine';
import { db } from '../db/index.js';
import { rounds, groups, roundPlayers, holeScores, wolfDecisions, roundResults } from '../db/schema.js';
import { computeRoundMoneyBreakdown } from '../lib/money-breakdown.js';

function buildWolfDecision(decision: string, partnerPlayerId: number | null, order: number[]): WolfDecision {
  if (decision === 'alone') return { type: 'alone' };
  if (decision === 'blind_wolf') return { type: 'blind_wolf' };
  return { type: 'partner', partnerBatterIndex: order.indexOf(partnerPlayerId!) as BattingPosition };
}
function buildBonusInput(json: string | null, order: number[]): BonusInput {
  if (!json) return { greenies: [], polies: [], sandies: [] };
  const p = JSON.parse(json) as { greenies?: number[]; polies?: number[]; sandies?: number[] };
  const m = (ids: number[] = []) => ids.map((id) => order.indexOf(id) as BattingPosition).filter((x) => x >= 0);
  return { greenies: m(p.greenies), polies: m(p.polies), sandies: m(p.sandies) };
}

async function independentRound(roundId: number, tee: Tee) {
  const grps = await db.select({ id: groups.id, battingOrder: groups.battingOrder }).from(groups).where(eq(groups.roundId, roundId));
  const scores = await db.select({ groupId: holeScores.groupId, playerId: holeScores.playerId, holeNumber: holeScores.holeNumber, gross: holeScores.grossScore }).from(holeScores).where(eq(holeScores.roundId, roundId));
  const decs = await db.select({ groupId: wolfDecisions.groupId, holeNumber: wolfDecisions.holeNumber, decision: wolfDecisions.decision, partnerPlayerId: wolfDecisions.partnerPlayerId, bonusesJson: wolfDecisions.bonusesJson }).from(wolfDecisions).where(eq(wolfDecisions.roundId, roundId));
  const hcps = await db.select({ groupId: roundPlayers.groupId, playerId: roundPlayers.playerId, hi: roundPlayers.handicapIndex }).from(roundPlayers).where(eq(roundPlayers.roundId, roundId));

  const totals = new Map<number, number>();
  const groupSums: { groupId: number; sum: number }[] = [];

  for (const g of grps) {
    if (!g.battingOrder) continue;
    const order = JSON.parse(g.battingOrder) as number[];
    if (order.length !== 4) continue;

    const gh = hcps.filter((h) => h.groupId === g.id).map((h) => ({ playerId: h.playerId, ch: calcCourseHandicap(h.hi, tee) }));
    const minCH = Math.min(...gh.map((x) => x.ch));
    const relCH = new Map(gh.map((x) => [x.playerId, x.ch - minCH]));

    const byHole = new Map<number, Map<number, number>>();
    for (const s of scores) { if (s.groupId !== g.id) continue; if (!byHole.has(s.holeNumber)) byHole.set(s.holeNumber, new Map()); byHole.get(s.holeNumber)!.set(s.playerId, s.gross); }
    const decByHole = new Map<number, typeof decs[number]>();
    for (const d of decs) { if (d.groupId === g.id) decByHole.set(d.holeNumber, d); }

    let gSum = 0;
    for (let hole = 1; hole <= 18; hole++) {
      const sm = byHole.get(hole);
      if (!sm || order.some((pid) => !sm.has(pid))) continue;
      const ch = getCourseHole(hole as HoleNumber);
      const assignment: HoleAssignment = getWolfAssignment([0, 1, 2, 3], hole as HoleNumber);
      const gross = order.map((pid) => sm.get(pid)!) as [number, number, number, number];
      const net = order.map((pid, i) => gross[i]! - getHandicapStrokes(relCH.get(pid) ?? 0, ch.strokeIndex)) as [number, number, number, number];

      let wolfDec: WolfDecision | null = null;
      if (assignment.type === 'wolf') {
        const d = decByHole.get(hole);
        if (!d?.decision) continue;
        wolfDec = buildWolfDecision(d.decision, d.partnerPlayerId, order);
      }
      const base = calculateHoleMoney(net, assignment, wolfDec, ch.par as 3 | 4 | 5);
      const res = assignment.type === 'wolf'
        ? applyBonusModifiers(base, net, gross, buildBonusInput(decByHole.get(hole)?.bonusesJson ?? null, order), assignment, wolfDec!, ch.par)
        : base;
      for (let pos = 0; pos < 4; pos++) {
        const pid = order[pos]!;
        totals.set(pid, (totals.get(pid) ?? 0) + res[pos]!.total);
        gSum += res[pos]!.total;
      }
    }
    groupSums.push({ groupId: g.id, sum: gSum });
  }
  return { totals, groupSums };
}

async function main() {
  const finals = await db.select({ id: rounds.id, date: rounds.scheduledDate, tee: rounds.tee }).from(rounds).where(eq(rounds.status, 'finalized'));
  finals.sort((a, b) => (a.date < b.date ? -1 : 1));

  const subRows = await db.select({ roundId: roundPlayers.roundId, playerId: roundPlayers.playerId, isSub: roundPlayers.isSub }).from(roundPlayers);
  const subSet = new Set(subRows.filter((r) => r.isSub === 1).map((r) => `${r.roundId}:${r.playerId}`));

  let anyMismatch = false;
  for (const r of finals) {
    const tee = (r.tee as Tee) ?? 'blue';
    const indep = await independentRound(r.id, tee);
    const breakdown = await computeRoundMoneyBreakdown(r.id);
    const persistedRows = await db.select({ playerId: roundResults.playerId, money: roundResults.moneyTotal }).from(roundResults).where(eq(roundResults.roundId, r.id));
    const persisted = new Map(persistedRows.map((x) => [x.playerId, x.money]));

    const pids = new Set<number>([...indep.totals.keys(), ...persisted.keys(), ...breakdown.perPlayerTotals.keys()]);
    console.log(`\n=== Round ${r.id} (${r.date}, ${tee}) ===`);
    let indepSum = 0, persistedSum = 0;
    const rows: string[] = [];
    for (const pid of [...pids].sort((a, b) => a - b)) {
      const ind = indep.totals.get(pid) ?? 0;
      const app = breakdown.perPlayerTotals.get(pid)?.total ?? 0;
      const per = persisted.get(pid) ?? 0;
      indepSum += ind; persistedSum += per;
      const sub = subSet.has(`${r.id}:${pid}`) ? ' [SUB]' : '';
      const flagAppVsInd = app !== ind ? '  <-- APP!=INDEP' : '';
      const flagPerVsInd = per !== ind ? '  <-- PERSISTED!=INDEP' : '';
      if (app !== ind || per !== ind) anyMismatch = true;
      rows.push(`  p${pid}${sub}: indep=${ind}  app=${app}  persisted=${per}${flagAppVsInd}${flagPerVsInd}`);
    }
    console.log(rows.join('\n'));
    const groupZero = indep.groupSums.every((g) => g.sum === 0);
    console.log(`  group zero-sum: ${indep.groupSums.map((g) => `g${g.groupId}=${g.sum}`).join(', ')}  ${groupZero ? 'OK' : 'VIOLATION'}`);
    console.log(`  round totals: indepSum=${indepSum} persistedSum=${persistedSum}`);
  }
  console.log(`\n==== OVERALL: ${anyMismatch ? 'DISCREPANCIES FOUND (see flags above)' : 'ALL THREE PATHS AGREE on every player, every round'} ====`);
  process.exit(0);
}
main();
