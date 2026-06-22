/**
 * games-money.test.ts (Story 1.4) — the F1 settlement chokepoint + GOLDEN
 * RELEASE GATE (AC15) + fail-closed (AC11) + zero-sum property (NFR-C3).
 *
 * The golden gate re-runs the Story 1.1 hand-approved fixtures THROUGH the live
 * `computeF1EventEdges` chokepoint: it pins a round with each player's CH = 0 so
 * `net = gross` (then seeds gross = the fixture's per-hole net), and asserts the
 * chokepoint emits the fixture's expected `f1_game` edges. This proves the DB
 * integration matches the hand-approved math, not just the pure engine.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import fc from 'fast-check';
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
const { computeF1EventEdges, computeF1PerPlayerNet } = await import('./games-money.js');

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

type SeedOpts = {
  /** Per-player CH to pin (default 0 so net == gross). */
  chByPlayer?: Record<string, number>;
  /** Omit a player's pin handicap (fail-closed). */
  omitPinFor?: string[];
  /** Don't write the round_pin at all (not-pinned fail-closed). */
  noPin?: boolean;
  /** lock state on the event game_config. */
  lockState?: 'locked' | 'unlocked';
  /** Don't write the event-level game_config (non-F1). */
  noEventConfig?: boolean;
};

/**
 * Seed an event whose single foursome plays the fixture. `holes[].net` is the
 * per-hole net per playerId; with CH=0 we store gross = net and 18 par-4 holes
 * with arbitrary SI (irrelevant at CH=0).
 */
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
  // Par per hole comes from the fixture (the chokepoint reads par from the
  // pinned course revision; the golden math assumes the fixture's pars).
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
  // Slots 1&2 = teamA, 3&4 = teamB (the F1 team split contract).
  for (let i = 0; i < teamPlayers.length; i++) {
    await db.insert(pairingMembers).values({
      pairingId: ids.pairingId, playerId: teamPlayers[i]!, slotNumber: i + 1, tenantId: TENANT, contextId: ctx,
    });
  }
  if (!opts.noEventConfig) {
    const eventCfg: GameConfig = { ...fx.input.config, lockState: opts.lockState ?? fx.input.config.lockState ?? 'locked' };
    await db.insert(gameConfig).values({
      id: randomUUID(), level: 'event', refId: ids.eventId, configJson: JSON.stringify(eventCfg),
      seedRuleSetRevisionId: null, lockState: eventCfg.lockState ?? null, configVersion: eventCfg.configVersion,
      createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx,
    });
  }
  // Pin: CH = 0 for every player (net == gross) unless overridden.
  if (!opts.noPin) {
    const ch = opts.chByPlayer ?? {};
    const perPlayer: Record<string, { hi: number; ch: number }> = {};
    for (const pid of teamPlayers) {
      if (opts.omitPinFor?.includes(pid)) continue;
      perPlayer[pid] = { hi: 0, ch: ch[pid] ?? 0 };
    }
    await db.insert(roundPins).values({
      roundId: ids.roundId,
      resolvedConfigJson: JSON.stringify({ ...fx.input.config, lockState: opts.lockState ?? fx.input.config.lockState ?? 'locked' }),
      seedRuleSetRevisionId: null, courseRevisionId: ids.courseRevId, tee: 'blue',
      perPlayerHandicapsJson: JSON.stringify(perPlayer), teamCompositionJson: null,
      createdAt: now, tenantId: TENANT, contextId: ctx,
    });
  }
  // Scores: gross = fixture net (CH=0 → net == gross).
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

const GOLDEN_FIXTURES = [
  'guyan-2v2-base-flat.json',
  'guyan-2v2-frontback-segmented.json',
  'guyan-2v2-nine-hole-front.json',
];

describe('computeF1EventEdges — GOLDEN RELEASE GATE through the live chokepoint (AC15)', () => {
  for (const name of GOLDEN_FIXTURES) {
    test(`matches ${name}`, async () => {
      const fx = loadFixture(name);
      const ids = await seedFromFixture(fx);
      const res = await computeF1EventEdges(db, ids.eventId, TENANT);
      expect(res.isF1).toBe(true);
      expect(res.unsettleable).toEqual([]);

      // The chokepoint's edges, re-sourceId'd to compare to the fixture's edges
      // (the fixture uses a literal sourceId; the chokepoint uses round:foursome).
      const sourceId = `${ids.roundId}:1`;
      const expected = fx.expected.edges.map((e) => ({ ...e, sourceId }));
      const got = [...res.edges].sort((a, b) =>
        a.fromPlayerId < b.fromPlayerId ? -1 : a.fromPlayerId > b.fromPlayerId ? 1
        : a.toPlayerId < b.toPlayerId ? -1 : a.toPlayerId > b.toPlayerId ? 1 : 0,
      );
      expect(got).toEqual(expected);
    });
  }
});

