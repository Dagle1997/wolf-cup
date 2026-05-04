/**
 * T6-7 manual press routes integration tests.
 *
 * Cases per epic AC-line 1985:
 *   (a) happy-path file — fromHole derived correctly from partial scores.
 *   (b) file with all 4 scores on hole 1 already → fromHole=2.
 *   (c) round fully scored → 422 round_fully_scored (no_holes_left_to_press).
 *   (d) happy-path undo before hole-complete.
 *   (e) undo after hole-complete → 422 press_hole_complete.
 *   (f) duplicate file (race) → 422 press_already_filed_this_hole.
 *   (g) non-scorer POST → 403.
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
  events,
  eventRounds,
  pairings,
  pairingMembers,
  rounds,
  roundStates,
  scorerAssignments,
  holeScores,
  ruleSets,
  ruleSetRevisions,
  teamPressLog,
} = await import('../db/schema/index.js');
const { pressesRouter } = await import('./presses.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(teamPressLog);
  await db.delete(holeScores);
  await db.delete(scorerAssignments);
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(ruleSetRevisions);
  await db.delete(ruleSets);
  await db.delete(roundStates);
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
  /** All 4 foursome members including scorer. */
  playerIds: [string, string, string, string];
  outsiderId: string;
  eventId: string;
  roundId: string;
}

