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
  ruleSets,
  ruleSetRevisions,
} = await import('./index.js');

const TENANT = 'guyan';

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
  await db.delete(ruleSetRevisions);
  await db.delete(ruleSets);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

async function seedEventRound(): Promise<{ playerId: string; eventRoundId: string }> {
  const playerId = 'p1';
  await db.insert(players).values({
    id: playerId,
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
    organizerPlayerId: playerId,
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: 'event:e1',
  });
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
  return { playerId, eventRoundId: 'er1' };
}

describe('rule_sets schema (T3-1)', () => {
  test('round-trip: insert + read', async () => {
    await db.insert(ruleSets).values({
      id: 'rs1',
      name: 'Standard Wolf Rules',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'library:guyan',
    });
    const rows = await db.select().from(ruleSets).where(eq(ruleSets.id, 'rs1'));
    expect(rows[0]!.name).toBe('Standard Wolf Rules');
    expect(rows[0]!.contextId).toBe('library:guyan');
  });

  test('NOT NULL: missing name throws SQLITE_CONSTRAINT_NOTNULL', async () => {
    await expect(
      db.insert(ruleSets).values({
        id: 'rs1',
        // name omitted
        createdAt: Date.now(),
        tenantId: TENANT,
        contextId: 'library:guyan',
      } as never),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'NOTNULL'));
  });
});

describe('rule_set_revisions schema (T3-1)', () => {
  test('round-trip: insert with effective_from_round_id NULL (baseline)', async () => {
    await db.insert(ruleSets).values({
      id: 'rs1',
      name: 'Standard',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'library:guyan',
    });
    const { playerId } = await seedEventRound();
    await db.insert(ruleSetRevisions).values({
      id: 'rsr1',
      ruleSetId: 'rs1',
      revisionNumber: 1,
      configJson: '{"foo":"bar"}',
      // effectiveFromRoundId omitted → NULL → "from event start" semantics
      createdByPlayerId: playerId,
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'library:guyan',
    });
    const rows = await db.select().from(ruleSetRevisions).where(eq(ruleSetRevisions.id, 'rsr1'));
    expect(rows[0]!.effectiveFromRoundId).toBeNull();
    expect(rows[0]!.effectiveFromHole).toBe(1);
  });

  test('CHECK: effective_from_hole=20 (out of 1..19) throws', async () => {
    await db.insert(ruleSets).values({
      id: 'rs1',
      name: 'Standard',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'library:guyan',
    });
    const { playerId } = await seedEventRound();
    await expect(
      db.insert(ruleSetRevisions).values({
        id: 'rsr1',
        ruleSetId: 'rs1',
        revisionNumber: 1,
        configJson: '{}',
        effectiveFromHole: 20,
        createdByPlayerId: playerId,
        createdAt: Date.now(),
        tenantId: TENANT,
        contextId: 'library:guyan',
      }),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'CHECK'));
  });

  test('UNIQUE: duplicate (rule_set_id, revision_number) throws', async () => {
    await db.insert(ruleSets).values({
      id: 'rs1',
      name: 'Standard',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'library:guyan',
    });
    const { playerId } = await seedEventRound();
    await db.insert(ruleSetRevisions).values({
      id: 'rsr1',
      ruleSetId: 'rs1',
      revisionNumber: 1,
      configJson: '{}',
      createdByPlayerId: playerId,
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'library:guyan',
    });
    await expect(
      db.insert(ruleSetRevisions).values({
        id: 'rsr2',
        ruleSetId: 'rs1',
        revisionNumber: 1, // duplicate
        configJson: '{}',
        createdByPlayerId: playerId,
        createdAt: Date.now(),
        tenantId: TENANT,
        contextId: 'library:guyan',
      }),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'UNIQUE'));
  });

  test('FK RESTRICT: deleting parent rule_set with revisions throws', async () => {
    await db.insert(ruleSets).values({
      id: 'rs1',
      name: 'Standard',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'library:guyan',
    });
    const { playerId } = await seedEventRound();
    await db.insert(ruleSetRevisions).values({
      id: 'rsr1',
      ruleSetId: 'rs1',
      revisionNumber: 1,
      configJson: '{}',
      createdByPlayerId: playerId,
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'library:guyan',
    });
    await expect(
      db.delete(ruleSets).where(eq(ruleSets.id, 'rs1')),
    ).rejects.toSatisfy((err) => isConstraintError(err, 'FOREIGNKEY'));
  });

  test('FK SET NULL: deleting referenced event_round nulls effective_from_round_id (load-bearing for event-cascade)', async () => {
    await db.insert(ruleSets).values({
      id: 'rs1',
      name: 'Standard',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'library:guyan',
    });
    const { playerId, eventRoundId } = await seedEventRound();
    await db.insert(ruleSetRevisions).values({
      id: 'rsr1',
      ruleSetId: 'rs1',
      revisionNumber: 1,
      configJson: '{}',
      effectiveFromRoundId: eventRoundId,
      createdByPlayerId: playerId,
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'library:guyan',
    });
    // Direct delete of event_round → revision survives, FK nulled
    await db.delete(eventRounds).where(eq(eventRounds.id, eventRoundId));
    const rows = await db.select().from(ruleSetRevisions).where(eq(ruleSetRevisions.id, 'rsr1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.effectiveFromRoundId).toBeNull();
  });

  test('Full event-cascade: DELETE event → event_rounds CASCADE → rule_set_revisions effective_from SET NULL', async () => {
    await db.insert(ruleSets).values({
      id: 'rs1',
      name: 'Standard',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'library:guyan',
    });
    const { playerId, eventRoundId } = await seedEventRound();
    await db.insert(ruleSetRevisions).values({
      id: 'rsr1',
      ruleSetId: 'rs1',
      revisionNumber: 1,
      configJson: '{}',
      effectiveFromRoundId: eventRoundId,
      createdByPlayerId: playerId,
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'library:guyan',
    });
    // Event delete: cascades to event_rounds; event_round delete cascades to
    // rule_set_revisions.effective_from_round_id (SET NULL); revision survives.
    await db.delete(events).where(eq(events.id, 'e1'));
    const eventRoundRows = await db.select().from(eventRounds);
    expect(eventRoundRows).toHaveLength(0);
    const revisionRows = await db.select().from(ruleSetRevisions).where(eq(ruleSetRevisions.id, 'rsr1'));
    expect(revisionRows).toHaveLength(1);
    expect(revisionRows[0]!.effectiveFromRoundId).toBeNull();
  });
});
