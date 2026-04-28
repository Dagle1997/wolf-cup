import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

const { db } = await import('../db/index.js');
const { auditLog, players } = await import('../db/schema/index.js');
const { writeAudit, AUDIT_EVENT_TYPES, AUDIT_ENTITY_TYPES } = await import(
  './audit-log.js'
);

const TENANT = 'guyan';
const CTX = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(players);
});

describe('writeAudit', () => {
  test('inserts a row with all fields populated; payload_json round-trips via JSON.parse', async () => {
    await db.insert(players).values({
      id: 'p-actor',
      isOrganizer: true,
      createdAt: Date.now(),
      name: 'Actor',
      tenantId: TENANT,
      contextId: CTX,
    });

    await writeAudit(db, {
      eventType: AUDIT_EVENT_TYPES.SCORE_COMMITTED,
      entityType: AUDIT_ENTITY_TYPES.HOLE_SCORE,
      entityId: 'hs-1',
      actorPlayerId: 'p-actor',
      payload: { roundId: 'r-1', holeNumber: 5, grossStrokes: 4 },
    });

    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, 'hs-1'));
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.eventType).toBe('score.committed');
    expect(row.entityType).toBe('hole_score');
    expect(row.actorPlayerId).toBe('p-actor');
    expect(row.tenantId).toBe(TENANT);
    expect(row.contextId).toBe('audit:hole_score');
    expect(JSON.parse(row.payloadJson)).toEqual({
      roundId: 'r-1',
      holeNumber: 5,
      grossStrokes: 4,
    });
    // Constants are exported and used.
    expect(AUDIT_EVENT_TYPES.SCORE_COMMITTED).toBe('score.committed');
    expect(AUDIT_ENTITY_TYPES.HOLE_SCORE).toBe('hole_score');
  });
});
