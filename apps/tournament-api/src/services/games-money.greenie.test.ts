/**
 * games-money.greenie.test.ts (Story 2.2, Task 3b) — proves the DENSE-holes
 * change to the F1 settlement chokepoint:
 *
 *   1. BARRIER: an unplayed par-3 BETWEEN two complete par-3s defers the later
 *      greenie (the carry is NOT bridged across the gap). Once the gap completes
 *      unclaimed, the later par-3 collects the full carried pot — monotonically,
 *      never a retroactive reversal. This only works because the holes array is
 *      DENSE (the unplayed par-3 appears as a present-but-incomplete row). With
 *      the prior SPARSE array (netByHole only) the unplayed par-3 had no row, so
 *      the two scored par-3s were adjacent and the carry wrongly bridged.
 *
 *   2. BASE-MONEY NEUTRAL: making the array dense (adding empty-net rows for
 *      unplayed holes) does NOT change base 2v2 money — the engine's complete-cell
 *      gate already skips empty-net holes. Asserted by comparing the chokepoint's
 *      per-player net (dense internally) to the pure engine run over ONLY the
 *      scored holes (sparse).
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { GameConfig, HoleState, TeamSplit } from '../engine/games/types.js';

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
  holeClaimWrites,
  gameConfig,
  roundPins,
} = await import('../db/schema/index.js');
const { computeF1PerPlayerNet } = await import('./games-money.js');
const { computeFoursome } = await import('../engine/games/compute-foursome.js');

const TENANT = 'guyan';
const TEAM: TeamSplit = { teamA: ['a1', 'a2'], teamB: ['b1', 'b2'] };
const MEMBERS = [...TEAM.teamA, ...TEAM.teamB];

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
  await client.execute('PRAGMA foreign_keys = OFF');
});
beforeEach(async () => {
  await db.delete(holeClaimWrites);
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

type Hole = { holeNumber: number; par: number; net?: Record<string, number>; greenie?: string[] };

/**
 * Seed a single-foursome F1 event. `parByHole` sets the course pars (18 holes);
 * `scored` holes get holeScores (gross == net, CH pinned 0); `greenie` players on
 * a hole get a 'set' greenie write. Config is the supplied GameConfig at event +
 * pin level.
 */
