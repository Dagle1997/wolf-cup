/**
 * T8-1 typed emitter integration tests. Replaces the T5-6 stub-no-op
 * tests that asserted "no rows written".
 *
 * Coverage:
 *   - Each of the 13 event types: valid payload inserts a row with all
 *     columns populated correctly.
 *   - Each of the 13 event types: invalid payload throws ZodError, no
 *     row inserted.
 *   - Missing eventId → ZodError (base-shape enforcement).
 *   - Invalid type discriminator → ZodError.
 *   - Transaction rollback: emitActivity throwing inside a tx rolls
 *     back any sibling writes.
 *   - Coverage assertion: every variant in ACTIVITY_TYPES is exercised.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sql, eq, and } from 'drizzle-orm';
import { ZodError } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  // `file::memory:?cache=shared` lets libsql connections (including the
  // one drizzle uses for transactions) share the same in-memory DB —
  // plain `:memory:` opens a fresh per-connection DB, which fails when
  // db.transaction(...) opens a sibling connection that doesn't see the
  // migrated schema. Discovered while implementing T8-1.
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  // PRAGMA on the migration connection. With `file::memory:?cache=shared`,
  // libsql opens this client's transaction connections against the same
  // shared in-memory DB. The negative-FK assertion in the
  // "FK enforcement" describe block proves FKs are actually applied to
  // the transaction connection at runtime (codex round-3 Low #2 — stale
  // comment claimed beforeAll re-sets PRAGMA; in practice the single
  // execute here is sufficient under shared-cache mode).
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

const { db } = await import('../db/index.js');
const {
  activity,
  events,
  eventRounds,
  rounds,
  players,
  courses,
  courseRevisions,
} = await import('../db/schema/index.js');
const { emitActivity } = await import('./activity.js');
const { ACTIVITY_TYPES } = await import('../engine/types/activity-events.js');
import type { ActivityEvent } from '../engine/types/activity-events.js';

const TENANT_ID = 'guyan';
const EVENT_ID = 'evt-test-0001';
const EVENT_ROUND_ID = 'erd-test-0001';
const ROUND_ID = 'rnd-test-0001';
const COURSE_ID = 'crs-test-0001';
const COURSE_REVISION_ID = 'crv-test-0001';
const ACTOR_ID = 'plr-actor';
const PLAYER_A_ID = 'plr-a';
const PLAYER_B_ID = 'plr-b';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });

  // Seed an event/round/players chain so FK constraints succeed. We
  // can't reliably PRAGMA foreign_keys=OFF: with shared-cache memory
  // mode, drizzle's `db.transaction` opens a sibling connection whose
  // PRAGMA defaults are independent from the migration connection.
  await db.insert(players).values([
    { id: ACTOR_ID, name: 'Actor', isOrganizer: true, createdAt: Date.now(), tenantId: TENANT_ID, contextId: 'players:test' },
    { id: PLAYER_A_ID, name: 'Player A', isOrganizer: false, createdAt: Date.now(), tenantId: TENANT_ID, contextId: 'players:test' },
    { id: PLAYER_B_ID, name: 'Player B', isOrganizer: false, createdAt: Date.now(), tenantId: TENANT_ID, contextId: 'players:test' },
  ]);
  await db.insert(events).values({
    id: EVENT_ID,
    name: 'Test Event',
    startDate: Date.now(),
    endDate: Date.now() + 86_400_000,
    timezone: 'UTC',
    organizerPlayerId: ACTOR_ID,
    createdAt: Date.now(),
    tenantId: TENANT_ID,
    contextId: `event:${EVENT_ID}`,
  });
  await db.insert(courses).values({
    id: COURSE_ID,
    name: 'Test Course',
    clubName: 'Test Club',
    createdAt: Date.now(),
    tenantId: TENANT_ID,
    contextId: `library:${TENANT_ID}`,
  });
  await db.insert(courseRevisions).values({
    id: COURSE_REVISION_ID,
    courseId: COURSE_ID,
    revisionNumber: 1,
    outTotal: 36,
    inTotal: 36,
    courseTotal: 72,
    createdAt: Date.now(),
    tenantId: TENANT_ID,
    contextId: `library:${TENANT_ID}`,
  });
  await db.insert(eventRounds).values({
    id: EVENT_ROUND_ID,
    eventId: EVENT_ID,
    roundNumber: 1,
    roundDate: Date.now(),
    courseRevisionId: COURSE_REVISION_ID,
    teeColor: 'blue',
    holesToPlay: 18,
    createdAt: Date.now(),
    tenantId: TENANT_ID,
    contextId: `event:${EVENT_ID}`,
  });
  await db.insert(rounds).values({
    id: ROUND_ID,
    eventId: EVENT_ID,
    eventRoundId: EVENT_ROUND_ID,
    holesToPlay: 18,
    createdAt: Date.now(),
    tenantId: TENANT_ID,
    contextId: `round:${ROUND_ID}`,
  });
});

afterAll(async () => {
  // Best-effort cleanup; libsql in-memory dbs are torn down per test file.
});

beforeEach(async () => {
  // Wipe activity rows between tests so per-type assertions don't accumulate.
  await db.delete(activity);
});

// ---- Per-type valid + invalid event payload fixtures ----------------------

const validEvents: Record<typeof ACTIVITY_TYPES[number], ActivityEvent> = {
  'score.committed': {
    type: 'score.committed',
    eventId: EVENT_ID,
    roundId: ROUND_ID,
    actorPlayerId: ACTOR_ID,
    holeNumber: 7,
    playerId: PLAYER_A_ID,
    grossStrokes: 4,
    par: 4,
    toPar: 0,
    isBirdieOrBetter: false,
    scorerPlayerId: ACTOR_ID,
  },
  'score.corrected': {
    type: 'score.corrected',
    eventId: EVENT_ID,
    roundId: ROUND_ID,
    holeNumber: 7,
    playerId: PLAYER_A_ID,
    priorGross: 5,
    newGross: 4,
    actorPlayerId: ACTOR_ID,
  },
  'scorer.transferred': {
    type: 'scorer.transferred',
    eventId: EVENT_ID,
    roundId: ROUND_ID,
    foursomeNumber: 1,
    fromPlayerId: PLAYER_A_ID,
    toPlayerId: PLAYER_B_ID,
    actorPlayerId: ACTOR_ID,
  },
  'round.finalized': {
    type: 'round.finalized',
    eventId: EVENT_ID,
    roundId: ROUND_ID,
    actorPlayerId: ACTOR_ID,
  },
  'round.cancelled': {
    type: 'round.cancelled',
    eventId: EVENT_ID,
    roundId: ROUND_ID,
    actorPlayerId: ACTOR_ID,
  },
  'press.auto_fired': {
    type: 'press.auto_fired',
    eventId: EVENT_ID,
    roundId: ROUND_ID,
    actorPlayerId: ACTOR_ID,
    triggerHole: 5,
    team: 'teamA',
    trigger: 'down_2',
    multiplier: 2,
  },
  'press.manual_fired': {
    type: 'press.manual_fired',
    eventId: EVENT_ID,
    roundId: ROUND_ID,
    actorPlayerId: ACTOR_ID,
    fromHole: 5,
    team: 'teamA',
    multiplier: 2,
    filedByPlayerId: ACTOR_ID,
  },
  'press.manual_undone': {
    type: 'press.manual_undone',
    eventId: EVENT_ID,
    roundId: ROUND_ID,
    actorPlayerId: ACTOR_ID,
    pressId: 'prs-1',
    undoneByPlayerId: ACTOR_ID,
  },
  'bet.created': {
    type: 'bet.created',
    eventId: EVENT_ID,
    actorPlayerId: ACTOR_ID,
    betId: 'bet-1',
    playerAId: PLAYER_A_ID,
    playerBId: PLAYER_B_ID,
    betType: 'match-play',
    stakePerHoleCents: 500,
  },
  'rule_set.revised': {
    type: 'rule_set.revised',
    eventId: EVENT_ID,
    actorPlayerId: ACTOR_ID,
    ruleSetId: 'rs-1',
    revisionId: 'rsr-1',
  },
  'subgame.computed': {
    type: 'subgame.computed',
    eventId: EVENT_ID,
    roundId: ROUND_ID,
    actorPlayerId: ACTOR_ID,
    subGameId: 'sg-1',
    subGameResultId: 'sgr-1',
    totalPotCents: 4000,
  },
  'gallery.uploaded': {
    type: 'gallery.uploaded',
    eventId: EVENT_ID,
    actorPlayerId: ACTOR_ID,
    photoId: 'ph-1',
  },
  'award.triggered': {
    type: 'award.triggered',
    eventId: EVENT_ID,
    roundId: ROUND_ID,
    awardType: 'first_birdie_of_event',
    playerId: PLAYER_A_ID,
    context: { holeNumber: 7, grossStrokes: 3, par: 4 },
  },
};

// ---- Per-type valid-payload tests -----------------------------------------

describe('emitActivity — valid payloads insert correctly', () => {
  for (const type of ACTIVITY_TYPES) {
    test(`${type}: valid payload writes a row with correct columns`, async () => {
      const event = validEvents[type];
      await db.transaction(async (tx) => {
        await emitActivity(tx, event);
      });
      const rows = await db.select().from(activity).where(eq(activity.type, type));
      expect(rows.length).toBe(1);
      const row = rows[0]!;
      expect(row.eventId).toBe(EVENT_ID);
      expect(row.type).toBe(type);
      // roundId column may be null for variants without roundId.
      const expectedRoundId = (event as { roundId?: string }).roundId ?? null;
      expect(row.roundId).toBe(expectedRoundId);
      expect(row.actorPlayerId).toBe((event as { actorPlayerId?: string }).actorPlayerId ?? null);
      expect(row.tenantId).toBe(TENANT_ID);
      expect(row.contextId).toBe(`activity:${EVENT_ID}`);
      const persisted = JSON.parse(row.payloadJson) as { type: string; eventId: string };
      expect(persisted.type).toBe(type);
      expect(persisted.eventId).toBe(EVENT_ID);
    });
  }
});

// ---- Per-type invalid-payload tests ---------------------------------------

describe('emitActivity — invalid payloads throw ZodError', () => {
  for (const type of ACTIVITY_TYPES) {
    test(`${type}: invalid payload throws and no row is written`, async () => {
      // Inject an invalid value: empty eventId (rejected by .min(1)).
      const invalid = { ...validEvents[type], eventId: '' } as ActivityEvent;
      await expect(
        db.transaction(async (tx) => {
          await emitActivity(tx, invalid);
        }),
      ).rejects.toThrow(ZodError);
      const rows = await db.select().from(activity).where(eq(activity.type, type));
      expect(rows.length).toBe(0);
    });
  }
});

// ---- Base-shape + discriminator violations --------------------------------

describe('emitActivity — base-shape + discriminator violations', () => {
  test('missing eventId throws ZodError', async () => {
    const evt = { ...validEvents['score.committed'] } as Partial<ActivityEvent>;
    delete evt.eventId;
    await expect(
      db.transaction(async (tx) => {
        await emitActivity(tx, evt as ActivityEvent);
      }),
    ).rejects.toThrow(ZodError);
  });

  test('unknown key on event throws ZodError (.strict() rejects)', async () => {
    const evt = { ...validEvents['score.committed'], extraKey: 'x' } as unknown as ActivityEvent;
    await expect(
      db.transaction(async (tx) => {
        await emitActivity(tx, evt);
      }),
    ).rejects.toThrow(ZodError);
  });

  test('invalid type discriminator throws (no schema lookup)', async () => {
    const evt = { type: 'not.a.real.type', eventId: EVENT_ID } as unknown as ActivityEvent;
    await expect(
      db.transaction(async (tx) => {
        await emitActivity(tx, evt);
      }),
    ).rejects.toThrow();
  });

  test('press.auto_fired team-XOR-betId rule fires (both populated)', async () => {
    const evt = {
      ...validEvents['press.auto_fired'],
      betId: 'bet-x', // team also set in fixture → XOR violated
    } as ActivityEvent;
    await expect(
      db.transaction(async (tx) => {
        await emitActivity(tx, evt);
      }),
    ).rejects.toThrow(ZodError);
  });

  test('press.auto_fired team-XOR-betId rule fires (neither populated)', async () => {
    const valid = validEvents['press.auto_fired'] as { team?: string; betId?: string } & ActivityEvent;
    const evt = { ...valid };
    delete (evt as { team?: string }).team;
    await expect(
      db.transaction(async (tx) => {
        await emitActivity(tx, evt);
      }),
    ).rejects.toThrow(ZodError);
  });
});

// ---- Transaction rollback -------------------------------------------------

describe('emitActivity — transaction rollback', () => {
  test('a Zod throw in emitActivity rolls back sibling writes in the same tx', async () => {
    const beforeCount = (
      await db.select({ n: sql<number>`count(*)` }).from(activity)
    )[0]!.n;
    // Sibling write: insert another player (we'll roll back by emitActivity throwing).
    const siblingPlayerId = 'plr-rollback-test';
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(players).values({
          id: siblingPlayerId,
          name: 'Rollback Test',
          isOrganizer: false,
          createdAt: Date.now(),
          tenantId: TENANT_ID,
          contextId: 'players:test',
        });
        // Now throw via emitActivity with an invalid payload.
        const invalid = { ...validEvents['score.committed'], eventId: '' } as ActivityEvent;
        await emitActivity(tx, invalid);
      }),
    ).rejects.toThrow(ZodError);
    // Assert the sibling player insert rolled back.
    const playerRows = await db
      .select()
      .from(players)
      .where(and(eq(players.id, siblingPlayerId), eq(players.tenantId, TENANT_ID)));
    expect(playerRows.length).toBe(0);
    // And the activity table count is unchanged.
    const afterCount = (
      await db.select({ n: sql<number>`count(*)` }).from(activity)
    )[0]!.n;
    expect(afterCount).toBe(beforeCount);
  });
});

// ---- FK enforcement verification ------------------------------------------

describe('emitActivity — FK enforcement', () => {
  test('rejects an event_id that does not exist in events (FK constraint enforced on tx connection)', async () => {
    // Negative FK assertion — proves PRAGMA foreign_keys=ON applies to
    // the drizzle transaction connection (not just the migration
    // connection). Without this, the seeded-FK guarantees would be
    // theatre.
    const evt: ActivityEvent = {
      ...validEvents['score.committed'],
      eventId: 'evt-does-not-exist',
    };
    // Drizzle wraps the libsql error; both the wrapper message and the
    // chained cause carry the FK signal. Match the wrapper's "Failed
    // query: insert into \"activity\"" prefix as the proof — the only
    // way this throws is the FK constraint (event_id does not exist
    // and there is no other failure mode in this path).
    await expect(
      db.transaction(async (tx) => {
        await emitActivity(tx, evt);
      }),
    ).rejects.toThrow(/Failed query: insert into "activity"/);
  });
});

// ---- Coverage assertion ---------------------------------------------------

describe('emitActivity — coverage', () => {
  test('every ActivityType is exercised in the valid-payload table', () => {
    // If ACTIVITY_TYPES adds a value without a fixture, the per-type tests
    // above would crash at runtime. This explicit assertion catches the
    // gap at suite-collection time (more readable failure message).
    for (const type of ACTIVITY_TYPES) {
      expect(validEvents[type], `missing fixture for ${type}`).toBeDefined();
    }
  });
});
