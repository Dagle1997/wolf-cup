/**
 * games-money.per-foursome.test.ts (Epic 6) — per-foursome money settlement.
 *
 * The HARD PROOF that each foursome settles from ITS OWN pinned config (the
 * `round_pin.foursome_configs_json` map), not the single round-level config:
 * two foursomes play IDENTICAL scores, but foursome 2's pinned config carries
 * DOUBLE the point value. The settled money for foursome 2 must therefore be
 * exactly 2× foursome 1's — money scaling linearly with the per-foursome stake
 * can only happen if the chokepoint reads the per-foursome config.
 *
 * Also asserts the backward-compatible default: a NULL foursome_configs_json
 * leaves both foursomes on the round-level config (no money change).
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { GameConfig } from '../engine/games/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = OFF');
  return { client, db };
});

const { db, client } = await import('../db/index.js');
const {
  players, courses, courseRevisions, courseTees, courseHoles, events,
  eventRounds, pairings, pairingMembers, rounds, holeScores, gameConfig, roundPins,
} = await import('../db/schema/index.js');
const { computeF1EventEdges } = await import('./games-money.js');

const TENANT = 'guyan';
const f = (n: number) => `f1p-${n}`; // foursome-1 players
const g = (n: number) => `f2p-${n}`; // foursome-2 players

const BASE_CFG: GameConfig = {
  game: 'guyan-2v2',
  pointValueSchedule: { kind: 'flat', cents: 500 },
  modifiers: [
    { type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } },
    { type: 'greenie', enabled: true, variant: { carryover: true } },
    { type: 'polie', enabled: true },
    { type: 'sandie', enabled: true },
  ],
  cap: null,
  lockState: 'locked',
  configVersion: 1,
};
const DOUBLE_CFG: GameConfig = { ...BASE_CFG, pointValueSchedule: { kind: 'flat', cents: 1000 } };

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
  await client.execute('PRAGMA foreign_keys = OFF');
});
beforeEach(async () => {
  for (const t of [holeScores, roundPins, pairingMembers, pairings, rounds, eventRounds, gameConfig, courseHoles, courseTees, courseRevisions, courses, events, players]) {
    await db.delete(t);
  }
});

/** Seed an event with TWO foursomes, identical scores; pin per `foursomeConfigsJson`. */
async function seedTwoFoursomes(foursomeConfigsJson: string | null) {
  const now = Date.now();
  const ids = {
    eventId: randomUUID(), courseId: randomUUID(), courseRevId: randomUUID(),
    eventRoundId: randomUUID(), roundId: randomUUID(),
    p1: randomUUID(), p2: randomUUID(),
  };
  const ctx = `event:${ids.eventId}`;
  const f1 = [f(1), f(2), f(3), f(4)];
  const f2 = [g(1), g(2), g(3), g(4)];
  for (const pid of [...f1, ...f2]) {
    await db.insert(players).values({ id: pid, isOrganizer: false, createdAt: now, name: pid, manualHandicapIndex: 0, tenantId: TENANT, contextId: ctx });
  }
  await db.insert(courses).values({ id: ids.courseId, name: 'C', clubName: 'CC', createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(courseRevisions).values({ id: ids.courseRevId, courseId: ids.courseId, revisionNumber: 1, sourceUrl: null, extractionDate: null, verified: false, outTotal: 36, inTotal: 36, courseTotal: 72, createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(courseTees).values({ id: randomUUID(), courseRevisionId: ids.courseRevId, teeColor: 'blue', rating: 720, slope: 113, tenantId: TENANT, contextId: ctx });
  for (let h = 1; h <= 18; h++) {
    await db.insert(courseHoles).values({ id: randomUUID(), courseRevisionId: ids.courseRevId, holeNumber: h, par: 4, si: ((h * 7) % 18) + 1, yardagePerTeeJson: '{}', tenantId: TENANT, contextId: ctx });
  }
  await db.insert(events).values({ id: ids.eventId, name: 'F1', startDate: now, endDate: now + 86400000, timezone: 'America/New_York', organizerPlayerId: f1[0]!, createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(eventRounds).values({ id: ids.eventRoundId, eventId: ids.eventId, roundNumber: 1, roundDate: now, courseRevisionId: ids.courseRevId, teeColor: 'blue', holesToPlay: 18, createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(rounds).values({ id: ids.roundId, eventId: ids.eventId, eventRoundId: ids.eventRoundId, holesToPlay: 18, createdAt: now, tenantId: TENANT, contextId: ctx });
  // Event-level config (locked) so computeF1EventEdges classifies it as F1 + money-on.
  await db.insert(gameConfig).values({ id: randomUUID(), level: 'event', refId: ids.eventId, configJson: JSON.stringify(BASE_CFG), seedRuleSetRevisionId: null, lockState: 'locked', configVersion: 1, createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx });

  // Two foursomes; slots 1&2 = teamA, 3&4 = teamB.
  for (const [n, members] of [[1, f1], [2, f2]] as Array<[number, string[]]>) {
    const pid = randomUUID();
    await db.insert(pairings).values({ id: pid, eventRoundId: ids.eventRoundId, foursomeNumber: n, createdAt: now, tenantId: TENANT, contextId: ctx });
    for (let i = 0; i < members.length; i++) {
      await db.insert(pairingMembers).values({ pairingId: pid, playerId: members[i]!, slotNumber: i + 1, tenantId: TENANT, contextId: ctx });
    }
  }

  // Pin: CH 0 (net == gross); identical scores in both foursomes.
  const perPlayer: Record<string, { hi: number; ch: number }> = {};
  for (const pid of [...f1, ...f2]) perPlayer[pid] = { hi: 0, ch: 0 };
  await db.insert(roundPins).values({
    roundId: ids.roundId, resolvedConfigJson: JSON.stringify(BASE_CFG), foursomeConfigsJson,
    seedRuleSetRevisionId: null, courseRevisionId: ids.courseRevId, tee: 'blue',
    perPlayerHandicapsJson: JSON.stringify(perPlayer), teamCompositionJson: null,
    createdAt: now, tenantId: TENANT, contextId: ctx,
  });

  // Identical scores in BOTH foursomes: teamA (slots 1,2) shoots 4, teamB (3,4) shoots 5.
  for (const members of [f1, f2]) {
    for (let h = 1; h <= 18; h++) {
      for (let i = 0; i < members.length; i++) {
        const gross = i < 2 ? 4 : 5;
        await db.insert(holeScores).values({ id: randomUUID(), roundId: ids.roundId, playerId: members[i]!, holeNumber: h, grossStrokes: gross, putts: 2, scorerPlayerId: f1[0]!, clientEventId: `e-${members[i]}-${h}`, createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx });
      }
    }
  }
  return ids;
}

function totalCentsForFoursome(edges: Array<{ cents: number; sourceId?: string; sourceBetId?: string }>, roundId: string, foursomeNumber: number): number {
  // f1_game edges carry sourceId `${roundId}:${foursomeNumber}` (see games-money).
  return edges
    .filter((e) => (e.sourceId ?? '') === `${roundId}:${foursomeNumber}`)
    .reduce((sum, e) => sum + e.cents, 0);
}

describe('computeF1EventEdges — per-foursome config (Epic 6)', () => {
  test('foursome 2 pinned at 2× point value settles for exactly 2× the money', async () => {
    const ids = await seedTwoFoursomes(JSON.stringify({ 2: DOUBLE_CFG }));
    const res = await computeF1EventEdges(db, ids.eventId, TENANT);
    expect(res.isF1).toBe(true);
    expect(res.lockState).toBe('locked');
    const f1Total = totalCentsForFoursome(res.edges, ids.roundId, 1);
    const f2Total = totalCentsForFoursome(res.edges, ids.roundId, 2);
    expect(f1Total).toBeGreaterThan(0);
    expect(f2Total).toBe(f1Total * 2); // the per-foursome stake drove the money
  });

  test('NULL foursome_configs_json → both foursomes settle on the round config (backward compatible)', async () => {
    const ids = await seedTwoFoursomes(null);
    const res = await computeF1EventEdges(db, ids.eventId, TENANT);
    const f1Total = totalCentsForFoursome(res.edges, ids.roundId, 1);
    const f2Total = totalCentsForFoursome(res.edges, ids.roundId, 2);
    expect(f1Total).toBeGreaterThan(0);
    expect(f2Total).toBe(f1Total); // identical scores + identical config → identical money
  });

  test('a corrupt foursome_configs_json fails the WHOLE pin closed (every foursome unsettleable, no crash)', async () => {
    const ids = await seedTwoFoursomes('{ not valid json');
    const res = await computeF1EventEdges(db, ids.eventId, TENANT);
    expect(res.edges).toHaveLength(0);
    expect(res.unsettleable.length).toBeGreaterThanOrEqual(2);
    expect(res.unsettleable.every((u) => u.reason === 'corrupt_pin')).toBe(true);
  });
});
