/**
 * hole-claim-writes.test.ts (Story 2.1) — schema-level contract for the
 * APPEND-ONLY hole_claim_writes log.
 *
 * Asserts: the dedupe UNIQUE is on client_event_id ONLY (global) — a replay of
 * ANY write (set or remove) collides; there is NO cell-unique (a cell may carry
 * many writes over time, set/remove/set…); FKs to rounds/players hold; the
 * table is reachable via the schema index.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
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
const { holeClaimWrites, rounds, players } = await import('./index.js');

const TENANT = 'guyan';
const CTX = 'event:test';

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const c = cause as { extendedCode?: unknown; rawCode?: unknown };
    if (c.extendedCode === 'SQLITE_CONSTRAINT_UNIQUE' || c.rawCode === 2067) return true;
  }
  return false;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

let playerId: string;
let scorerId: string;
let roundId: string;

beforeEach(async () => {
  await db.delete(holeClaimWrites);
  await db.delete(rounds);
  await db.delete(players);

  const now = Date.now();
  playerId = randomUUID();
  scorerId = randomUUID();
  roundId = randomUUID();
  await db.insert(players).values([
    { id: playerId, isOrganizer: false, createdAt: now, name: 'P', tenantId: TENANT, contextId: CTX },
    { id: scorerId, isOrganizer: false, createdAt: now, name: 'S', tenantId: TENANT, contextId: CTX },
  ]);
  await db.insert(rounds).values({
    id: roundId, eventId: null, eventRoundId: null, holesToPlay: 18, createdAt: now, tenantId: TENANT, contextId: CTX,
  });
});

function row(overrides: Partial<typeof holeClaimWrites.$inferInsert> = {}) {
  const now = Date.now();
  return {
    id: randomUUID(),
    seq: 1,
    roundId,
    playerId,
    holeNumber: 7,
    claimType: 'greenie',
    op: 'set',
    scorerPlayerId: scorerId,
    clientEventId: randomUUID(),
    createdAt: now,
    tenantId: TENANT,
    contextId: CTX,
    ...overrides,
  };
}

describe('hole_claim_writes schema (append-only)', () => {
  test('inserts a set write', async () => {
    await db.insert(holeClaimWrites).values(row({ seq: 1 }));
    const rows = await db.select().from(holeClaimWrites).where(eq(holeClaimWrites.roundId, roundId));
    expect(rows.length).toBe(1);
    expect(rows[0]!.op).toBe('set');
    expect(rows[0]!.claimType).toBe('greenie');
  });

  test('duplicate client_event_id collides on the GLOBAL dedupe UNIQUE', async () => {
    const cid = randomUUID();
    await db.insert(holeClaimWrites).values(row({ seq: 1, clientEventId: cid }));
    let threw = false;
    try {
      // Even a DIFFERENT cell + op with the SAME client_event_id must collide.
      await db.insert(holeClaimWrites).values(
        row({ seq: 2, clientEventId: cid, holeNumber: 12, op: 'remove' }),
      );
    } catch (err) {
      threw = isUniqueConstraintError(err);
    }
    expect(threw).toBe(true);
  });

  test('NO cell-unique: the same cell may carry many writes (set, remove, set)', async () => {
    // This is the whole point of append-only — distinct client_event_ids at the
    // same (round,player,hole,claim_type) cell must ALL insert, never collide.
    await db.insert(holeClaimWrites).values(row({ seq: 1, op: 'set', clientEventId: randomUUID() }));
    await db.insert(holeClaimWrites).values(row({ seq: 2, op: 'remove', clientEventId: randomUUID() }));
    await db.insert(holeClaimWrites).values(row({ seq: 3, op: 'set', clientEventId: randomUUID() }));
    const rows = await db
      .select()
      .from(holeClaimWrites)
      .where(
        and(
          eq(holeClaimWrites.roundId, roundId),
          eq(holeClaimWrites.playerId, playerId),
          eq(holeClaimWrites.holeNumber, 7),
          eq(holeClaimWrites.claimType, 'greenie'),
        ),
      );
    expect(rows.length).toBe(3);
  });

  test('FK to rounds enforced (cascade target exists)', async () => {
    let threw = false;
    try {
      await db.insert(holeClaimWrites).values(row({ roundId: randomUUID() }));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
