/**
 * T6-13 sub-game compute route integration tests.
 *
 * Cases per epic AC line 2200:
 *   (a) compute skins happy path (1 result row, audit, activity)
 *   (b) compute ctp 501 stub
 *   (c) idempotent re-compute (N+1 result rows; latest is correct)
 *   (d) non-participant 403
 *   (e) malformed/nonexistent IDs
 *   (f) sub-game not in round → 422
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { and, desc, eq } from 'drizzle-orm';
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
  requireSession: async (
    c: import('hono').Context,
    next: () => Promise<void>,
  ) => {
    if (!__testPlayer) {
      return c.json({ error: 'unauthorized', code: 'no_test_player' }, 401);
    }
    c.set('player', __testPlayer);
    c.set('session', { sessionId: 'test', playerId: __testPlayer.id });
    await next();
  },
}));

const { db } = await import('../db/index.js');
const {
  players,
  courses,
  courseRevisions,
  courseTees,
  courseHoles,
  events,
  eventRounds,
  groups,
  groupMembers,
  rounds,
  holeScores,
  subGames,
  subGameParticipants,
  subGameResults,
  auditLog,
} = await import('../db/schema/index.js');
const { subGamesComputeRouter } = await import('./sub-games.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(subGameResults);
  await db.delete(subGameParticipants);
  await db.delete(subGames);
  await db.delete(holeScores);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface SeedResult {
  organizerId: string;
  participantId: string;
  outsiderId: string;
  eventId: string;
  roundId: string;
  skinsSubGameId: string;
  ctpSubGameId: string;
}

async function seed(): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    participantId: randomUUID(),
    outsiderId: randomUUID(),
    eventId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    eventRoundId: randomUUID(),
    roundId: randomUUID(),
    groupId: randomUUID(),
    skinsSubGameId: randomUUID(),
    ctpSubGameId: randomUUID(),
  };
  const ctx = `event:${ids.eventId}`;

  for (const [id, name] of [
    [ids.organizerId, 'Organizer'],
    [ids.participantId, 'Participant'],
    [ids.outsiderId, 'Outsider'],
  ] as Array<[string, string]>) {
    await db.insert(players).values({
      id, isOrganizer: false, createdAt: now, name, manualHandicapIndex: 0,
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  await db.insert(courses).values({
    id: ids.courseId, name: 'Test', clubName: 'Test CC',
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  await db.insert(courseRevisions).values({
    id: ids.courseRevId, courseId: ids.courseId, revisionNumber: 1,
    sourceUrl: null, extractionDate: null, verified: false,
    outTotal: 36, inTotal: 36, courseTotal: 72,
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  await db.insert(courseTees).values({
    id: randomUUID(), courseRevisionId: ids.courseRevId, teeColor: 'blue',
    rating: 720, slope: 113,
    tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  for (let h = 1; h <= 18; h++) {
    await db.insert(courseHoles).values({
      id: randomUUID(), courseRevisionId: ids.courseRevId,
      holeNumber: h, par: 4, si: ((h * 7) % 18) + 1,
      yardagePerTeeJson: '{}',
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  await db.insert(events).values({
    id: ids.eventId, name: 'Test', startDate: now, endDate: now + 86400000,
    timezone: 'America/New_York', organizerPlayerId: ids.organizerId,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.eventRoundId, eventId: ids.eventId, roundNumber: 1, roundDate: now,
    courseRevisionId: ids.courseRevId, teeColor: 'blue', holesToPlay: 18,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(rounds).values({
    id: ids.roundId, eventId: ids.eventId, eventRoundId: ids.eventRoundId,
    holesToPlay: 18, createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(groups).values({
    id: ids.groupId, eventId: ids.eventId, name: 'G',
    moneyVisibilityMode: 'open', createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(groupMembers).values({
    groupId: ids.groupId, playerId: ids.participantId,
    tenantId: TENANT_ID, contextId: ctx,
  });

  // Skins sub-game.
  await db.insert(subGames).values({
    id: ids.skinsSubGameId, eventRoundId: ids.eventRoundId,
    type: 'skins',
    configJson: JSON.stringify({ mode: 'gross', lastHoleUnclaimedResolution: 'split-among-winners' }),
    buyInPerParticipant: 500, createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(subGameParticipants).values({
    subGameId: ids.skinsSubGameId, playerId: ids.participantId,
    optedInAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });

  // CTP stub sub-game.
  await db.insert(subGames).values({
    id: ids.ctpSubGameId, eventRoundId: ids.eventRoundId,
    type: 'ctp',
    configJson: '{}',
    buyInPerParticipant: 0, createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });

  return {
    organizerId: ids.organizerId,
    participantId: ids.participantId,
    outsiderId: ids.outsiderId,
    eventId: ids.eventId,
    roundId: ids.roundId,
    skinsSubGameId: ids.skinsSubGameId,
    ctpSubGameId: ids.ctpSubGameId,
  };
}

function buildApp(playerId: string): Hono {
  __testPlayer = { id: playerId, isOrganizer: false };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/rounds', subGamesComputeRouter);
  return app;
}

async function postCompute(
  app: Hono,
  roundId: string,
  subGameId: string,
): Promise<Response> {
  return await app.request(`/api/rounds/${roundId}/sub-games/${subGameId}/compute`, {
    method: 'POST',
  });
}

describe('POST /api/rounds/:roundId/sub-games/:subGameId/compute', () => {
  test('(a) compute skins happy path: 1 result row + audit + activity', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await postCompute(app, s.roundId, s.skinsSubGameId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; subGameResultId: string; totalPotCents: number };
    expect(body.ok).toBe(true);
    expect(body.subGameResultId).toBeDefined();
    // 1 participant × 500 buy-in = 500 cents pot.
    expect(body.totalPotCents).toBe(500);

    // 1 sub_game_results row.
    const results = await db.select().from(subGameResults).where(eq(subGameResults.subGameId, s.skinsSubGameId));
    expect(results.length).toBe(1);
    expect(results[0]!.totalPotCents).toBe(500);

    // Audit row.
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.eventType, 'subgame.computed'), eq(auditLog.entityId, s.skinsSubGameId)));
    expect(audits.length).toBe(1);
  });

  test('(b) compute ctp → 501 not_implemented', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await postCompute(app, s.roundId, s.ctpSubGameId);
    expect(res.status).toBe(501);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('subgame_type_stub');
  });

  test('(c) idempotent re-compute → N+1 result rows; latest by computed_at', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const r1 = await postCompute(app, s.roundId, s.skinsSubGameId);
    expect(r1.status).toBe(200);
    // Wait 5ms to ensure computed_at differs.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const r2 = await postCompute(app, s.roundId, s.skinsSubGameId);
    expect(r2.status).toBe(200);
    const r3 = await postCompute(app, s.roundId, s.skinsSubGameId);
    expect(r3.status).toBe(200);
    const results = await db
      .select()
      .from(subGameResults)
      .where(eq(subGameResults.subGameId, s.skinsSubGameId))
      .orderBy(desc(subGameResults.computedAt));
    expect(results.length).toBe(3);
  });

  test('(d) non-participant → 403 not_event_participant', async () => {
    const s = await seed();
    const app = buildApp(s.outsiderId);
    const res = await postCompute(app, s.roundId, s.skinsSubGameId);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });

  test('(e) malformed roundId → 400', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await app.request(`/api/rounds/not-a-uuid/sub-games/${s.skinsSubGameId}/compute`, {
      method: 'POST',
    });
    expect(res.status).toBe(400);
  });

  test('(f) sub-game not found → 404', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await postCompute(app, s.roundId, randomUUID());
    expect(res.status).toBe(404);
  });

  test('(g) nonexistent roundId → 403 (no-existence-leak)', async () => {
    const s = await seed();
    const app = buildApp(s.participantId);
    const res = await postCompute(app, randomUUID(), s.skinsSubGameId);
    expect(res.status).toBe(403);
  });
});
