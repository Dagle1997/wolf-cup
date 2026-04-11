/**
 * seed-live.ts — Creates one active official round simulating mid-round progress.
 *
 * 3 groups of 4, 12 players:
 *   Group 1: thru hole 14
 *   Group 2: thru hole 13
 *   Group 3: thru hole 12
 *
 * Includes a greenie (hole 7), two polies, and natural birdies from the score dist.
 *
 * Run:
 *   docker exec wolf-cup-api node dist/scripts/seed-live.js
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
} from '../db/schema.js';
import {
  getCourseHole,
  getHandicapStrokes,
  calculateStablefordPoints,
  calculateHoleMoney,
  applyBonusModifiers,
  getWolfAssignment,
} from '@wolf-cup/engine';
import type {
  HoleNumber,
  WolfDecision,
  HoleAssignment,
  BattingPosition,
  BonusInput,
} from '@wolf-cup/engine';

// ---------------------------------------------------------------------------
// Seeded PRNG (different seed from seed-demo for variety)
// ---------------------------------------------------------------------------

let _seed = 99887;
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

function generateGrossScore(par: number, handicapStrokes: number): number {
  const base = par + handicapStrokes;
  const roll = rng();
  let adj: number;
  if (roll < 0.03) adj = -2;
  else if (roll < 0.15) adj = -1;
  else if (roll < 0.40) adj = 0;
  else if (roll < 0.72) adj = 1;
  else if (roll < 0.90) adj = 2;
  else if (roll < 0.97) adj = 3;
  else adj = 4;
  return Math.max(1, Math.min(20, base + adj));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function seedLive() {
  // Check there's no existing active round today
  const today = new Date().toISOString().slice(0, 10);

  const season = await db
    .select({ id: seasons.id, name: seasons.name })
    .from(seasons)
    .orderBy(desc(seasons.startDate))
    .get();

  if (!season) {
    console.error('No season found.');
    process.exit(1);
  }
  console.log(`Creating live round for season: "${season.name}"\n`);

  const allPlayers = await db
    .select({ id: players.id, name: players.name, handicapIndex: players.handicapIndex })
    .from(players)
    .where(and(eq(players.isActive, 1), eq(players.isGuest, 0)));

  if (allPlayers.length < 12) {
    console.error(`Need at least 12 active players, found ${allPlayers.length}.`);
    process.exit(1);
  }

  const now = Date.now();
  const roundPlayerList = shuffle(allPlayers).slice(0, 12);

  // Create active official round
  const [roundRow] = await db
    .insert(rounds)
    .values({
      seasonId: season.id,
      type: 'official',
      status: 'active',
      scheduledDate: today,
      tee: 'blue',
      autoCalculateMoney: 1,
      createdAt: now,
    })
    .returning({ id: rounds.id });
  const roundId = roundRow!.id;
  console.log(`Created round id=${roundId}, date=${today}, tee=blue`);

  // Each group plays to a different hole
  const groupThru = [14, 13, 12] as const;
  const stablefordMap = new Map<number, number>(roundPlayerList.map(p => [p.id, 0]));
  const moneyMap = new Map<number, number>(roundPlayerList.map(p => [p.id, 0]));

  // Bonus event specs: { gIdx, holeNum, greenies: [pos], polies: [pos] }
  // Greenie on group 1 (gIdx=0), hole 7 (par 3) — player at position 2
  // Polie on group 1 (gIdx=0), hole 10 — player at position 0
  // Polie on group 2 (gIdx=1), hole 8 — player at position 3
  const bonusEvents: { gIdx: number; holeNum: number; greeniePos?: BattingPosition; poliePos?: BattingPosition }[] = [
    { gIdx: 0, holeNum: 7,  greeniePos: 2 },
    { gIdx: 0, holeNum: 10, poliePos: 0 },
    { gIdx: 1, holeNum: 8,  poliePos: 3 },
  ];

  for (let gIdx = 0; gIdx < 3; gIdx++) {
    const groupPlayerList = roundPlayerList.slice(gIdx * 4, gIdx * 4 + 4);
    const battingOrder = groupPlayerList.map(p => p.id) as [number, number, number, number];
    const thruHole = groupThru[gIdx]!;

    const [groupRow] = await db
      .insert(groups)
      .values({
        roundId,
        groupNumber: gIdx + 1,
        battingOrder: JSON.stringify(battingOrder),
        tee: 'blue',
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

    for (let holeNum = 1; holeNum <= thruHole; holeNum++) {
      const courseHole = getCourseHole(holeNum as HoleNumber);
      const handicaps = groupPlayerList.map(p => p.handicapIndex ?? 12.0);

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
        const wolfBatterIndex = holeAssignment.wolfBatterIndex;
        const wolfPlayerId = groupPlayerList[wolfBatterIndex]!.id;
        const roll = rng();
        let decisionStr: string;
        let partnerPlayerId: number | null = null;
        let wolfDecision: WolfDecision;

        if (roll < 0.70) {
          const others = ([0, 1, 2, 3] as BattingPosition[]).filter(i => i !== wolfBatterIndex);
          const partnerPos = pickRandom(others);
          partnerPlayerId = groupPlayerList[partnerPos]!.id;
          wolfDecision = { type: 'partner', partnerBatterIndex: partnerPos };
          decisionStr = 'partner';
        } else if (roll < 0.90) {
          wolfDecision = { type: 'alone' };
          decisionStr = 'alone';
        } else {
          wolfDecision = { type: 'blind_wolf' };
          decisionStr = 'blind_wolf';
        }

        // Check for bonus events on this hole
        const bonusSpec = bonusEvents.find(b => b.gIdx === gIdx && b.holeNum === holeNum);
        let bonusesJson: string | null = null;
        let bonusInput: BonusInput = { greenies: [], polies: [] };

        if (bonusSpec) {
          const greeniePlayerIds: number[] = [];
          const poliePlayerIds: number[] = [];
          const greeniePositions: BattingPosition[] = [];
          const poliePositions: BattingPosition[] = [];

          if (bonusSpec.greeniePos !== undefined) {
            const pid = groupPlayerList[bonusSpec.greeniePos]!.id;
            greeniePlayerIds.push(pid);
            greeniePositions.push(bonusSpec.greeniePos);
          }
          if (bonusSpec.poliePos !== undefined) {
            const pid = groupPlayerList[bonusSpec.poliePos]!.id;
            poliePlayerIds.push(pid);
            poliePositions.push(bonusSpec.poliePos);
          }
          bonusesJson = JSON.stringify({ greenies: greeniePlayerIds, polies: poliePlayerIds });
          bonusInput = { greenies: greeniePositions, polies: poliePositions };
        }

        const base = calculateHoleMoney(netScores, holeAssignment, wolfDecision, courseHole.par);
        const moneyResult = bonusInput.greenies.length > 0 || bonusInput.polies.length > 0
          ? applyBonusModifiers(
              base,
              netScores,
              grossScores as [number, number, number, number],
              bonusInput,
              holeAssignment,
              wolfDecision,
              courseHole.par,
            )
          : base;

        const wolfMoney = moneyResult[wolfBatterIndex]!.total;
        const outcome = wolfMoney > 0 ? 'win' : wolfMoney < 0 ? 'loss' : 'push';

        wolfDecisionRows.push({
          roundId, groupId,
          holeNumber: holeNum,
          wolfPlayerId,
          decision: decisionStr,
          partnerPlayerId,
          bonusesJson,
          outcome,
          createdAt: now,
        });

        for (let pos = 0; pos < 4; pos++) {
          const pid = groupPlayerList[pos]!.id;
          moneyMap.set(pid, (moneyMap.get(pid) ?? 0) + moneyResult[pos]!.total);
        }
      } else {
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

    console.log(`  Group ${gIdx + 1}: ${groupPlayerList.map(p => p.name).join(', ')} — thru ${thruHole}`);
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

  // Print leaderboard
  console.log('\nCurrent leaderboard (by stableford):');
  const sorted = [...roundPlayerList].sort(
    (a, b) => (stablefordMap.get(b.id) ?? 0) - (stablefordMap.get(a.id) ?? 0),
  );
  sorted.forEach((p, i) => {
    const stab = stablefordMap.get(p.id) ?? 0;
    const money = moneyMap.get(p.id) ?? 0;
    console.log(`  ${i + 1}. ${p.name}: ${stab} stab, ${money >= 0 ? '+' : ''}$${money}`);
  });

  console.log('\n✅ Live round seeded — visit the leaderboard to see it live.');
  process.exit(0);
}

seedLive().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
