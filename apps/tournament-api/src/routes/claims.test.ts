/**
 * claims.test.ts (Story 2.1) — route-level contract for POST
 * /api/rounds/:roundId/claims (append-only inline claim capture).
 *
 * Covers: 201 set + audit + activity; offline idempotency (same client_event_id
 * replay ⇒ 200 deduped, no extra row); set then remove ⇒ current claim absent;
 * STALE-REPLAY-NO-RESURRECT end-to-end through the route; finalized-round refusal
 * (the interim finalized-check, AC13); single-writer gate (non-scorer 403);
 * player-not-in-foursome 404.
 *
 * Plus an inert-vs-fail-closed assertion driven through the EXISTING engine
 * (AC14): a recorded claim with a modifier enabled:false ⇒ 0 edges (inert); an
 * unknown modifier type ⇒ validateResolvedConfig fails closed (unsettleable).
 * No 2.2-2.4 resolver needed.
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

let __testPlayer: { id: string; isOrganizer: boolean } | null = null;
vi.mock('../middleware/require-session.js', () => ({
  requireSession: async (c: import('hono').Context, next: () => Promise<void>) => {
    if (!__testPlayer) return c.json({ error: 'unauthorized', code: 'no_test_player' }, 401);
    c.set('player', __testPlayer);
    c.set('session', { sessionId: 'test-session', playerId: __testPlayer.id });
    await next();
  },
}));

const { db } = await import('../db/index.js');
const {
  players, courses, courseRevisions, events, eventRounds, pairings, pairingMembers,
  rounds, roundStates, scorerAssignments, holeClaimWrites, auditLog, activity,
} = await import('../db/schema/index.js');
const { claimsRouter } = await import('./claims.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  // eslint-disable-next-line no-restricted-syntax -- test teardown truncate only
  await db.delete(activity);
  await db.delete(auditLog);
  await db.delete(holeClaimWrites);
  await db.delete(roundStates);
  await db.delete(scorerAssignments);
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface SeedResult {
  organizerId: string;
  scorerId: string;
  player1Id: string;
  player2Id: string;
  eventId: string;
  roundId: string;
  ctx: string;
}

async function seedRound(opts: {
  state?: 'not_started' | 'in_progress' | 'complete_editable' | 'finalized' | 'cancelled';
}): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(), scorerId: randomUUID(), player1Id: randomUUID(), player2Id: randomUUID(),
    eventId: randomUUID(), eventRoundId: randomUUID(), roundId: randomUUID(),
    courseId: randomUUID(), courseRevId: randomUUID(), pairingId: randomUUID(),
  };
  const ctx = `event:${ids.eventId}`;
  for (const [id, isOrg, name] of [
    [ids.organizerId, true, 'Organizer'],
    [ids.scorerId, false, 'Scorer'],
    [ids.player1Id, false, 'Player One'],
    [ids.player2Id, false, 'Player Two'],
  ] as const) {
    await db.insert(players).values({ id, isOrganizer: isOrg, createdAt: now, name, tenantId: TENANT_ID, contextId: ctx });
  }
  await db.insert(courses).values({ id: ids.courseId, name: 'C', clubName: 'Club', createdAt: now, tenantId: TENANT_ID, contextId: ctx });
  await db.insert(courseRevisions).values({
    id: ids.courseRevId, courseId: ids.courseId, revisionNumber: 1, outTotal: 36, inTotal: 36, courseTotal: 72,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(events).values({
    id: ids.eventId, name: 'E', startDate: now, endDate: now + 1, timezone: 'America/New_York',
    organizerPlayerId: ids.organizerId, createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.eventRoundId, eventId: ids.eventId, roundNumber: 1, roundDate: now, courseRevisionId: ids.courseRevId,
    teeColor: 'blue', holesToPlay: 18, createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(rounds).values({
    id: ids.roundId, eventId: ids.eventId, eventRoundId: ids.eventRoundId, holesToPlay: 18,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(roundStates).values({
    roundId: ids.roundId, state: opts.state ?? 'in_progress', enteredAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(pairings).values({
    id: ids.pairingId, eventRoundId: ids.eventRoundId, foursomeNumber: 1, createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(pairingMembers).values([
    { pairingId: ids.pairingId, playerId: ids.player1Id, slotNumber: 1, tenantId: TENANT_ID, contextId: ctx },
    { pairingId: ids.pairingId, playerId: ids.player2Id, slotNumber: 2, tenantId: TENANT_ID, contextId: ctx },
  ]);
  await db.insert(scorerAssignments).values({
    roundId: ids.roundId, foursomeNumber: 1, scorerPlayerId: ids.scorerId, assignedAt: now,
    assignedByPlayerId: ids.organizerId, tenantId: TENANT_ID, contextId: ctx,
  });
  return {
    organizerId: ids.organizerId, scorerId: ids.scorerId, player1Id: ids.player1Id, player2Id: ids.player2Id,
    eventId: ids.eventId, roundId: ids.roundId, ctx,
  };
}

function buildApp(asPlayerId: string): Hono {
  __testPlayer = { id: asPlayerId, isOrganizer: false };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/rounds', claimsRouter);
  return app;
}

async function postClaim(app: Hono, roundId: string, body: unknown): Promise<Response> {
  return app.request(`/api/rounds/${roundId}/claims`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/rounds/:roundId/claims', () => {
  test('201 set: row appended, audit + activity written', async () => {
    const seed = await seedRound({ state: 'in_progress' });
    const app = buildApp(seed.scorerId);
    const res = await postClaim(app, seed.roundId, {
      playerId: seed.player1Id, holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: 'evt-1',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { deduped: boolean; claimWriteId: string };
    expect(body.deduped).toBe(false);

    const rows = await db.select().from(holeClaimWrites).where(eq(holeClaimWrites.roundId, seed.roundId));
    expect(rows.length).toBe(1);
    expect(rows[0]!.op).toBe('set');

    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, body.claimWriteId));
    expect(audits.length).toBe(1);
    expect(audits[0]!.eventType).toBe('game.claim_recorded');

    const acts = await db.select().from(activity).where(eq(activity.roundId, seed.roundId));
    expect(acts.length).toBe(1);
    expect(acts[0]!.type).toBe('game.claim_recorded');
  });

  test('200 deduped: same clientEventId replay ⇒ no extra row, no extra audit', async () => {
    const seed = await seedRound({ state: 'in_progress' });
    const app = buildApp(seed.scorerId);
    const first = await postClaim(app, seed.roundId, {
      playerId: seed.player1Id, holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: 'evt-dup',
    });
    expect(first.status).toBe(201);
    const second = await postClaim(app, seed.roundId, {
      playerId: seed.player1Id, holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: 'evt-dup',
    });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { deduped: boolean }).deduped).toBe(true);

    const rows = await db.select().from(holeClaimWrites).where(eq(holeClaimWrites.roundId, seed.roundId));
    expect(rows.length).toBe(1);
    const audits = await db.select().from(auditLog);
    expect(audits.length).toBe(1);
  });

  test('set then remove ⇒ both rows appended (no hard delete)', async () => {
    const seed = await seedRound({ state: 'in_progress' });
    const app = buildApp(seed.scorerId);
    await postClaim(app, seed.roundId, { playerId: seed.player1Id, holeNumber: 7, claimType: 'polie', op: 'set', clientEventId: 'evt-s' });
    const rm = await postClaim(app, seed.roundId, { playerId: seed.player1Id, holeNumber: 7, claimType: 'polie', op: 'remove', clientEventId: 'evt-r' });
    expect(rm.status).toBe(201);
    const rows = await db.select().from(holeClaimWrites).where(eq(holeClaimWrites.roundId, seed.roundId));
    expect(rows.length).toBe(2); // append-only: remove did NOT delete the set row
  });

  test('400 hole_out_of_play: a 9-hole round rejects a claim on hole 10-18 (control: hole 9 ok)', async () => {
    const seed = await seedRound({ state: 'in_progress' });
    // Make this a 9-hole round (the gate reads event_rounds.holes_to_play).
    await db.update(eventRounds).set({ holesToPlay: 9 }).where(eq(eventRounds.eventId, seed.eventId));
    const app = buildApp(seed.scorerId);

    const outOfPlay = await postClaim(app, seed.roundId, {
      playerId: seed.player1Id, holeNumber: 14, claimType: 'greenie', op: 'set', clientEventId: 'evt-oop',
    });
    expect(outOfPlay.status).toBe(400);
    expect(((await outOfPlay.json()) as { code: string }).code).toBe('hole_out_of_play');
    // Nothing was appended.
    const rows = await db.select().from(holeClaimWrites).where(eq(holeClaimWrites.roundId, seed.roundId));
    expect(rows.length).toBe(0);

    // Control: hole 9 (in play) is accepted.
    const inPlay = await postClaim(app, seed.roundId, {
      playerId: seed.player1Id, holeNumber: 9, claimType: 'greenie', op: 'set', clientEventId: 'evt-ip',
    });
    expect(inPlay.status).toBe(201);
  });

  test('STALE-REPLAY-NO-RESURRECT through the route: set, remove, replay set ⇒ stays removed', async () => {
    const seed = await seedRound({ state: 'in_progress' });
    const app = buildApp(seed.scorerId);
    await postClaim(app, seed.roundId, { playerId: seed.player1Id, holeNumber: 7, claimType: 'sandie', op: 'set', clientEventId: 'A' });
    await postClaim(app, seed.roundId, { playerId: seed.player1Id, holeNumber: 7, claimType: 'sandie', op: 'remove', clientEventId: 'B' });
    const replay = await postClaim(app, seed.roundId, { playerId: seed.player1Id, holeNumber: 7, claimType: 'sandie', op: 'set', clientEventId: 'A' });
    expect(replay.status).toBe(200); // deduped, NOT resurrected
    expect(((await replay.json()) as { deduped: boolean }).deduped).toBe(true);

    const { deriveCurrentClaims } = await import('../services/claim-write.js');
    const cur = await deriveCurrentClaims(db, { roundId: seed.roundId, tenantId: TENANT_ID });
    expect(cur).toEqual([]); // STILL removed

    const rows = await db.select().from(holeClaimWrites).where(eq(holeClaimWrites.roundId, seed.roundId));
    expect(rows.length).toBe(2); // replay appended nothing
  });

  test('finalized round ⇒ refused (interim finalized-check, AC13)', async () => {
    const seed = await seedRound({ state: 'finalized' });
    const app = buildApp(seed.scorerId);
    const res = await postClaim(app, seed.roundId, {
      playerId: seed.player1Id, holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: 'evt-fin',
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('round_not_writable');
    const rows = await db.select().from(holeClaimWrites).where(eq(holeClaimWrites.roundId, seed.roundId));
    expect(rows.length).toBe(0); // refused — nothing written
  });

  test('non-scorer ⇒ 403 (single-writer gate)', async () => {
    const seed = await seedRound({ state: 'in_progress' });
    const app = buildApp(seed.player1Id); // a player, NOT the designated scorer
    const res = await postClaim(app, seed.roundId, {
      playerId: seed.player1Id, holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: 'evt-403',
    });
    expect(res.status).toBe(403);
  });

  test('player not in any foursome ⇒ 404 (cross-foursome guard)', async () => {
    const seed = await seedRound({ state: 'in_progress' });
    const app = buildApp(seed.scorerId);
    const res = await postClaim(app, seed.roundId, {
      playerId: randomUUID(), holeNumber: 7, claimType: 'greenie', op: 'set', clientEventId: 'evt-404',
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('player_not_in_any_foursome');
  });

  test('invalid claimType ⇒ 400 (Zod-validated, not DB CHECK)', async () => {
    const seed = await seedRound({ state: 'in_progress' });
    const app = buildApp(seed.scorerId);
    const res = await postClaim(app, seed.roundId, {
      playerId: seed.player1Id, holeNumber: 7, claimType: 'eagle', op: 'set', clientEventId: 'evt-bad',
    });
    expect(res.status).toBe(400);
  });
});

describe('AC14 — inert-vs-fail-closed via the EXISTING engine (no 2.2-2.4 resolver)', () => {
  test('a recorded claim with a disabled modifier ⇒ 0 edges (inert)', async () => {
    const { computeFoursome } = await import('../engine/games/compute-foursome.js');
    const { ledgerToEdges } = await import('../engine/games/ledger-to-edges.js');
    const teamSplit = { teamA: ['a1', 'a2'] as [string, string], teamB: ['b1', 'b2'] as [string, string] };
    const config = {
      game: 'guyan-2v2',
      pointValueSchedule: { kind: 'flat' as const, cents: 200 },
      // The (future) claim-consuming modifier is DISABLED → inert (0 edges),
      // even though the hole carries claims. Tied nets ⇒ no base-game money either.
      modifiers: [{ type: 'net-skins', enabled: false }],
      configVersion: 1,
    };
    const ledger = computeFoursome(config, {
      teamSplit,
      holes: [
        {
          holeNumber: 1,
          par: 4,
          net: { a1: 4, a2: 4, b1: 4, b2: 4 },
          // claims present but inert (no resolver consumes them in 2.1).
          claims: { a1: { greenie: true } },
        },
      ],
    });
    const edges = ledgerToEdges(ledger, teamSplit, { sourceId: 'r:1' });
    expect(edges).toEqual([]); // inert — recorded claim has zero money effect
  });

  test('an unknown modifier type ⇒ fails closed (unsettleable)', async () => {
    const { computeFoursome } = await import('../engine/games/compute-foursome.js');
    const teamSplit = { teamA: ['a1', 'a2'] as [string, string], teamB: ['b1', 'b2'] as [string, string] };
    const config = {
      game: 'guyan-2v2',
      pointValueSchedule: { kind: 'flat' as const, cents: 200 },
      modifiers: [{ type: 'totally-unknown-modifier', enabled: true }],
      configVersion: 1,
    };
    expect(() =>
      computeFoursome(config, {
        teamSplit,
        holes: [{ holeNumber: 1, par: 4, net: { a1: 3, a2: 5, b1: 5, b2: 5 }, claims: { a1: { greenie: true } } }],
      }),
    ).toThrow(/unsettleable config/);
  });
});
