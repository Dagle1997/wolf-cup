/**
 * seed-demo.ts — Creates 6 finalized official rounds of test data.
 *
 * Run from repo root on server:
 *   DB_PATH=/data/wolf-cup.db npx tsx apps/api/scripts/seed-demo.ts
 */

import { desc, eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  seasons,
  rounds,
  groups,
  roundPlayers,
  players,
  holeScores,
  wolfDecisions,
  roundResults,
  harveyResults as harveyResultsTable,
} from '../db/schema.js';
import {
  getCourseHole,
  getHandicapStrokes,
  calculateStablefordPoints,
  calculateHoleMoney,
  calculateHarveyPoints,
  getWolfAssignment,
} from '@wolf-cup/engine';
import type {
  HoleNumber,
  WolfDecision,
  HoleAssignment,
  BattingPosition,
} from '@wolf-cup/engine';

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — reproducible results
// ---------------------------------------------------------------------------

let _seed = 12345;
function rng(): number {
  _seed |= 0;
  _seed = (_seed + 0x6d2b79f5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Gross score generator (realistic amateur distribution around net par)
// ---------------------------------------------------------------------------

function generateGrossScore(par: number, handicapStrokes: number): number {
  const base = par + handicapStrokes; // net par baseline
  const roll = rng();
  let adj: number;
  if (roll < 0.03) adj = -2;      // 3%  eagle
  else if (roll < 0.15) adj = -1; // 12% birdie
  else if (roll < 0.40) adj = 0;  // 25% par
  else if (roll < 0.72) adj = 1;  // 32% bogey
  else if (roll < 0.90) adj = 2;  // 18% double
  else if (roll < 0.97) adj = 3;  // 7%  triple
  else adj = 4;                   // 3%  quad
  return Math.max(1, Math.min(20, base + adj));
}

// ---------------------------------------------------------------------------
// Harvey Cup bonus per player based on round player count
// From epics: 4→+8, 8→+6, 12→+4, 16→+2, other→0
// ---------------------------------------------------------------------------

function harveyBonus(playerCount: number): number {
  const lookup: Record<number, number> = { 1: 8, 2: 6, 3: 4, 4: 2 };
  return lookup[Math.floor(playerCount / 4)] ?? 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function seed() {
  // Get current season (most recent by startDate)
  const season = await db
    .select({ id: seasons.id, name: seasons.name })
    .from(seasons)
    .orderBy(desc(seasons.startDate))
    .get();

  if (!season) {
    console.error('No season found. Create a season first via the admin panel.');
    process.exit(1);
  }
  console.log(`Seeding demo data for season: "${season.name}" (id=${season.id})\n`);

  // Get all active non-guest players
  const allPlayers = await db
    .select({ id: players.id, name: players.name, handicapIndex: players.handicapIndex })
    .from(players)
    .where(and(eq(players.isActive, 1), eq(players.isGuest, 0)));

  if (allPlayers.length < 8) {
    console.error(`Need at least 8 active players, found ${allPlayers.length}.`);
    process.exit(1);
  }
  console.log(`Found ${allPlayers.length} active players.\n`);

  // Round config: 6 Sundays, varying player counts (always multiples of 4)
  const roundConfig = [
    { date: '2026-01-18', targetPlayers: 8,  tee: 'blue'  as const },
    { date: '2026-01-25', targetPlayers: 12, tee: 'white' as const },
    { date: '2026-02-01', targetPlayers: 16, tee: 'blue'  as const },
    { date: '2026-02-08', targetPlayers: 12, tee: 'white' as const },
    { date: '2026-02-15', targetPlayers: 8,  tee: 'blue'  as const },
    { date: '2026-02-22', targetPlayers: 16, tee: 'white' as const },
  ];

  for (const cfg of roundConfig) {
    const desired = Math.min(cfg.targetPlayers, allPlayers.length);
    const actualCount = Math.floor(desired / 4) * 4;
    const now = Date.now();

    console.log(`Round ${cfg.date} — ${actualCount} players, ${actualCount / 4} groups, ${cfg.tee} tees`);

    // Create the round
    const [roundRow] = await db
      .insert(rounds)
      .values({
        seasonId: season.id,
        type: 'official',
        status: 'active',
        scheduledDate: cfg.date,
        tee: cfg.tee,
        autoCalculateMoney: 1,
        createdAt: now,
      })
      .returning({ id: rounds.id });
    const roundId = roundRow!.id;

    // Pick players for this round
    const roundPlayerList = shuffle(allPlayers).slice(0, actualCount);

    // Per-player accumulators (across all groups)
    const stablefordMap = new Map<number, number>(roundPlayerList.map(p => [p.id, 0]));
    const moneyMap = new Map<number, number>(roundPlayerList.map(p => [p.id, 0]));

    // Process each group of 4
    for (let gIdx = 0; gIdx < actualCount / 4; gIdx++) {
      const groupPlayerList = roundPlayerList.slice(gIdx * 4, gIdx * 4 + 4);
      const battingOrder = groupPlayerList.map(p => p.id) as [number, number, number, number];

      const [groupRow] = await db
        .insert(groups)
        .values({
          roundId,
          groupNumber: gIdx + 1,
          battingOrder: JSON.stringify(battingOrder),
          tee: cfg.tee,
        })
        .returning({ id: groups.id });
      const groupId = groupRow!.id;

      for (const p of groupPlayerList) {
        await db.insert(roundPlayers).values({
          roundId,
          groupId,
          playerId: p.id,
          handicapIndex: p.handicapIndex ?? 12.0,
          isSub: 0,
        });
      }

      const holeScoreRows: (typeof holeScores.$inferInsert)[] = [];
      const wolfDecisionRows: (typeof wolfDecisions.$inferInsert)[] = [];

      for (let holeNum = 1; holeNum <= 18; holeNum++) {
        const courseHole = getCourseHole(holeNum as HoleNumber);
        const handicaps = groupPlayerList.map(p => p.handicapIndex ?? 12.0);

        // Generate gross scores and compute stableford
        const grossScores = handicaps.map(hi => {
          const strokes = getHandicapStrokes(hi, courseHole.strokeIndex);
          return generateGrossScore(courseHole.par, strokes);
        });

        const netScores = grossScores.map((gross, i) => {
          const strokes = getHandicapStrokes(handicaps[i]!, courseHole.strokeIndex);
          return gross - strokes;
        }) as [number, number, number, number];

        for (let pos = 0; pos < 4; pos++) {
          const p = groupPlayerList[pos]!;
          holeScoreRows.push({
            roundId, groupId,
            playerId: p.id,
            holeNumber: holeNum,
            grossScore: grossScores[pos]!,
            createdAt: now, updatedAt: now,
          });
          const pts = calculateStablefordPoints(
            grossScores[pos]!, handicaps[pos]!, courseHole.par, courseHole.strokeIndex,
          );
          stablefordMap.set(p.id, (stablefordMap.get(p.id) ?? 0) + pts);
        }

        const holeAssignment: HoleAssignment = getWolfAssignment([0, 1, 2, 3] as const, holeNum as Parameters<typeof getWolfAssignment>[1]);

        if (holeAssignment.type === 'wolf') {
          // Wolf hole — generate a decision
          const wolfBatterIndex = holeAssignment.wolfBatterIndex;
          const wolfPlayerId = groupPlayerList[wolfBatterIndex]!.id;
          const roll = rng();
          let decisionStr: string;
          let partnerPlayerId: number | null = null;
          let wolfDecision: WolfDecision;

          if (roll < 0.70) {
            // Partner (70%)
            const others = ([0, 1, 2, 3] as BattingPosition[]).filter(i => i !== wolfBatterIndex);
            const partnerPos = pickRandom(others);
            partnerPlayerId = groupPlayerList[partnerPos]!.id;
            wolfDecision = { type: 'partner', partnerBatterIndex: partnerPos };
            decisionStr = 'partner';
          } else if (roll < 0.90) {
            // Alone (20%)
            wolfDecision = { type: 'alone' };
            decisionStr = 'alone';
          } else {
            // Blind wolf (10%)
            wolfDecision = { type: 'blind_wolf' };
            decisionStr = 'blind_wolf';
          }

          const moneyResult = calculateHoleMoney(netScores, holeAssignment, wolfDecision, courseHole.par);
          const wolfMoney = moneyResult[wolfBatterIndex]!.total;
          const outcome = wolfMoney > 0 ? 'win' : wolfMoney < 0 ? 'loss' : 'push';

          wolfDecisionRows.push({
            roundId, groupId,
            holeNumber: holeNum,
            wolfPlayerId,
            decision: decisionStr,
            partnerPlayerId,
            bonusesJson: null,
            outcome,
            createdAt: now,
          });

          for (let pos = 0; pos < 4; pos++) {
            const pid = groupPlayerList[pos]!.id;
            moneyMap.set(pid, (moneyMap.get(pid) ?? 0) + moneyResult[pos]!.total);
          }
        } else {
          // Skins hole — no wolf decision record
          const moneyResult = calculateHoleMoney(netScores, { type: 'skins' }, null, courseHole.par);
          for (let pos = 0; pos < 4; pos++) {
            const pid = groupPlayerList[pos]!.id;
            moneyMap.set(pid, (moneyMap.get(pid) ?? 0) + moneyResult[pos]!.total);
          }
        }
      }

      await db.insert(holeScores).values(holeScoreRows);
      if (wolfDecisionRows.length > 0) {
        await db.insert(wolfDecisions).values(wolfDecisionRows);
      }
    }

    // Insert round_results
    await db.insert(roundResults).values(
      roundPlayerList.map(p => ({
        roundId,
        playerId: p.id,
        stablefordTotal: stablefordMap.get(p.id) ?? 0,
        moneyTotal: moneyMap.get(p.id) ?? 0,
        updatedAt: now,
      })),
    );

    // Compute and insert harvey_results
    const bonus = harveyBonus(actualCount);
    const harveyInputs = roundPlayerList.map(p => ({
      stableford: stablefordMap.get(p.id) ?? 0,
      money: moneyMap.get(p.id) ?? 0,
    }));
    const harveyPts = calculateHarveyPoints(harveyInputs, 'regular', bonus);

    const byStableford = [...roundPlayerList].sort(
      (a, b) => (stablefordMap.get(b.id) ?? 0) - (stablefordMap.get(a.id) ?? 0),
    );
    const byMoney = [...roundPlayerList].sort(
      (a, b) => (moneyMap.get(b.id) ?? 0) - (moneyMap.get(a.id) ?? 0),
    );

    await db.insert(harveyResultsTable).values(
      roundPlayerList.map((p, i) => ({
        roundId,
        playerId: p.id,
        stablefordRank: byStableford.findIndex(x => x.id === p.id) + 1,
        moneyRank: byMoney.findIndex(x => x.id === p.id) + 1,
        stablefordPoints: harveyPts[i]!.stablefordPoints,
        moneyPoints: harveyPts[i]!.moneyPoints,
        updatedAt: now,
      })),
    );

    // Finalize the round
    await db.update(rounds).set({ status: 'finalized' }).where(eq(rounds.id, roundId));

    // Print top 3
    const top3 = [...roundPlayerList]
      .sort((a, b) => (stablefordMap.get(b.id) ?? 0) - (stablefordMap.get(a.id) ?? 0))
      .slice(0, 3);
    top3.forEach((p, i) => {
      const stab = stablefordMap.get(p.id) ?? 0;
      const money = moneyMap.get(p.id) ?? 0;
      console.log(`  ${i + 1}. ${p.name}: ${stab} stableford, ${money >= 0 ? '+' : ''}$${money}`);
    });
    console.log();
  }

  console.log('✅ Demo seed complete — 6 rounds finalized.');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
