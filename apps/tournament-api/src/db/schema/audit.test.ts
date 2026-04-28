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
  // File-scoped private in-memory DB (`:memory:` with no shared cache).
  // See scoring.test.ts for rationale. (Codex impl-round-1 isolation guard.)
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

const { db } = await import('../index.js');
const { players, auditLog } = await import('./index.js');

const TENANT = 'guyan';
const CTX = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(players);
});

describe('audit_log schema', () => {
  test('insert + read round-trip with all columns set, including tenant + context', async () => {
    await db.insert(players).values({
      id: 'p-audit',
      isOrganizer: true,
      createdAt: Date.now(),
      name: 'Audit Actor',
      tenantId: TENANT,
      contextId: CTX,
    });
    const now = Date.now();
    await db.insert(auditLog).values({
      id: 'al-1',
      eventType: 'round.state_changed',
      entityType: 'round',
      entityId: 'r-audit-1',
      actorPlayerId: 'p-audit',
      payloadJson: JSON.stringify({ from: 'not_started', to: 'in_progress' }),
      createdAt: now,
      tenantId: TENANT,
      contextId: CTX,
    });

    const rows = await db.select().from(auditLog).where(eq(auditLog.id, 'al-1'));
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.eventType).toBe('round.state_changed');
    expect(row.entityType).toBe('round');
    expect(row.entityId).toBe('r-audit-1');
    expect(row.actorPlayerId).toBe('p-audit');
    expect(row.tenantId).toBe(TENANT);
    expect(row.contextId).toBe(CTX);
    const parsed = JSON.parse(row.payloadJson);
    expect(parsed).toEqual({ from: 'not_started', to: 'in_progress' });
  });

  test('actor_player_id is NULLABLE — system events leave it null', async () => {
    await db.insert(auditLog).values({
      id: 'al-system',
      eventType: 'install_prompt.shown',
      entityType: 'session',
      entityId: 'sess-1',
      actorPlayerId: null,
      payloadJson: JSON.stringify({ device: 'iOS-17' }),
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: CTX,
    });
    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.id, 'al-system'));
    expect(rows.length).toBe(1);
    expect(rows[0]?.actorPlayerId).toBeNull();
  });
});
