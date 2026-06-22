/**
 * claim-write.test.ts (Story 2.1) — the APPEND-ONLY append + current-state
 * derivation service. Front-loads the fail-closed/edge guards (Epic 1 retro):
 *   - client_event_id dedupe no-op (same id retry)
 *   - append set then remove ⇒ current claim absent
 *   - STALE-REPLAY-NO-RESURRECT (the core CRITICAL guard): set A, remove B,
 *     replay A ⇒ claim stays REMOVED
 *   - reassign = remove old cell + set new cell
 *   - latest-set-write-per-cell derivation
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

const { db } = await import('../db/index.js');
const { holeClaimWrites, rounds, players } = await import('../db/schema/index.js');
const { appendClaimWrite, deriveCurrentClaims } = await import('./claim-write.js');

const TENANT = 'guyan';
const CTX = 'event:test';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

let playerA: string;
let playerB: string;
let scorerId: string;
let roundId: string;

beforeEach(async () => {
  await db.delete(holeClaimWrites);
  await db.delete(rounds);
  await db.delete(players);
  const now = Date.now();
  playerA = randomUUID();
  playerB = randomUUID();
  scorerId = randomUUID();
  roundId = randomUUID();
  await db.insert(players).values([
    { id: playerA, isOrganizer: false, createdAt: now, name: 'A', tenantId: TENANT, contextId: CTX },
    { id: playerB, isOrganizer: false, createdAt: now, name: 'B', tenantId: TENANT, contextId: CTX },
    { id: scorerId, isOrganizer: false, createdAt: now, name: 'S', tenantId: TENANT, contextId: CTX },
  ]);
  await db.insert(rounds).values({
    id: roundId, eventId: null, eventRoundId: null, holesToPlay: 18, createdAt: now, tenantId: TENANT, contextId: CTX,
  });
});

async function append(args: {
  playerId: string;
  holeNumber: number;
  claimType: 'greenie' | 'polie' | 'sandie';
  op: 'set' | 'remove';
  clientEventId: string;
}) {
  return db.transaction(async (tx) =>
    appendClaimWrite(tx, {
      id: randomUUID(),
      roundId,
      playerId: args.playerId,
      holeNumber: args.holeNumber,
      claimType: args.claimType,
      op: args.op,
      scorerPlayerId: scorerId,
      clientEventId: args.clientEventId,
      tenantId: TENANT,
      contextId: CTX,
      now: Date.now(),
    }),
  );
}

async function current() {
  return deriveCurrentClaims(db, { roundId, tenantId: TENANT });
}

describe('appendClaimWrite — idempotency', () => {
  test('same client_event_id retry is a no-op (deduped)', async () => {
    const cid = 'evt-dedupe-1';
    const first = await append({ playerId: playerA, holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: cid });
    expect(first.inserted).toBe(true);
    const second = await append({ playerId: playerA, holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: cid });
    expect(second.inserted).toBe(false);

    const rows = await db.select().from(holeClaimWrites);
    expect(rows.length).toBe(1);
  });

  test('server-assigned seq is monotonic across appends', async () => {
    const r1 = await append({ playerId: playerA, holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: randomUUID() });
    const r2 = await append({ playerId: playerA, holeNumber: 7, claimType: 'greenie', op: 'remove', clientEventId: randomUUID() });
    expect(r1.seq).toBeDefined();
    expect(r2.seq).toBeDefined();
    expect(r2.seq!).toBeGreaterThan(r1.seq!);
  });
});

describe('deriveCurrentClaims — latest-write-per-cell', () => {
  test('a lone set is active', async () => {
    await append({ playerId: playerA, holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: randomUUID() });
    const cur = await current();
    expect(cur).toEqual([{ playerId: playerA, holeNumber: 7, claimType: 'greenie' }]);
  });

  test('append set then remove ⇒ current claim is absent', async () => {
    await append({ playerId: playerA, holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: randomUUID() });
    await append({ playerId: playerA, holeNumber: 7, claimType: 'greenie', op: 'remove', clientEventId: randomUUID() });
    const cur = await current();
    expect(cur).toEqual([]);
  });

  test('set, remove, set ⇒ active again (latest set wins)', async () => {
    await append({ playerId: playerA, holeNumber: 7, claimType: 'polie', op: 'set', clientEventId: randomUUID() });
    await append({ playerId: playerA, holeNumber: 7, claimType: 'polie', op: 'remove', clientEventId: randomUUID() });
    await append({ playerId: playerA, holeNumber: 7, claimType: 'polie', op: 'set', clientEventId: randomUUID() });
    const cur = await current();
    expect(cur).toEqual([{ playerId: playerA, holeNumber: 7, claimType: 'polie' }]);
  });

  test('distinct cells coexist; restrictToPlayerIds scopes the read', async () => {
    await append({ playerId: playerA, holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: randomUUID() });
    await append({ playerId: playerB, holeNumber: 7, claimType: 'sandie', op: 'set', clientEventId: randomUUID() });
    const all = await current();
    expect(all.length).toBe(2);
    const onlyA = await deriveCurrentClaims(db, { roundId, tenantId: TENANT, restrictToPlayerIds: [playerA] });
    expect(onlyA).toEqual([{ playerId: playerA, holeNumber: 7, claimType: 'greenie' }]);
    const none = await deriveCurrentClaims(db, { roundId, tenantId: TENANT, restrictToPlayerIds: [] });
    expect(none).toEqual([]);
  });
});

describe('STALE-REPLAY-NO-RESURRECT (the CRITICAL guard)', () => {
  test('set A, remove B, then REPLAY A ⇒ claim stays REMOVED', async () => {
    const cidA = 'evt-A-set';
    const cidB = 'evt-B-remove';

    // (1) record set A
    const a = await append({ playerId: playerA, holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: cidA });
    expect(a.inserted).toBe(true);
    // (2) remove B (a later write)
    const b = await append({ playerId: playerA, holeNumber: 7, claimType: 'greenie', op: 'remove', clientEventId: cidB });
    expect(b.inserted).toBe(true);
    expect(await current()).toEqual([]); // removed

    // (3) a stale offline queue REPLAYS the original set A (same client_event_id).
    // ON CONFLICT(client_event_id) DO NOTHING ⇒ no-op; it does NOT append a new
    // higher-seq set, so the remove (B) is still the latest write per cell.
    const replay = await append({ playerId: playerA, holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: cidA });
    expect(replay.inserted).toBe(false); // deduped — NOT resurrected

    // THE assertion: the claim is STILL absent. Resurrection is impossible.
    expect(await current()).toEqual([]);

    // And only the two original distinct writes exist (no third row from replay).
    const rows = await db.select().from(holeClaimWrites);
    expect(rows.length).toBe(2);
  });
});

describe('reassign = remove old cell + set new cell', () => {
  test('moving a greenie from A to B leaves only B active', async () => {
    await append({ playerId: playerA, holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: randomUUID() });
    // reassign: remove A's cell, set B's cell
    await append({ playerId: playerA, holeNumber: 7, claimType: 'greenie', op: 'remove', clientEventId: randomUUID() });
    await append({ playerId: playerB, holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: randomUUID() });
    const cur = await current();
    expect(cur).toEqual([{ playerId: playerB, holeNumber: 7, claimType: 'greenie' }]);
  });
});