async function seed(): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    p1: randomUUID(),
    p2: randomUUID(),
    p3: randomUUID(),
    p4: randomUUID(),
    outsiderId: randomUUID(),
    eventId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    eventRoundId: randomUUID(),
    pairingId: randomUUID(),
    roundId: randomUUID(),
    ruleSetId: randomUUID(),
    revisionId: randomUUID(),
  };
  const sortedPlayers: [string, string, string, string] = [ids.p1, ids.p2, ids.p3, ids.p4].sort() as [string, string, string, string];
  const ctx = `event:${ids.eventId}`;

  for (const [id, name] of [
    [ids.organizerId, 'Organizer'],
    [ids.p1, 'P1'],
    [ids.p2, 'P2'],
    [ids.p3, 'P3'],
    [ids.p4, 'P4'],
    [ids.outsiderId, 'Outsider'],
  ] as Array<[string, string]>) {
    await db.insert(players).values({
      id, isOrganizer: false, createdAt: now, name,
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
  await db.insert(roundStates).values({
    roundId: ids.roundId, state: 'in_progress', enteredAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(pairings).values({
    id: ids.pairingId, eventRoundId: ids.eventRoundId, foursomeNumber: 1,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  for (let i = 0; i < 4; i++) {
    await db.insert(pairingMembers).values({
      pairingId: ids.pairingId, playerId: sortedPlayers[i]!, slotNumber: i + 1,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }
  await db.insert(scorerAssignments).values({
    roundId: ids.roundId, foursomeNumber: 1, scorerPlayerId: sortedPlayers[0]!,
    assignedAt: now, assignedByPlayerId: ids.organizerId,
    tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(ruleSets).values({
    id: ids.ruleSetId, name: 'Test', createdAt: now,
    tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
  });
  await db.insert(ruleSetRevisions).values({
    id: ids.revisionId, ruleSetId: ids.ruleSetId, revisionNumber: 1,
    configJson: JSON.stringify({ pressMultiplier: 2, autoPressTriggerAtNDown: 2 }),
    effectiveFromRoundId: null, effectiveFromHole: 1,
    createdByPlayerId: ids.organizerId, reason: null, createdAt: now,
    tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
  });

  return {
    organizerId: ids.organizerId,
    scorerId: sortedPlayers[0]!,
    playerIds: sortedPlayers,
    outsiderId: ids.outsiderId,
    eventId: ids.eventId,
    roundId: ids.roundId,
  };
}

async function commitHole(roundId: string, playerId: string, holeNumber: number, ctx: string): Promise<void> {
  await db.insert(holeScores).values({
    id: randomUUID(),
    roundId, playerId, holeNumber,
    grossStrokes: 4, putts: 2,
    scorerPlayerId: playerId,
    clientEventId: `evt-${randomUUID()}`,
    createdAt: Date.now(), updatedAt: Date.now(),
    tenantId: TENANT_ID, contextId: ctx,
  });
}

function buildApp(playerId: string): Hono {
  __testPlayer = { id: playerId, isOrganizer: false };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/rounds', pressesRouter);
  return app;
}

async function postPress(app: Hono, roundId: string, body: unknown): Promise<Response> {
  return await app.request(`/api/rounds/${roundId}/presses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function deletePress(app: Hono, roundId: string, pressId: string): Promise<Response> {
  return await app.request(`/api/rounds/${roundId}/presses/${pressId}`, { method: 'DELETE' });
}

describe('POST /api/rounds/:roundId/presses', () => {
  test('(a) happy-path file with no holes scored → fromHole=1', async () => {
    const s = await seed();
    const app = buildApp(s.scorerId);
    const res = await postPress(app, s.roundId, { team: 'teamA' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fromHole: number; pressId: string };
    expect(body.fromHole).toBe(1);
    expect(body.pressId).toBeDefined();

    const presses = await db.select().from(teamPressLog).where(eq(teamPressLog.roundId, s.roundId));
    expect(presses.length).toBe(1);
    expect(presses[0]!.team).toBe('teamA');
    expect(presses[0]!.startHole).toBe(1);
    expect(presses[0]!.triggerType).toBe('manual');
    expect(presses[0]!.firedByPlayerId).toBe(s.scorerId);
  });

  test('(b) file with all 4 scores on hole 1 → fromHole=2', async () => {
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    for (const pid of s.playerIds) {
      await commitHole(s.roundId, pid, 1, ctx);
    }
    const app = buildApp(s.scorerId);
    const res = await postPress(app, s.roundId, { team: 'teamB' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fromHole: number };
    expect(body.fromHole).toBe(2);
  });

  test('(c) round fully scored (all 18 holes complete) → 422 no_holes_left_to_press', async () => {
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    for (let h = 1; h <= 18; h++) {
      for (const pid of s.playerIds) {
        await commitHole(s.roundId, pid, h, ctx);
      }
    }
    const app = buildApp(s.scorerId);
    const res = await postPress(app, s.roundId, { team: 'teamA' });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('no_holes_left_to_press');
  });

  test('(f) duplicate manual press for same team+hole → 422 press_already_filed_this_hole', async () => {
    const s = await seed();
    const app = buildApp(s.scorerId);
    const res1 = await postPress(app, s.roundId, { team: 'teamA' });
    expect(res1.status).toBe(200);
    const res2 = await postPress(app, s.roundId, { team: 'teamA' });
    expect(res2.status).toBe(422);
    expect(((await res2.json()) as { code: string }).code).toBe('press_already_filed_this_hole');
  });

  test('(g) non-scorer POST → 403 not_scorer_for_round', async () => {
    const s = await seed();
    const app = buildApp(s.outsiderId);
    const res = await postPress(app, s.roundId, { team: 'teamA' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_scorer_for_round');
  });

  test('(h) round_state finalized → 422 round_not_writable', async () => {
    const s = await seed();
    await db
      .update(roundStates)
      .set({ state: 'finalized' })
      .where(eq(roundStates.roundId, s.roundId));
    const app = buildApp(s.scorerId);
    const res = await postPress(app, s.roundId, { team: 'teamA' });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('round_not_writable');
  });
});

describe('DELETE /api/rounds/:roundId/presses/:pressId', () => {
  test('(d) happy-path undo before hole-complete', async () => {
    const s = await seed();
    const app = buildApp(s.scorerId);
    const filed = await postPress(app, s.roundId, { team: 'teamA' });
    expect(filed.status).toBe(200);
    const { pressId } = (await filed.json()) as { pressId: string };

    // No scores yet on hole 1; undo should succeed.
    const undoRes = await deletePress(app, s.roundId, pressId);
    expect(undoRes.status).toBe(200);
    const presses = await db.select().from(teamPressLog).where(eq(teamPressLog.roundId, s.roundId));
    expect(presses.length).toBe(0);
  });

  test('(e) undo after hole-complete on the pressed hole → 422 press_hole_complete', async () => {
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    const app = buildApp(s.scorerId);
    // File press at fromHole=1.
    const filed = await postPress(app, s.roundId, { team: 'teamA' });
    const { pressId } = (await filed.json()) as { pressId: string };
    // Now complete hole 1 (all 4 score).
    for (const pid of s.playerIds) {
      await commitHole(s.roundId, pid, 1, ctx);
    }
    // Undo should fail.
    const undoRes = await deletePress(app, s.roundId, pressId);
    expect(undoRes.status).toBe(422);
    expect(((await undoRes.json()) as { code: string }).code).toBe('press_hole_complete');
    // Press still exists.
    const presses = await db.select().from(teamPressLog).where(eq(teamPressLog.roundId, s.roundId));
    expect(presses.length).toBe(1);
  });

  test('(i) cannot undo auto-press → 422 cannot_undo_auto_press', async () => {
    const s = await seed();
    // Insert an auto press directly.
    const autoId = randomUUID();
    await db.insert(teamPressLog).values({
      id: autoId,
      roundId: s.roundId,
      team: 'teamA',
      startHole: 5,
      triggerType: 'auto',
      trigger: '2-down',
      multiplier: 2,
      firedAt: Date.now(),
      firedByPlayerId: null,
      tenantId: TENANT_ID,
      contextId: `event:${s.eventId}`,
    });
    const app = buildApp(s.scorerId);
    const undoRes = await deletePress(app, s.roundId, autoId);
    expect(undoRes.status).toBe(422);
    expect(((await undoRes.json()) as { code: string }).code).toBe('cannot_undo_auto_press');
  });

  test('(j) press not found → 404', async () => {
    const s = await seed();
    const app = buildApp(s.scorerId);
    const res = await deletePress(app, s.roundId, randomUUID());
    expect(res.status).toBe(404);
  });
});
