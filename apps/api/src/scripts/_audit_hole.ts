/* eslint-disable @typescript-eslint/no-explicit-any -- throwaway audit script */
import { getCourseHole, getWolfAssignment, getHandicapStrokes, calcCourseHandicap, calculateHoleMoney, applyBonusModifiers } from '@wolf-cup/engine';
import { db } from '../db/index.js';
import { groups, roundPlayers, holeScores, wolfDecisions, players } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

const RID = 47, HOLE = 8, TEE = 'white' as const;
const g = (await db.select({ id: groups.id, bo: groups.battingOrder }).from(groups).where(eq(groups.roundId, RID)))[0]!;
const order = JSON.parse(g.bo!) as number[];
const hcps = await db.select({ pid: roundPlayers.playerId, hi: roundPlayers.handicapIndex }).from(roundPlayers).where(and(eq(roundPlayers.roundId, RID), eq(roundPlayers.groupId, g.id)));
const nm = Object.fromEntries((await db.select({ id: players.id, name: players.name }).from(players)).map((r) => [r.id, r.name]));
const ch = getCourseHole(HOLE);
const gh = hcps.map((h) => ({ pid: h.pid, ch: calcCourseHandicap(h.hi, TEE), hi: h.hi }));
const minCH = Math.min(...gh.map((x) => x.ch));
const rel: Record<number, number> = Object.fromEntries(gh.map((x) => [x.pid, x.ch - minCH]));
const sc = await db.select({ pid: holeScores.playerId, gross: holeScores.grossScore }).from(holeScores).where(and(eq(holeScores.roundId, RID), eq(holeScores.groupId, g.id), eq(holeScores.holeNumber, HOLE)));
const grossOf: Record<number, number> = Object.fromEntries(sc.map((s) => [s.pid, s.gross]));
const d = (await db.select({ dec: wolfDecisions.decision, partner: wolfDecisions.partnerPlayerId, bonuses: wolfDecisions.bonusesJson }).from(wolfDecisions).where(and(eq(wolfDecisions.roundId, RID), eq(wolfDecisions.groupId, g.id), eq(wolfDecisions.holeNumber, HOLE))))[0];

console.log(`Round ${RID} Group ${g.id} Hole ${HOLE} | par ${ch.par} SI ${ch.strokeIndex} tee ${TEE}`);
console.log('Wolf:', JSON.stringify(getWolfAssignment([0, 1, 2, 3], HOLE)), 'decision:', d?.dec, 'partner:', d?.partner ? nm[d.partner] : null, 'bonuses:', d?.bonuses || 'none');
const gross = order.map((p) => grossOf[p]!);
const strokes = order.map((p) => getHandicapStrokes(rel[p]!, ch.strokeIndex));
const net = order.map((p, i) => gross[i]! - strokes[i]!);
order.forEach((p, i) => console.log(`  pos${i} ${nm[p]!.padEnd(16)} HI=${gh.find((x) => x.pid === p)!.hi} CH=${gh.find((x) => x.pid === p)!.ch} relCH=${rel[p]} gross=${gross[i]} strokes=${strokes[i]} net=${net[i]}`));
const asg = getWolfAssignment([0, 1, 2, 3], HOLE);
const wd: any = d?.dec === 'partner' ? { type: 'partner', partnerBatterIndex: order.indexOf(d.partner!) } : d?.dec ? { type: d.dec } : null;
const base = calculateHoleMoney(net as any, asg, wd, ch.par as 3 | 4 | 5);
const bi = d?.bonuses ? (() => { const j = JSON.parse(d.bonuses); const m = (a: number[] = []) => a.map((id) => order.indexOf(id)).filter((x) => x >= 0); return { greenies: m(j.greenies), polies: m(j.polies), sandies: m(j.sandies) }; })() : { greenies: [], polies: [], sandies: [] };
const res = asg.type === 'wolf' ? applyBonusModifiers(base, net as any, gross as any, bi as any, asg, wd, ch.par) : base;
order.forEach((p, i) => console.log(`  money ${nm[p]!.padEnd(16)} ${JSON.stringify(res[i])}`));
console.log('hole zero-sum:', res.reduce((s, x) => s + x.total, 0));
process.exit(0);
