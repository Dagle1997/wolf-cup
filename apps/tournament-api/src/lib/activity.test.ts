import { beforeAll, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sql } from 'drizzle-orm';

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
const activityModule = await import('./activity.js');
const { emitActivity } = activityModule;
type EmitActivityArgs = Parameters<typeof emitActivity>[1];

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

describe('emitActivity (v1 stub)', () => {
  test('is a no-op: returns Promise<void>; writes zero rows to any user-domain table', async () => {
    const tableNamesBefore = await db.all(
      sql`SELECT name FROM sqlite_master WHERE type='table'`,
    );
    // Snapshot row counts pre-call.
    const counts: Record<string, number> = {};
    for (const t of tableNamesBefore) {
      const tName = (t as { name: string }).name;
      if (tName.startsWith('__drizzle')) continue;
      const result = await db.all(
        sql.raw(`SELECT COUNT(*) AS n FROM "${tName}"`),
      );
      counts[tName] = (result[0] as { n: number }).n;
    }

    // Call the stub. Must accept the v1 score-committed shape without complaint.
    const args: EmitActivityArgs = {
      type: 'score.committed',
      actorPlayerId: 'p-actor',
      payload: { roundId: 'r-1', holeNumber: 5, grossStrokes: 4 },
      scope: { eventId: 'e-1', roundId: 'r-1' },
    };
    const result = await emitActivity(db, args);
    expect(result).toBeUndefined(); // returns Promise<void>

    // Snapshot row counts post-call. Every count must be unchanged.
    for (const tName of Object.keys(counts)) {
      const after = await db.all(
        sql.raw(`SELECT COUNT(*) AS n FROM "${tName}"`),
      );
      expect((after[0] as { n: number }).n).toBe(counts[tName]);
    }
  });
});