describe('computeF1EventEdges — classification + zero-sum', () => {
  test('non-F1 event (no event-level game_config) → isF1 false, no edges', async () => {
    const fx = loadFixture('guyan-2v2-base-flat.json');
    const ids = await seedFromFixture(fx, { noEventConfig: true });
    const res = await computeF1EventEdges(db, ids.eventId, TENANT);
    expect(res.isF1).toBe(false);
    expect(res.edges).toEqual([]);
  });

  test('ledger pairs net to zero (NFR-C3) — fast-check over scores', async () => {
    const baseFx = loadFixture('guyan-2v2-base-flat.json');
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 2, max: 8 }), { minLength: 24, maxLength: 24 }),
        async (grosses) => {
          await db.delete(roundPins); await db.delete(holeScores); await db.delete(pairingMembers);
          await db.delete(pairings); await db.delete(gameConfig); await db.delete(rounds);
          await db.delete(eventRounds); await db.delete(events); await db.delete(courseHoles);
          await db.delete(courseTees); await db.delete(courseRevisions); await db.delete(courses);
          await db.delete(players);
          // Build 6 holes × 4 players of random net.
          const holes: HoleState[] = [];
          let g = 0;
          for (let h = 1; h <= 6; h++) {
            holes.push({
              holeNumber: h, par: 4,
              net: { a1: grosses[g++]!, a2: grosses[g++]!, b1: grosses[g++]!, b2: grosses[g++]! },
            });
          }
          const fx: GoldenFixture = { ...baseFx, input: { ...baseFx.input, holes } };
          const ids = await seedFromFixture(fx);
          const res = await computeF1EventEdges(db, ids.eventId, TENANT);
          const net = new Map<string, number>();
          for (const e of res.edges) {
            net.set(e.toPlayerId, (net.get(e.toPlayerId) ?? 0) + e.cents);
            net.set(e.fromPlayerId, (net.get(e.fromPlayerId) ?? 0) - e.cents);
          }
          let sum = 0;
          for (const v of net.values()) sum += v;
          return sum === 0;
        },
      ),
      { numRuns: 15 },
    );
  });
});

describe('computeF1EventEdges — fail-closed per foursome (AC11)', () => {
  test('missing pin handicap for a player → that foursome unsettleable, reason missing_handicap', async () => {
    const fx = loadFixture('guyan-2v2-base-flat.json');
    const ids = await seedFromFixture(fx, { omitPinFor: [fx.input.teamSplit.teamB[0]] });
    const res = await computeF1EventEdges(db, ids.eventId, TENANT);
    expect(res.isF1).toBe(true);
    expect(res.edges).toEqual([]);
    expect(res.unsettleable).toHaveLength(1);
    expect(res.unsettleable[0]!.reason).toBe('missing_handicap');
  });

  test('no pin at all on a started F1 round → not_pinned, never settled live', async () => {
    const fx = loadFixture('guyan-2v2-base-flat.json');
    const ids = await seedFromFixture(fx, { noPin: true });
    const res = await computeF1EventEdges(db, ids.eventId, TENANT);
    expect(res.isF1).toBe(true);
    expect(res.edges).toEqual([]);
    expect(res.unsettleable[0]!.reason).toBe('not_pinned');
  });

  test('computeF1PerPlayerNet matches the edge net (used by My Money)', async () => {
    const fx = loadFixture('guyan-2v2-base-flat.json');
    const ids = await seedFromFixture(fx);
    const { netByPlayer } = await computeF1PerPlayerNet(db, ids.eventId, TENANT);
    for (const [pid, expectedNet] of Object.entries(fx.expected.perPlayerNetCents)) {
      expect(netByPlayer.get(pid) ?? 0).toBe(expectedNet);
    }
  });
});