async function seed(opts: {
  config: GameConfig;
  parByHole: Record<number, number>;
  holes: Hole[];
}) {
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

  for (const pid of MEMBERS) {
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
  for (let h = 1; h <= 18; h++) {
    await db.insert(courseHoles).values({
      id: randomUUID(), courseRevisionId: ids.courseRevId, holeNumber: h,
      par: (opts.parByHole[h] ?? 4) as number, si: ((h * 7) % 18) + 1,
      yardagePerTeeJson: '{}', tenantId: TENANT, contextId: ctx,
    });
  }
  await db.insert(events).values({
    id: ids.eventId, name: 'F1', startDate: now, endDate: now + 86400000, timezone: 'America/New_York',
    organizerPlayerId: MEMBERS[0]!, createdAt: now, tenantId: TENANT, contextId: ctx,
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
  for (let i = 0; i < MEMBERS.length; i++) {
    await db.insert(pairingMembers).values({
      pairingId: ids.pairingId, playerId: MEMBERS[i]!, slotNumber: i + 1, tenantId: TENANT, contextId: ctx,
    });
  }
  await db.insert(gameConfig).values({
    id: randomUUID(), level: 'event', refId: ids.eventId, configJson: JSON.stringify(opts.config),
    seedRuleSetRevisionId: null, lockState: opts.config.lockState ?? null, configVersion: opts.config.configVersion,
    createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx,
  });
  const perPlayer: Record<string, { hi: number; ch: number }> = {};
  for (const pid of MEMBERS) perPlayer[pid] = { hi: 0, ch: 0 };
  await db.insert(roundPins).values({
    roundId: ids.roundId, resolvedConfigJson: JSON.stringify(opts.config),
    seedRuleSetRevisionId: null, courseRevisionId: ids.courseRevId, tee: 'blue',
    perPlayerHandicapsJson: JSON.stringify(perPlayer), teamCompositionJson: null,
    createdAt: now, tenantId: TENANT, contextId: ctx,
  });

  let seq = 0;
  for (const hole of opts.holes) {
    if (hole.net) {
      for (const pid of MEMBERS) {
        const net = hole.net[pid];
        if (net === undefined) continue;
        await db.insert(holeScores).values({
          id: randomUUID(), roundId: ids.roundId, playerId: pid, holeNumber: hole.holeNumber,
          grossStrokes: net, putts: 2, scorerPlayerId: MEMBERS[0]!, clientEventId: `s-${pid}-${hole.holeNumber}`,
          createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx,
        });
      }
    }
    for (const pid of hole.greenie ?? []) {
      await db.insert(holeClaimWrites).values({
        id: randomUUID(), roundId: ids.roundId, playerId: pid, holeNumber: hole.holeNumber,
        claimType: 'greenie', op: 'set', scorerPlayerId: MEMBERS[0]!, clientEventId: `c-${pid}-${hole.holeNumber}-${seq++}`,
        createdAt: now, tenantId: TENANT, contextId: ctx,
      });
    }
  }
  return ids;
}

const GREENIE_CONFIG: GameConfig = {
  scope: 'foursome',
  game: 'guyan-2v2',
  pointValueSchedule: { kind: 'flat', cents: 500 },
  modifiers: [{ type: 'greenie', enabled: true, variant: { carryover: true } }],
  lockState: 'locked',
  configVersion: 1,
};

// Par-3 at holes 1, 3, 5; everything else par 4.
const PARS: Record<number, number> = { 1: 3, 3: 3, 5: 3 };

describe('Story 2.2 dense-holes barrier through the live chokepoint', () => {
  test('an UNPLAYED par-3 between two complete par-3s defers the later greenie (carry NOT bridged)', async () => {
    // H1 par-3 complete unclaimed (rolls 1); H3 par-3 UNPLAYED (the gap); H5 par-3
    // complete, a1 greenie. The barrier must break at H3 → H5's greenie deferred.
    // All nets = par so base money is 0 → any non-zero net is greenie alone.
    const ids = await seed({
      config: GREENIE_CONFIG,
      parByHole: PARS,
      holes: [
        { holeNumber: 1, par: 3, net: { a1: 3, a2: 3, b1: 3, b2: 3 } }, // unclaimed
        // hole 3: NO net (unplayed) — present-but-incomplete dense row
        { holeNumber: 5, par: 3, net: { a1: 3, a2: 3, b1: 3, b2: 3 }, greenie: ['a1'] },
      ],
    });

    const { netByPlayer } = await computeF1PerPlayerNet(db, ids.eventId, TENANT);
    // Deferred: a1 collects NOTHING while H3 is an open gap. (With the prior SPARSE
    // array, H1 and H5 would be adjacent par-3s and a1 would wrongly net +1000.)
    expect(netByPlayer.get('a1') ?? 0).toBe(0);
    expect(netByPlayer.get('a2') ?? 0).toBe(0);
    expect(netByPlayer.get('b1') ?? 0).toBe(0);
    expect(netByPlayer.get('b2') ?? 0).toBe(0);
  });

  test('once the gap (H3) completes unclaimed, the later par-3 collects the full pot (3) — monotonic release', async () => {
    const ids = await seed({
      config: GREENIE_CONFIG,
      parByHole: PARS,
      holes: [
        { holeNumber: 1, par: 3, net: { a1: 3, a2: 3, b1: 3, b2: 3 } }, // unclaimed → 1
        { holeNumber: 3, par: 3, net: { a1: 3, a2: 3, b1: 3, b2: 3 } }, // now complete, unclaimed → 2
        { holeNumber: 5, par: 3, net: { a1: 3, a2: 3, b1: 3, b2: 3 }, greenie: ['a1'] }, // won, sweeps → +3
      ],
    });

    const { netByPlayer } = await computeF1PerPlayerNet(db, ids.eventId, TENANT);
    // a1 collects 3 points × $5 = +$15; zero-sum across the foursome.
    expect(netByPlayer.get('a1') ?? 0).toBe(1500);
    expect(netByPlayer.get('a2') ?? 0).toBe(1500);
    expect(netByPlayer.get('b1') ?? 0).toBe(-1500);
    expect(netByPlayer.get('b2') ?? 0).toBe(-1500);
  });
});

describe('Story 2.2 dense holes are BASE-MONEY NEUTRAL', () => {
  test('a partially-scored round (greenie absent) settles identically to the pure engine over only the scored holes', async () => {
    // Non-greenie config; score only 3 of 18 holes with non-par nets producing
    // real base points. The chokepoint builds a DENSE 18-hole array internally;
    // the result must equal the pure engine run over ONLY the 3 scored holes.
    const baseConfig: GameConfig = {
      scope: 'foursome', game: 'guyan-2v2', pointValueSchedule: { kind: 'flat', cents: 500 },
      modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } }],
      lockState: 'locked', configVersion: 1,
    };
    const scored: HoleState[] = [
      { holeNumber: 1, par: 4, net: { a1: 3, a2: 5, b1: 4, b2: 4 } },
      { holeNumber: 2, par: 4, net: { a1: 3, a2: 6, b1: 5, b2: 6 } },
      { holeNumber: 3, par: 5, net: { a1: 5, a2: 4, b1: 6, b2: 5 } },
    ];
    const ids = await seed({
      config: baseConfig,
      parByHole: { 1: 4, 2: 4, 3: 5 },
      holes: scored.map((h) => ({ holeNumber: h.holeNumber, par: h.par, net: h.net })),
    });

    const { netByPlayer } = await computeF1PerPlayerNet(db, ids.eventId, TENANT);
    const expected = computeFoursome(baseConfig, { teamSplit: TEAM, holes: scored });
    for (const pid of MEMBERS) {
      expect(netByPlayer.get(pid) ?? 0).toBe(expected.perPlayerCents[pid]);
    }
  });
});
