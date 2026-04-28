import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../migrations');

vi.mock('../index.js', async () => {
  // File-scoped private in-memory DB. `:memory:` (no `file:` prefix /
  // no `cache=shared`) gives each createClient call its own independent
  // in-memory DB. We open ONE client here and reuse for every test in
  // this file — perfect cross-file isolation even if vitest pool=threads
  // colocates files in one process. (Codex impl-round-1 isolation guard.)
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

const { client, db } = await import('../index.js');
const {
  players,
  events,
  eventRounds,
  courses,
  courseRevisions,
  rounds,
  holeScores,
  scoreCorrections,
  roundStates,
  scorerAssignments,
} = await import('./index.js');

const TENANT = 'guyan';
const CTX = 'league:guyan-wolf-cup-friday';

function isConstraintError(
  err: unknown,
  kind: 'FOREIGNKEY' | 'CHECK' | 'UNIQUE' | 'NOTNULL',
): boolean {
  if (!err || typeof err !== 'object') return false;
  const cause = (err as { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') return false;
  const c = cause as { code?: unknown; extendedCode?: unknown; message?: unknown };
  const msg = typeof c.message === 'string' ? c.message : '';
  const sentinelMap = {
    FOREIGNKEY: { code: 'SQLITE_CONSTRAINT_FOREIGNKEY', text: 'FOREIGN KEY' },
    CHECK: { code: 'SQLITE_CONSTRAINT_CHECK', text: 'CHECK' },
    UNIQUE: { code: 'SQLITE_CONSTRAINT_UNIQUE', text: 'UNIQUE' },
    NOTNULL: { code: 'SQLITE_CONSTRAINT_NOTNULL', text: 'NOT NULL' },
  };
  const s = sentinelMap[kind];
  return c.code === s.code || c.extendedCode === s.code || msg.includes(s.text);
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  // Reverse FK dependency order. CASCADE covers most but explicit
  // truncation keeps isolation loud and matches the existing convention
  // (events.test.ts / pairings.test.ts).
  await db.delete(scorerAssignments);
  await db.delete(roundStates);
  await db.delete(scoreCorrections);
  await db.delete(holeScores);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

async function seedPlayer(id: string): Promise<string> {
  await db.insert(players).values({
    id,
    isOrganizer: true,
    createdAt: Date.now(),
    name: `Player ${id}`,
    tenantId: TENANT,
    contextId: CTX,
  });
  return id;
}

async function seedRoundOrphan(id: string): Promise<string> {
  // Standalone round (event_id + event_round_id both NULL — v1.5 forward-compat shape).
  await db.insert(rounds).values({
    id,
    holesToPlay: 18,
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: CTX,
  });
  return id;
}

async function seedRoundWithEvent(opts: {
  roundId: string;
  organizerId: string;
}): Promise<{ roundId: string; eventId: string; eventRoundId: string }> {
  const courseId = `course-${opts.roundId}`;
  const courseRevId = `crev-${opts.roundId}`;
  const eventId = `event-${opts.roundId}`;
  const eventRoundId = `er-${opts.roundId}`;
  await db.insert(courses).values({
    id: courseId,
    name: 'Test Course',
    clubName: 'Test Club',
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: CTX,
  });
  await db.insert(courseRevisions).values({
    id: courseRevId,
    courseId,
    revisionNumber: 1,
    sourceUrl: null,
    extractionDate: null,
    verified: false,
    outTotal: 36,
    inTotal: 36,
    courseTotal: 72,
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: CTX,
  });
  await db.insert(events).values({
    id: eventId,
    name: 'Test Event',
    startDate: Date.now(),
    endDate: Date.now() + 86400000,
    timezone: 'America/New_York',
    organizerPlayerId: opts.organizerId,
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: `event:${eventId}`,
  });
  await db.insert(eventRounds).values({
    id: eventRoundId,
    eventId,
    roundNumber: 1,
    roundDate: Date.now(),
    courseRevisionId: courseRevId,
    teeColor: 'blue',
    holesToPlay: 18,
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: `event:${eventId}`,
  });
  await db.insert(rounds).values({
    id: opts.roundId,
    eventId,
    eventRoundId,
    holesToPlay: 18,
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: CTX,
  });
  return { roundId: opts.roundId, eventId, eventRoundId };
}

describe('scoring schema — FK enforcement sanity', () => {
  test('PRAGMA foreign_keys is ON for the test connection', async () => {
    const result = await client.execute('PRAGMA foreign_keys');
    expect(result.rows[0]?.['foreign_keys']).toBe(1);
  });
});

describe('hole_scores — dual UNIQUE behavior (AC #4 load-bearing repro)', () => {
  test('Test 4a — dedupe via ON CONFLICT(dedupe-target) DO NOTHING: identical replay is silent no-op', async () => {
    const playerId = await seedPlayer('p-4a');
    const scorerId = await seedPlayer('s-4a');
    const { roundId } = await seedRoundWithEvent({
      roundId: 'r-4a',
      organizerId: scorerId,
    });

    const baseRow = {
      roundId,
      playerId,
      holeNumber: 1,
      grossStrokes: 4,
      putts: null,
      scorerPlayerId: scorerId,
      clientEventId: 'evt-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tenantId: TENANT,
      contextId: CTX,
    };

    await db.insert(holeScores).values({ id: 'hs-1', ...baseRow });

    // Second insert with SAME cell + SAME client_event_id, but DIFFERENT
    // gross_strokes — production INSERT form via ON CONFLICT(dedupe target).
    await db
      .insert(holeScores)
      .values({ id: 'hs-2', ...baseRow, grossStrokes: 99 })
      .onConflictDoNothing({
        target: [
          holeScores.roundId,
          holeScores.playerId,
          holeScores.holeNumber,
          holeScores.clientEventId,
        ],
      });

    const rows = await db
      .select()
      .from(holeScores)
      .where(eq(holeScores.roundId, roundId));
    expect(rows.length).toBe(1);
    // First insert won — second was deduped (NOT replaced).
    expect(rows[0]?.id).toBe('hs-1');
    expect(rows[0]?.grossStrokes).toBe(4);
  });

  test('Test 4b — collision throws SQLITE_CONSTRAINT_UNIQUE: same cell + DIFFERENT client_event_id', async () => {
    const playerId = await seedPlayer('p-4b');
    const scorerId = await seedPlayer('s-4b');
    const { roundId } = await seedRoundWithEvent({
      roundId: 'r-4b',
      organizerId: scorerId,
    });

    const baseRow = {
      roundId,
      playerId,
      holeNumber: 1,
      grossStrokes: 4,
      putts: null,
      scorerPlayerId: scorerId,
      clientEventId: 'evt-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tenantId: TENANT,
      contextId: CTX,
    };

    await db.insert(holeScores).values({ id: 'hs-3', ...baseRow });

    // Second insert with SAME cell + DIFFERENT client_event_id — cell-level
    // UNIQUE fires; the dedupe target does NOT match, so default conflict
    // resolution (ABORT) runs.
    let caught: unknown = null;
    try {
      await db
        .insert(holeScores)
        .values({
          id: 'hs-4',
          ...baseRow,
          grossStrokes: 5,
          clientEventId: 'evt-2',
        })
        .onConflictDoNothing({
          target: [
            holeScores.roundId,
            holeScores.playerId,
            holeScores.holeNumber,
            holeScores.clientEventId,
          ],
        });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(isConstraintError(caught, 'UNIQUE')).toBe(true);
  });

  test('Test 4c — different cell + same client_event_id is fine (dedupe scope is cell-bound)', async () => {
    const playerId = await seedPlayer('p-4c');
    const scorerId = await seedPlayer('s-4c');
    const { roundId } = await seedRoundWithEvent({
      roundId: 'r-4c',
      organizerId: scorerId,
    });

    const baseRow = {
      roundId,
      playerId,
      grossStrokes: 4,
      putts: null,
      scorerPlayerId: scorerId,
      clientEventId: 'evt-X',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tenantId: TENANT,
      contextId: CTX,
    };

    await db.insert(holeScores).values({ id: 'hs-5', ...baseRow, holeNumber: 1 });
    await db
      .insert(holeScores)
      .values({ id: 'hs-6', ...baseRow, holeNumber: 2 })
      .onConflictDoNothing({
        target: [
          holeScores.roundId,
          holeScores.playerId,
          holeScores.holeNumber,
          holeScores.clientEventId,
        ],
      });

    const rows = await db
      .select()
      .from(holeScores)
      .where(eq(holeScores.roundId, roundId));
    expect(rows.length).toBe(2);
  });
});

describe('rounds — chk_rounds_event_pairing CHECK', () => {
  test('inserting a round with event_id NULL but event_round_id set → SQLITE_CONSTRAINT_CHECK', async () => {
    const organizerId = await seedPlayer('p-chk');
    const { eventRoundId } = await seedRoundWithEvent({
      roundId: 'r-chk-host',
      organizerId,
    });
    let caught: unknown = null;
    try {
      await db.insert(rounds).values({
        id: 'r-chk-violator',
        eventId: null,
        eventRoundId,
        holesToPlay: 18,
        createdAt: Date.now(),
        tenantId: TENANT,
        contextId: CTX,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(isConstraintError(caught, 'CHECK')).toBe(true);
  });

  test('inserting a round with both NULL is OK (v1.5 standalone-round forward-compat)', async () => {
    await seedRoundOrphan('r-orphan');
    const rows = await db.select().from(rounds).where(eq(rounds.id, 'r-orphan'));
    expect(rows.length).toBe(1);
    expect(rows[0]?.eventId).toBeNull();
    expect(rows[0]?.eventRoundId).toBeNull();
  });
});

describe('hole_scores — CHECK predicates', () => {
  test('gross_strokes < 1 → SQLITE_CONSTRAINT_CHECK', async () => {
    const playerId = await seedPlayer('p-chk-gs');
    const scorerId = await seedPlayer('s-chk-gs');
    const { roundId } = await seedRoundWithEvent({
      roundId: 'r-chk-gs',
      organizerId: scorerId,
    });
    let caught: unknown = null;
    try {
      await db.insert(holeScores).values({
        id: 'hs-chk-gs',
        roundId,
        playerId,
        holeNumber: 1,
        grossStrokes: 0,
        putts: null,
        scorerPlayerId: scorerId,
        clientEventId: 'evt-chk-gs',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tenantId: TENANT,
        contextId: CTX,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(isConstraintError(caught, 'CHECK')).toBe(true);
  });

  test('hole_number outside [1, 18] → SQLITE_CONSTRAINT_CHECK', async () => {
    const playerId = await seedPlayer('p-chk-hn');
    const scorerId = await seedPlayer('s-chk-hn');
    const { roundId } = await seedRoundWithEvent({
      roundId: 'r-chk-hn',
      organizerId: scorerId,
    });
    let caught: unknown = null;
    try {
      await db.insert(holeScores).values({
        id: 'hs-chk-hn',
        roundId,
        playerId,
        holeNumber: 19,
        grossStrokes: 4,
        putts: null,
        scorerPlayerId: scorerId,
        clientEventId: 'evt-chk-hn',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tenantId: TENANT,
        contextId: CTX,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(isConstraintError(caught, 'CHECK')).toBe(true);
  });
});

describe('hole_scores — FK posture', () => {
  test('FK CASCADE: deleting a round deletes its hole_scores', async () => {
    const playerId = await seedPlayer('p-cascade');
    const scorerId = await seedPlayer('s-cascade');
    const { roundId } = await seedRoundWithEvent({
      roundId: 'r-cascade',
      organizerId: scorerId,
    });
    await db.insert(holeScores).values({
      id: 'hs-cascade',
      roundId,
      playerId,
      holeNumber: 5,
      grossStrokes: 4,
      putts: null,
      scorerPlayerId: scorerId,
      clientEventId: 'evt-cascade',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tenantId: TENANT,
      contextId: CTX,
    });

    await db.delete(rounds).where(eq(rounds.id, roundId));

    const surviving = await db
      .select()
      .from(holeScores)
      .where(eq(holeScores.roundId, roundId));
    expect(surviving.length).toBe(0);
  });

  test('FK RESTRICT: deleting a player with hole_scores rows throws', async () => {
    const playerId = await seedPlayer('p-restrict');
    const scorerId = await seedPlayer('s-restrict');
    const { roundId } = await seedRoundWithEvent({
      roundId: 'r-restrict',
      organizerId: scorerId,
    });
    await db.insert(holeScores).values({
      id: 'hs-restrict',
      roundId,
      playerId,
      holeNumber: 5,
      grossStrokes: 4,
      putts: null,
      scorerPlayerId: scorerId,
      clientEventId: 'evt-restrict',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tenantId: TENANT,
      contextId: CTX,
    });

    let caught: unknown = null;
    try {
      await db.delete(players).where(eq(players.id, playerId));
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(isConstraintError(caught, 'FOREIGNKEY')).toBe(true);
  });
});
