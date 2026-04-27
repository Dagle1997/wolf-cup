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
  invites,
} = await import('./index.js');

const TENANT = 'guyan';

function isConstraintError(
  err: unknown,
  kind: 'FOREIGNKEY' | 'CHECK' | 'UNIQUE' | 'NOTNULL',
): boolean {
  if (!err || typeof err !== 'object') return false;
  const cause = (err as { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') return false;
  const c = cause as { code?: unknown; extendedCode?: unknown; rawCode?: unknown; message?: unknown };
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
  // truncation keeps isolation loud.
  await db.delete(invites);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

async function seedPlayer(id: string, isOrganizer = true): Promise<string> {
  await db.insert(players).values({
    id,
    isOrganizer,
    createdAt: Date.now(),
    name: 'Test Player',
    tenantId: TENANT,
    contextId: 'league:guyan-wolf-cup-friday',
  });
  return id;
}

async function seedCourseRevision(courseId: string, revisionId: string): Promise<string> {
  await db.insert(courses).values({
    id: courseId,
    name: 'Pinehurst No. 2',
    clubName: 'Pinehurst Resort',
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: 'library:guyan',
  });
  await db.insert(courseRevisions).values({
    id: revisionId,
    courseId,
    revisionNumber: 1,
    outTotal: 36,
    inTotal: 36,
    courseTotal: 72,
    verified: true,
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: 'library:guyan',
  });
  return revisionId;
}

async function seedEvent(eventId: string, organizerId: string): Promise<string> {
  await db.insert(events).values({
    id: eventId,
    name: 'Pinehurst 2026',
    startDate: 1_715_040_000_000,
    endDate: 1_715_300_000_000,
    timezone: 'America/New_York',
    organizerPlayerId: organizerId,
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: `event:${eventId}`,
  });
  return eventId;
}

describe('events schema (T3-1)', () => {
  test('round-trip: insert events row with FD-6 context_id stamping', async () => {
    const organizerId = await seedPlayer('p1');
    await seedEvent('e1', organizerId);
    const rows = await db.select().from(events).where(eq(events.id, 'e1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Pinehurst 2026');
    expect(rows[0]!.timezone).toBe('America/New_York');
    expect(rows[0]!.organizerPlayerId).toBe(organizerId);
    expect(rows[0]!.tenantId).toBe(TENANT);
    expect(rows[0]!.contextId).toBe('event:e1');
  });

  test('NOT NULL: missing timezone → SQLITE_CONSTRAINT_NOTNULL', async () => {
    const organizerId = await seedPlayer('p1');
    await expect(
      db.insert(events).values({
        id: 'e1',
        name: 'Pinehurst 2026',
        startDate: Date.now(),
        endDate: Date.now() + 1000,
        // timezone omitted
        organizerPlayerId: organizerId,
        createdAt: Date.now(),
        tenantId: TENANT,
        contextId: 'event:e1',
      } as never),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'NOTNULL'));
  });

  test('FK RESTRICT: deleting organizer player while events reference them throws', async () => {
    const organizerId = await seedPlayer('p1');
    await seedEvent('e1', organizerId);
    await expect(
      db.delete(players).where(eq(players.id, organizerId)),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'FOREIGNKEY'));
  });

  test('multi-tenant isolation: two events with same name + start_date under different tenants both succeed', async () => {
    const organizerId = await seedPlayer('p1');
    await db.insert(events).values({
      id: 'e1',
      name: 'Spring Open',
      startDate: 1_715_040_000_000,
      endDate: 1_715_300_000_000,
      timezone: 'America/New_York',
      organizerPlayerId: organizerId,
      createdAt: Date.now(),
      tenantId: 'guyan',
      contextId: 'event:e1',
    });
    await db.insert(events).values({
      id: 'e2',
      name: 'Spring Open',
      startDate: 1_715_040_000_000,
      endDate: 1_715_300_000_000,
      timezone: 'America/New_York',
      organizerPlayerId: organizerId,
      createdAt: Date.now(),
      tenantId: 'other-tenant',
      contextId: 'event:e2',
    });
    const all = await db.select().from(events);
    expect(all).toHaveLength(2);
  });
});

describe('event_rounds schema (T3-1)', () => {
  test('round-trip: insert event_rounds row + read back inheriting parent contextId', async () => {
    const organizerId = await seedPlayer('p1');
    await seedEvent('e1', organizerId);
    await seedCourseRevision('c1', 'cr1');
    await db.insert(eventRounds).values({
      id: 'er1',
      eventId: 'e1',
      roundNumber: 1,
      roundDate: 1_715_040_000_000,
      courseRevisionId: 'cr1',
      teeColor: 'blue',
      holesToPlay: 18,
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    const rows = await db.select().from(eventRounds).where(eq(eventRounds.id, 'er1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contextId).toBe('event:e1');
    expect(rows[0]!.holesToPlay).toBe(18);
  });

  test('CHECK: holes_to_play=12 (not in (9,18)) throws SQLITE_CONSTRAINT_CHECK', async () => {
    const organizerId = await seedPlayer('p1');
    await seedEvent('e1', organizerId);
    await seedCourseRevision('c1', 'cr1');
    await expect(
      db.insert(eventRounds).values({
        id: 'er1',
        eventId: 'e1',
        roundNumber: 1,
        roundDate: Date.now(),
        courseRevisionId: 'cr1',
        teeColor: 'blue',
        holesToPlay: 12,
        createdAt: Date.now(),
        tenantId: TENANT,
        contextId: 'event:e1',
      }),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'CHECK'));
  });

  test('UNIQUE: duplicate (event_id, round_number) throws SQLITE_CONSTRAINT_UNIQUE', async () => {
    const organizerId = await seedPlayer('p1');
    await seedEvent('e1', organizerId);
    await seedCourseRevision('c1', 'cr1');
    await db.insert(eventRounds).values({
      id: 'er1',
      eventId: 'e1',
      roundNumber: 1,
      roundDate: Date.now(),
      courseRevisionId: 'cr1',
      teeColor: 'blue',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await expect(
      db.insert(eventRounds).values({
        id: 'er2',
        eventId: 'e1',
        roundNumber: 1, // duplicate within same event
        roundDate: Date.now(),
        courseRevisionId: 'cr1',
        teeColor: 'red',
        createdAt: Date.now(),
        tenantId: TENANT,
        contextId: 'event:e1',
      }),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'UNIQUE'));
  });

  test('FK CASCADE: deleting parent event removes child event_rounds', async () => {
    const organizerId = await seedPlayer('p1');
    await seedEvent('e1', organizerId);
    await seedCourseRevision('c1', 'cr1');
    await db.insert(eventRounds).values({
      id: 'er1',
      eventId: 'e1',
      roundNumber: 1,
      roundDate: Date.now(),
      courseRevisionId: 'cr1',
      teeColor: 'blue',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await db.delete(events).where(eq(events.id, 'e1'));
    const orphans = await db.select().from(eventRounds);
    expect(orphans).toHaveLength(0);
  });

  test('FK RESTRICT: deleting course_revisions row while event_rounds reference it throws', async () => {
    const organizerId = await seedPlayer('p1');
    await seedEvent('e1', organizerId);
    await seedCourseRevision('c1', 'cr1');
    await db.insert(eventRounds).values({
      id: 'er1',
      eventId: 'e1',
      roundNumber: 1,
      roundDate: Date.now(),
      courseRevisionId: 'cr1',
      teeColor: 'blue',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await expect(
      db.delete(courseRevisions).where(eq(courseRevisions.id, 'cr1')),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'FOREIGNKEY'));
  });
});

describe('invites schema (T3-1)', () => {
  test('FK RESTRICT: deleting created_by_player_id while invites reference them throws', async () => {
    const organizerId = await seedPlayer('p1');
    await seedEvent('e1', organizerId);
    await db.insert(invites).values({
      id: 'i1',
      eventId: 'e1',
      token: 'token-x',
      expiresAt: Date.now() + 86_400_000,
      createdByPlayerId: organizerId,
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await expect(
      db.delete(players).where(eq(players.id, organizerId)),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'FOREIGNKEY'));
  });

  test('NOT NULL: missing token throws', async () => {
    const organizerId = await seedPlayer('p1');
    await seedEvent('e1', organizerId);
    await expect(
      db.insert(invites).values({
        id: 'i1',
        eventId: 'e1',
        // token omitted
        expiresAt: Date.now() + 86_400_000,
        createdByPlayerId: organizerId,
        createdAt: Date.now(),
        tenantId: TENANT,
        contextId: 'event:e1',
      } as never),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'NOTNULL'));
  });

  test('round-trip + UNIQUE token across events', async () => {
    const organizerId = await seedPlayer('p1');
    await seedEvent('e1', organizerId);
    await seedEvent('e2', organizerId);
    await db.insert(invites).values({
      id: 'i1',
      eventId: 'e1',
      token: 'invite-token-shared',
      expiresAt: Date.now() + 86_400_000,
      createdByPlayerId: organizerId,
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    // Same token across DIFFERENT event still violates UNIQUE — token is global.
    await expect(
      db.insert(invites).values({
        id: 'i2',
        eventId: 'e2',
        token: 'invite-token-shared',
        expiresAt: Date.now() + 86_400_000,
        createdByPlayerId: organizerId,
        createdAt: Date.now(),
        tenantId: TENANT,
        contextId: 'event:e2',
      }),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'UNIQUE'));
  });

  test('FK CASCADE: deleting parent event removes invites', async () => {
    const organizerId = await seedPlayer('p1');
    await seedEvent('e1', organizerId);
    await db.insert(invites).values({
      id: 'i1',
      eventId: 'e1',
      token: 'invite-token-1',
      expiresAt: Date.now() + 86_400_000,
      createdByPlayerId: organizerId,
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'event:e1',
    });
    await db.delete(events).where(eq(events.id, 'e1'));
    const orphans = await db.select().from(invites);
    expect(orphans).toHaveLength(0);
  });
});
