import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';

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
const { players, events, groups, groupMembers } = await import('./index.js');

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
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(players);
});

async function seedEventAndOrganizer(eventId: string, organizerId: string): Promise<void> {
  await db.insert(players).values({
    id: organizerId,
    isOrganizer: true,
    createdAt: Date.now(),
    name: 'Organizer',
    tenantId: TENANT,
    contextId: 'league:guyan-wolf-cup-friday',
  });
  await db.insert(events).values({
    id: eventId,
    name: 'Pinehurst 2026',
    startDate: Date.now(),
    endDate: Date.now() + 86_400_000,
    timezone: 'America/New_York',
    organizerPlayerId: organizerId,
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: `event:${eventId}`,
  });
}

describe('groups schema (T3-1)', () => {
  test('round-trip: insert with default money_visibility_mode = open', async () => {
    await seedEventAndOrganizer('e1', 'p1');
    await db.insert(groups).values({
      id: 'g1',
      eventId: 'e1',
      name: 'Pinehurst Crew',
      // moneyVisibilityMode omitted → default 'open'
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    const rows = await db.select().from(groups).where(eq(groups.id, 'g1'));
    expect(rows[0]!.moneyVisibilityMode).toBe('open');
  });

  test('CHECK: money_visibility_mode=public (out of allowed set) throws', async () => {
    await seedEventAndOrganizer('e1', 'p1');
    await expect(
      db.insert(groups).values({
        id: 'g1',
        eventId: 'e1',
        name: 'Pinehurst Crew',
        moneyVisibilityMode: 'public', // not in {'open','participant','self_only'}
        createdAt: Date.now(),
        tenantId: TENANT,
        contextId: 'event:e1',
      }),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'CHECK'));
  });

  test('FK CASCADE: deleting parent event removes child groups', async () => {
    await seedEventAndOrganizer('e1', 'p1');
    await db.insert(groups).values({
      id: 'g1',
      eventId: 'e1',
      name: 'Crew',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await db.delete(events).where(eq(events.id, 'e1'));
    const orphans = await db.select().from(groups);
    expect(orphans).toHaveLength(0);
  });
});

describe('group_members schema (T3-1)', () => {
  test('round-trip + composite PK: same (group_id, player_id) cannot duplicate', async () => {
    await seedEventAndOrganizer('e1', 'p1');
    await db.insert(groups).values({
      id: 'g1',
      eventId: 'e1',
      name: 'Crew',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await db.insert(players).values({
      id: 'p2',
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'Player 2',
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(groupMembers).values({
      groupId: 'g1',
      playerId: 'p2',
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await expect(
      db.insert(groupMembers).values({
        groupId: 'g1',
        playerId: 'p2', // same composite PK
        tenantId: TENANT,
        contextId: 'event:e1',
      }),
    ).rejects.toSatisfy(
      (err) =>
        isConstraintError(err, 'UNIQUE') ||
        // SQLite reports composite PK violation as PRIMARYKEY too
        (err instanceof Error && /PRIMARY KEY|UNIQUE/i.test(err.message)),
    );
  });

  test('FK RESTRICT: deleting a player who is a group member throws', async () => {
    await seedEventAndOrganizer('e1', 'p1');
    await db.insert(groups).values({
      id: 'g1',
      eventId: 'e1',
      name: 'Crew',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await db.insert(players).values({
      id: 'p2',
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'Player 2',
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(groupMembers).values({
      groupId: 'g1',
      playerId: 'p2',
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await expect(
      db.delete(players).where(eq(players.id, 'p2')),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'FOREIGNKEY'));
  });

  test('FK CASCADE: deleting parent group removes group_members', async () => {
    await seedEventAndOrganizer('e1', 'p1');
    await db.insert(groups).values({
      id: 'g1',
      eventId: 'e1',
      name: 'Crew',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await db.insert(players).values({
      id: 'p2',
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'P2',
      tenantId: TENANT,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    await db.insert(groupMembers).values({
      groupId: 'g1',
      playerId: 'p2',
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await db.delete(groups).where(eq(groups.id, 'g1'));
    const orphans = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, 'g1'), eq(groupMembers.playerId, 'p2')));
    expect(orphans).toHaveLength(0);
  });
});
