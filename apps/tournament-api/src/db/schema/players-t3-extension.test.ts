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
  sessions,
  deviceBindings,
  events,
  eventRounds,
  invites,
  groups,
  groupMembers,
  subGames,
  subGameParticipants,
  courses,
  courseRevisions,
} = await import('./index.js');

const TENANT = 'guyan';

function isConstraintError(err: unknown, kind: 'UNIQUE' | 'NOTNULL'): boolean {
  if (!err || typeof err !== 'object') return false;
  const cause = (err as { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') return false;
  const c = cause as { code?: unknown; extendedCode?: unknown; message?: unknown };
  const msg = typeof c.message === 'string' ? c.message : '';
  const sentinelMap = {
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
  // truncation keeps isolation loud.
  await db.delete(subGameParticipants);
  await db.delete(subGames);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(invites);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(deviceBindings);
  await db.delete(sessions);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

describe('players T3-1 extension (new columns)', () => {
  test('insert with all new columns set + read back', async () => {
    await db.insert(players).values({
      id: 'p1',
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'Josh Stoll',
      ghin: '1234567',
      manualHandicapIndex: 8.4,
      preferredTeeColor: 'blue',
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    const rows = await db.select().from(players).where(eq(players.id, 'p1'));
    expect(rows[0]!.name).toBe('Josh Stoll');
    expect(rows[0]!.ghin).toBe('1234567');
    expect(rows[0]!.manualHandicapIndex).toBe(8.4);
    expect(rows[0]!.preferredTeeColor).toBe('blue');
  });

  test('name defaults to empty string when omitted (additive ALTER non-destructive)', async () => {
    await db.insert(players).values({
      id: 'p1',
      isOrganizer: false,
      createdAt: Date.now(),
      // name omitted → DEFAULT ''
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    const rows = await db.select().from(players).where(eq(players.id, 'p1'));
    expect(rows[0]!.name).toBe('');
  });

  test('partial unique on ghin: two players with NULL ghin both succeed', async () => {
    await db.insert(players).values({
      id: 'p1',
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'A',
      // ghin NULL
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(players).values({
      id: 'p2',
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'B',
      // ghin NULL — partial unique should NOT fire
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    const all = await db.select().from(players);
    expect(all).toHaveLength(2);
  });

  test('partial unique on ghin: two players with same non-null ghin → UNIQUE violation', async () => {
    await db.insert(players).values({
      id: 'p1',
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'A',
      ghin: '7777777',
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await expect(
      db.insert(players).values({
        id: 'p2',
        isOrganizer: false,
        createdAt: Date.now(),
        name: 'B',
        ghin: '7777777',
        tenantId: TENANT,
        contextId: 'league:guyan-wolf-cup-friday',
      }),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'UNIQUE'));
  });
});

describe('device_bindings schema (T3-1)', () => {
  test('insert with session_id NULL succeeds (load-bearing T3-6 invite-claim path)', async () => {
    await db.insert(players).values({
      id: 'p1',
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'P1',
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(deviceBindings).values({
      id: 'db1',
      playerId: 'p1',
      // sessionId NULL — pre-SSO claim state
      deviceInfo: 'iPhone 15',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    const rows = await db.select().from(deviceBindings).where(eq(deviceBindings.id, 'db1'));
    expect(rows[0]!.sessionId).toBeNull();
  });

  test('insert with valid session_id succeeds', async () => {
    await db.insert(players).values({
      id: 'p1',
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'P1',
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(sessions).values({
      sessionId: 'sess1',
      playerId: 'p1',
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      expiresAt: Date.now() + 86_400_000,
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(deviceBindings).values({
      id: 'db1',
      playerId: 'p1',
      sessionId: 'sess1',
      deviceInfo: 'iPhone 15',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    const rows = await db.select().from(deviceBindings).where(eq(deviceBindings.id, 'db1'));
    expect(rows[0]!.sessionId).toBe('sess1');
  });

  test('FK SET NULL: deleting parent session sets device_bindings.session_id to NULL', async () => {
    await db.insert(players).values({
      id: 'p1',
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'P1',
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(sessions).values({
      sessionId: 'sess1',
      playerId: 'p1',
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      expiresAt: Date.now() + 86_400_000,
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(deviceBindings).values({
      id: 'db1',
      playerId: 'p1',
      sessionId: 'sess1',
      deviceInfo: 'iPhone 15',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await db.delete(sessions).where(eq(sessions.sessionId, 'sess1'));
    const rows = await db.select().from(deviceBindings).where(eq(deviceBindings.id, 'db1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sessionId).toBeNull();
  });

  test('NOT NULL: missing device_info throws SQLITE_CONSTRAINT_NOTNULL', async () => {
    await db.insert(players).values({
      id: 'p1',
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'P1',
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await expect(
      db.insert(deviceBindings).values({
        id: 'db1',
        playerId: 'p1',
        // deviceInfo omitted
        createdAt: Date.now(),
        tenantId: TENANT,
        contextId: 'event:e1',
      } as never),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'NOTNULL'));
  });

  test('FK CASCADE: deleting parent player removes device_bindings', async () => {
    // Player must NOT be referenced by FK-RESTRICT children for the
    // cascade test to even reach the device_bindings level.
    await db.insert(players).values({
      id: 'p1',
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'P1',
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(deviceBindings).values({
      id: 'db1',
      playerId: 'p1',
      deviceInfo: 'iPhone',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await db.delete(players).where(eq(players.id, 'p1'));
    const orphans = await db.select().from(deviceBindings);
    expect(orphans).toHaveLength(0);
  });
});

describe('multi-hop cascade chain (AC #12b)', () => {
  test('DELETE event cascades through event_rounds → sub_games → sub_game_participants AND through groups → group_members', async () => {
    // Seed: players (organizer + 2 members) + course/revision + event + 2
    // event_rounds + 1 sub_game per round + 2 participants per sub_game +
    // 1 group + 2 group_members.
    await db.insert(players).values({
      id: 'p-org',
      isOrganizer: true,
      createdAt: Date.now(),
      name: 'Organizer',
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(players).values({
      id: 'p-a',
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'A',
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(players).values({
      id: 'p-b',
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'B',
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
      endDate: Date.now() + 86_400_000 * 4,
      timezone: 'America/New_York',
      organizerPlayerId: 'p-org',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    for (const r of [1, 2]) {
      await db.insert(eventRounds).values({
        id: `er${r}`,
        eventId: 'e1',
        roundNumber: r,
        roundDate: Date.now() + r * 86_400_000,
        courseRevisionId: 'cr1',
        teeColor: 'blue',
        createdAt: Date.now(),
        tenantId: TENANT,
        contextId: 'event:e1',
      });
      await db.insert(subGames).values({
        id: `sg${r}`,
        eventRoundId: `er${r}`,
        type: 'skins',
        createdAt: Date.now(),
        tenantId: TENANT,
        contextId: 'event:e1',
      });
      for (const playerId of ['p-a', 'p-b']) {
        await db.insert(subGameParticipants).values({
          subGameId: `sg${r}`,
          playerId,
          optedInAt: Date.now(),
          tenantId: TENANT,
          contextId: 'event:e1',
        });
      }
    }
    await db.insert(groups).values({
      id: 'g1',
      eventId: 'e1',
      name: 'Crew',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    for (const playerId of ['p-a', 'p-b']) {
      await db.insert(groupMembers).values({
        groupId: 'g1',
        playerId,
        tenantId: TENANT,
        contextId: 'event:e1',
      });
    }

    // Sanity pre-check: 2 event_rounds, 2 sub_games, 4 participants, 1
    // group, 2 group_members.
    expect(await db.select().from(eventRounds)).toHaveLength(2);
    expect(await db.select().from(subGames)).toHaveLength(2);
    expect(await db.select().from(subGameParticipants)).toHaveLength(4);
    expect(await db.select().from(groups)).toHaveLength(1);
    expect(await db.select().from(groupMembers)).toHaveLength(2);

    // Delete the event — cascade should sweep all event-children.
    await db.delete(events).where(eq(events.id, 'e1'));

    expect(await db.select().from(eventRounds)).toHaveLength(0);
    expect(await db.select().from(subGames)).toHaveLength(0);
    expect(await db.select().from(subGameParticipants)).toHaveLength(0);
    expect(await db.select().from(groups)).toHaveLength(0);
    expect(await db.select().from(groupMembers)).toHaveLength(0);

    // Players are NOT deleted (no FK from event → player; the player FKs
    // are RESTRICT but those children are gone now).
    const playersRemaining = await db.select().from(players);
    expect(playersRemaining).toHaveLength(3);
  });
});
