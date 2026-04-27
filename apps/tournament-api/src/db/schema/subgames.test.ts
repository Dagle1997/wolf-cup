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
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

const { db } = await import('../index.js');
const {
  players,
  courses,
  courseRevisions,
  events,
  eventRounds,
  subGames,
  subGameParticipants,
} = await import('./index.js');

const TENANT = 'guyan';

function isConstraintError(
  err: unknown,
  kind: 'FOREIGNKEY' | 'CHECK' | 'UNIQUE',
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
  };
  const s = sentinelMap[kind];
  return c.code === s.code || c.extendedCode === s.code || msg.includes(s.text);
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(subGameParticipants);
  await db.delete(subGames);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

async function seedEventRound(eventRoundId = 'er1'): Promise<string> {
  await db.insert(players).values({
    id: 'p1',
    isOrganizer: true,
    createdAt: Date.now(),
    name: 'P1',
    tenantId: TENANT,
    contextId: 'league:guyan-wolf-cup-friday',
  });
  await db.insert(courses).values({
    id: 'c1',
    name: 'Pinehurst',
    clubName: 'Resort',
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: 'library:guyan',
  });
  await db.insert(courseRevisions).values({
    id: 'cr1',
    courseId: 'c1',
    revisionNumber: 1,
    outTotal: 36,
    inTotal: 36,
    courseTotal: 72,
    verified: true,
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: 'library:guyan',
  });
  await db.insert(events).values({
    id: 'e1',
    name: 'Pinehurst 2026',
    startDate: Date.now(),
    endDate: Date.now() + 86_400_000,
    timezone: 'America/New_York',
    organizerPlayerId: 'p1',
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: 'event:e1',
  });
  await db.insert(eventRounds).values({
    id: eventRoundId,
    eventId: 'e1',
    roundNumber: 1,
    roundDate: Date.now(),
    courseRevisionId: 'cr1',
    teeColor: 'blue',
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: 'event:e1',
  });
  return eventRoundId;
}

describe('sub_games schema (T3-1)', () => {
  test('round-trip: insert with default config_json and buy_in', async () => {
    await seedEventRound();
    await db.insert(subGames).values({
      id: 'sg1',
      eventRoundId: 'er1',
      type: 'skins',
      // configJson + buyInPerParticipant omitted → defaults '{}' and 0
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    const rows = await db.select().from(subGames).where(eq(subGames.id, 'sg1'));
    expect(rows[0]!.type).toBe('skins');
    expect(rows[0]!.configJson).toBe('{}');
    expect(rows[0]!.buyInPerParticipant).toBe(0);
  });

  test('CHECK: type=poker (not in allowed set) throws', async () => {
    await seedEventRound();
    await expect(
      db.insert(subGames).values({
        id: 'sg1',
        eventRoundId: 'er1',
        type: 'poker', // not in {skins, ctp, sandies, putting_contest}
        createdAt: Date.now(),
        tenantId: TENANT,
        contextId: 'event:e1',
      }),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'CHECK'));
  });

  test('CHECK: buy_in_per_participant=-100 throws (non-negative cents)', async () => {
    await seedEventRound();
    await expect(
      db.insert(subGames).values({
        id: 'sg1',
        eventRoundId: 'er1',
        type: 'skins',
        buyInPerParticipant: -100,
        createdAt: Date.now(),
        tenantId: TENANT,
        contextId: 'event:e1',
      }),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'CHECK'));
  });

  test('FK CASCADE: deleting parent event_round removes sub_games', async () => {
    await seedEventRound();
    await db.insert(subGames).values({
      id: 'sg1',
      eventRoundId: 'er1',
      type: 'skins',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await db.delete(eventRounds).where(eq(eventRounds.id, 'er1'));
    const orphans = await db.select().from(subGames);
    expect(orphans).toHaveLength(0);
  });
});

describe('sub_game_participants schema (T3-1)', () => {
  test('round-trip + composite PK uniqueness', async () => {
    await seedEventRound();
    await db.insert(subGames).values({
      id: 'sg1',
      eventRoundId: 'er1',
      type: 'skins',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await db.insert(subGameParticipants).values({
      subGameId: 'sg1',
      playerId: 'p1',
      optedInAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await expect(
      db.insert(subGameParticipants).values({
        subGameId: 'sg1',
        playerId: 'p1', // duplicate composite PK
        optedInAt: Date.now(),
        tenantId: TENANT,
        contextId: 'event:e1',
      }),
    ).rejects.toSatisfy(
      (err) =>
        isConstraintError(err, 'UNIQUE') ||
        (err instanceof Error && /PRIMARY KEY|UNIQUE/i.test(err.message)),
    );
  });

  test('FK CASCADE: deleting parent sub_game removes sub_game_participants', async () => {
    await seedEventRound();
    await db.insert(subGames).values({
      id: 'sg1',
      eventRoundId: 'er1',
      type: 'skins',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await db.insert(subGameParticipants).values({
      subGameId: 'sg1',
      playerId: 'p1',
      optedInAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await db.delete(subGames).where(eq(subGames.id, 'sg1'));
    const orphans = await db.select().from(subGameParticipants);
    expect(orphans).toHaveLength(0);
  });

  test('FK RESTRICT: cannot delete a player while they are a sub_game_participant', async () => {
    await seedEventRound();
    await db.insert(subGames).values({
      id: 'sg1',
      eventRoundId: 'er1',
      type: 'skins',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await db.insert(subGameParticipants).values({
      subGameId: 'sg1',
      playerId: 'p1',
      optedInAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await expect(
      db.delete(players).where(eq(players.id, 'p1')),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'FOREIGNKEY'));
  });
});
