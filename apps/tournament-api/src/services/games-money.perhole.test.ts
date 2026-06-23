/**
 * games-money.perhole.test.ts (Story 3-3) — the per-hole money chokepoint
 * helper `computeF1PerHoleMoneyForPlayer`. Mirrors games-money.test.ts's seed
 * harness (private :memory: libsql, foreign_keys OFF, seedFromFixture). Asserts:
 *   - locked F1 + flag on → correct player-signed per-hole map (matches the
 *     approved per-hole golden) AND reconciles with computeF1PerPlayerNet;
 *   - flag OFF → null (not exposed);
 *   - event UNLOCKED → null (scores-only);
 *   - non-F1 event → null;
 *   - player not in the round → null;
 *   - unsettleable foursome (missing pin handicap) → null (fail-closed, no throw).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import type { GameConfig, SettlementEdge, TeamSplit, HoleState } from '../engine/games/types.js';

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
  players,
  courses,
  courseRevisions,
  courseTees,
  courseHoles,
  events,
  eventRounds,
  pairings,
  pairingMembers,
  rounds,
  holeScores,
  gameConfig,
  roundPins,
} = await import('../db/schema/index.js');
const { computeF1PerHoleMoneyForPlayer, computeF1PerPlayerNet } = await import('./games-money.js');

const TENANT = 'guyan';

type GoldenFixture = {
  input: { config: GameConfig; teamSplit: TeamSplit; holes: HoleState[]; sourceId: string };
  expected: { perPlayerNetCents: Record<string, number>; edges: SettlementEdge[]; ledgerTotalCents: number };
};
function loadFixture(name: string): GoldenFixture {
  const here = resolve(__dirname, '../engine/games/__fixtures__');
  return JSON.parse(readFileSync(join(here, name), 'utf8')) as GoldenFixture;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
  await client.execute('PRAGMA foreign_keys = OFF');
});
beforeEach(async () => {
  await db.delete(roundPins);
  await db.delete(holeScores);
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(gameConfig);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

type SeedOpts = {
  omitPinFor?: string[];
  noPin?: boolean;
  lockState?: 'locked' | 'unlocked';
  noEventConfig?: boolean;
};

async function seedFromFixture(fx: GoldenFixture, opts: SeedOpts = {}) {
  const now = Date.now();
  const ids = {
    eventId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    eventRoundId: randomUUID(),
    pairingId: randomUUID(),
    roundId: randomUUID(),
  };
  const ctx = `event:${ids.eventId}`;
  const teamPlayers = [...fx.input.teamSplit.teamA, ...fx.input.teamSplit.teamB];

  for (const pid of teamPlayers) {
    await db.insert(players).values({
      id: pid, isOrganizer: false, createdAt: now, name: pid, manualHandicapIndex: 0,
      tenantId: TENANT, contextId: ctx,
    });
  }
  await db.insert(courses).values({ id: ids.courseId, name: 'C', clubName: 'CC', createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(courseRevisions).values({
    id: ids.courseRevId, courseId: ids.courseId, revisionNumber: 1, sourceUrl: null, extractionDate: null,
    verified: false, outTotal: 36, inTotal: 36, courseTotal: 72, createdAt: now, tenantId: TENANT, contextId: ctx,
  });
  await db.insert(courseTees).values({
    id: randomUUID(), courseRevisionId: ids.courseRevId, teeColor: 'blue', rating: 720, slope: 113,
    tenantId: TENANT, contextId: ctx,
  });
  const parByFixtureHole = new Map(fx.input.holes.map((h) => [h.holeNumber, h.par]));
  for (let h = 1; h <= 18; h++) {
    await db.insert(courseHoles).values({
      id: randomUUID(), courseRevisionId: ids.courseRevId, holeNumber: h,
      par: (parByFixtureHole.get(h) ?? 4) as number, si: ((h * 7) % 18) + 1,
      yardagePerTeeJson: '{}', tenantId: TENANT, contextId: ctx,
    });
  }
  await db.insert(events).values({
    id: ids.eventId, name: 'F1', startDate: now, endDate: now + 86400000, timezone: 'America/New_York',
    organizerPlayerId: teamPlayers[0]!, createdAt: now, tenantId: TENANT, contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.eventRoundId, eventId: ids.eventId, roundNumber: 1, roundDate: now,
    courseRevisionId: ids.courseRevId, teeColor: 'blue', holesToPlay: 18, createdAt: now, tenantId: TENANT, contextId: ctx,
  });
  await db.insert(rounds).values({
    id: ids.roundId, eventId: ids.eventId, eventRoundId: ids.eventRoundId, holesToPlay: 18, createdAt: now,
    tenantId: TENANT, contextId: ctx,
  });
  await db.insert(pairings).values({
    id: ids.pairingId, eventRoundId: ids.eventRoundId, foursomeNumber: 1, createdAt: now, tenantId: TENANT, contextId: ctx,
  });
  for (let i = 0; i < teamPlayers.length; i++) {
    await db.insert(pairingMembers).values({
      pairingId: ids.pairingId, playerId: teamPlayers[i]!, slotNumber: i + 1, tenantId: TENANT, contextId: ctx,
    });
  }
  if (!opts.noEventConfig) {
    const lockState = opts.lockState ?? fx.input.config.lockState ?? 'locked';
    const eventCfg: GameConfig = { ...fx.input.config, lockState };
    await db.insert(gameConfig).values({
      id: randomUUID(), level: 'event', refId: ids.eventId, configJson: JSON.stringify(eventCfg),
      seedRuleSetRevisionId: null, lockState, configVersion: eventCfg.configVersion,
      createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx,
    });
  }
  if (!opts.noPin) {
    const perPlayer: Record<string, { hi: number; ch: number }> = {};
    for (const pid of teamPlayers) {
      if (opts.omitPinFor?.includes(pid)) continue;
      perPlayer[pid] = { hi: 0, ch: 0 };
    }
    await db.insert(roundPins).values({
      roundId: ids.roundId,
      resolvedConfigJson: JSON.stringify({ ...fx.input.config, lockState: opts.lockState ?? fx.input.config.lockState ?? 'locked' }),
      seedRuleSetRevisionId: null, courseRevisionId: ids.courseRevId, tee: 'blue',
      perPlayerHandicapsJson: JSON.stringify(perPlayer), teamCompositionJson: null,
      createdAt: now, tenantId: TENANT, contextId: ctx,
    });
  }
  for (const hole of fx.input.holes) {
    for (const pid of teamPlayers) {
      const net = hole.net[pid];
      if (net === undefined) continue;
      await db.insert(holeScores).values({
        id: randomUUID(), roundId: ids.roundId, playerId: pid, holeNumber: hole.holeNumber,
        grossStrokes: net, putts: 2, scorerPlayerId: teamPlayers[0]!, clientEventId: `e-${pid}-${hole.holeNumber}`,
        createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx,
      });
    }
  }
  return ids;
}

const BASE = 'guyan-2v2-base-flat.json';
// The approved per-hole money for a1 in the base-flat scenario (cents).
const A1_PER_HOLE: Record<number, number> = { 1: 500, 2: 1500, 3: -2000, 4: 2000, 5: -2500, 6: 2000 };

describe('computeF1PerHoleMoneyForPlayer (Story 3-3)', () => {
  test('locked F1 + flag ON → player-signed per-hole map matching the approved golden', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const fx = loadFixture(BASE);
    const ids = await seedFromFixture(fx);
    const map = await computeF1PerHoleMoneyForPlayer(db, { roundId: ids.roundId, playerId: 'a1', tenantId: TENANT });
    expect(map).not.toBeNull();
    for (const [holeStr, cents] of Object.entries(A1_PER_HOLE)) {
      expect(map!.get(Number(holeStr))).toBe(cents);
    }
    // b1 is the exact negation of a1 each hole.
    const bMap = await computeF1PerHoleMoneyForPlayer(db, { roundId: ids.roundId, playerId: 'b1', tenantId: TENANT });
    for (const [holeStr, cents] of Object.entries(A1_PER_HOLE)) {
      expect(bMap!.get(Number(holeStr))).toBe(-cents);
    }
  });

  test('reconciles with computeF1PerPlayerNet (Σ per-hole map === round net)', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const fx = loadFixture(BASE);
    const ids = await seedFromFixture(fx);
    const { netByPlayer } = await computeF1PerPlayerNet(db, ids.eventId, TENANT);
    for (const pid of ['a1', 'a2', 'b1', 'b2']) {
      const map = await computeF1PerHoleMoneyForPlayer(db, { roundId: ids.roundId, playerId: pid, tenantId: TENANT });
      const summed = [...map!.values()].reduce((a, c) => a + c, 0);
      expect(summed).toBe(netByPlayer.get(pid) ?? 0);
    }
  });

  test('flag OFF → null (not exposed, scores-only)', async () => {
    // no stubEnv → TOURNAMENT_F1_MONEY_ENABLED unset
    const fx = loadFixture(BASE);
    const ids = await seedFromFixture(fx);
    const map = await computeF1PerHoleMoneyForPlayer(db, { roundId: ids.roundId, playerId: 'a1', tenantId: TENANT });
    expect(map).toBeNull();
  });

  test('event UNLOCKED → null (scores-only even with flag on)', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const fx = loadFixture(BASE);
    const ids = await seedFromFixture(fx, { lockState: 'unlocked' });
    const map = await computeF1PerHoleMoneyForPlayer(db, { roundId: ids.roundId, playerId: 'a1', tenantId: TENANT });
    expect(map).toBeNull();
  });

  test('non-F1 event (no event game_config) → null', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const fx = loadFixture(BASE);
    const ids = await seedFromFixture(fx, { noEventConfig: true });
    const map = await computeF1PerHoleMoneyForPlayer(db, { roundId: ids.roundId, playerId: 'a1', tenantId: TENANT });
    expect(map).toBeNull();
  });

  test('player not in the round → null', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const fx = loadFixture(BASE);
    const ids = await seedFromFixture(fx);
    const map = await computeF1PerHoleMoneyForPlayer(db, { roundId: ids.roundId, playerId: randomUUID(), tenantId: TENANT });
    expect(map).toBeNull();
  });

  test('unsettleable foursome (missing pin handicap) → null, no throw (fail-closed)', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const fx = loadFixture(BASE);
    const ids = await seedFromFixture(fx, { omitPinFor: ['b1'] });
    const map = await computeF1PerHoleMoneyForPlayer(db, { roundId: ids.roundId, playerId: 'a1', tenantId: TENANT });
    expect(map).toBeNull();
  });

  test('round not pinned → null (fail-closed)', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const fx = loadFixture(BASE);
    const ids = await seedFromFixture(fx, { noPin: true });
    const map = await computeF1PerHoleMoneyForPlayer(db, { roundId: ids.roundId, playerId: 'a1', tenantId: TENANT });
    expect(map).toBeNull();
  });
});
