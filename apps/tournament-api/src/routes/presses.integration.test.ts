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
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

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

describe('TOURNAMENT_PRESSES_DISABLED kill switch', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('POST returns 422 presses_disabled and writes no team_press_log row', async () => {
    vi.stubEnv('TOURNAMENT_PRESSES_DISABLED', 'true');
    const s = await seed();
    const app = buildApp(s.scorerId);
    const res = await postPress(app, s.roundId, { team: 'teamA' });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('presses_disabled');

    const rows = await db
      .select()
      .from(teamPressLog)
      .where(eq(teamPressLog.roundId, s.roundId));
    expect(rows.length).toBe(0);
  });

  test('DELETE returns 422 presses_disabled (kill-switch beats round_id format check)', async () => {
    vi.stubEnv('TOURNAMENT_PRESSES_DISABLED', 'true');
    const s = await seed();
    const app = buildApp(s.scorerId);
    const res = await deletePress(app, s.roundId, randomUUID());
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('presses_disabled');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// T10-1 multi-foursome manual-press tests
//
// Pre-T10-1 the manual-press POST handler INSERTed into team_press_log with
// no foursomeNumber column at all, and the UNIQUE (round_id, team,
// start_hole, trigger_type) cross-collided when two scorers in different
// foursomes filed for the same hole/team. The DELETE handler looked up the
// press row by (pressId, roundId) only — letting scorer A in foursome 1
// undo scorer B's press in foursome 2.
//
// Both bugs are closed: the POST INSERT now includes foursomeNumber from
// the assignment lookup, and the DELETE handler scopes the press-row WHERE
// by the caller's foursomeNumber.
// ───────────────────────────────────────────────────────────────────────────
interface MultiSeedResult {
  organizerId: string;
  scorerF1: string;
  scorerF2: string;
  eventId: string;
  roundId: string;
}

async function seedMultiFoursome(): Promise<MultiSeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    a1: randomUUID(), a2: randomUUID(), a3: randomUUID(), a4: randomUUID(),
    b1: randomUUID(), b2: randomUUID(), b3: randomUUID(), b4: randomUUID(),
    eventId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    eventRoundId: randomUUID(),
    pairing1Id: randomUUID(),
    pairing2Id: randomUUID(),
    roundId: randomUUID(),
    ruleSetId: randomUUID(),
    revisionId: randomUUID(),
  };
  const sortedF1: [string, string, string, string] =
    [ids.a1, ids.a2, ids.a3, ids.a4].sort() as [string, string, string, string];
  const sortedF2: [string, string, string, string] =
    [ids.b1, ids.b2, ids.b3, ids.b4].sort() as [string, string, string, string];
  const ctx = `event:${ids.eventId}`;

  // 9 players: organizer + 8 across the two foursomes.
  const all: Array<[string, string]> = [
    [ids.organizerId, 'Organizer'],
    [ids.a1, 'A1'], [ids.a2, 'A2'], [ids.a3, 'A3'], [ids.a4, 'A4'],
    [ids.b1, 'B1'], [ids.b2, 'B2'], [ids.b3, 'B3'], [ids.b4, 'B4'],
  ];
  for (const [id, name] of all) {
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
  // Two pairings, two foursomes.
  await db.insert(pairings).values({
    id: ids.pairing1Id, eventRoundId: ids.eventRoundId, foursomeNumber: 1,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(pairings).values({
    id: ids.pairing2Id, eventRoundId: ids.eventRoundId, foursomeNumber: 2,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  for (let i = 0; i < 4; i++) {
    await db.insert(pairingMembers).values({
      pairingId: ids.pairing1Id, playerId: sortedF1[i]!, slotNumber: i + 1,
      tenantId: TENANT_ID, contextId: ctx,
    });
    await db.insert(pairingMembers).values({
      pairingId: ids.pairing2Id, playerId: sortedF2[i]!, slotNumber: i + 1,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }
  // Scorer per foursome: first sorted member.
  await db.insert(scorerAssignments).values({
    roundId: ids.roundId, foursomeNumber: 1, scorerPlayerId: sortedF1[0]!,
    assignedAt: now, assignedByPlayerId: ids.organizerId,
    tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(scorerAssignments).values({
    roundId: ids.roundId, foursomeNumber: 2, scorerPlayerId: sortedF2[0]!,
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
    scorerF1: sortedF1[0]!,
    scorerF2: sortedF2[0]!,
    eventId: ids.eventId,
    roundId: ids.roundId,
  };
}

describe('T10-1 multi-foursome manual-press scoping', () => {
  test('two scorers in different foursomes file same team/hole press → both 200, distinct foursome_number, no UNIQUE collision', async () => {
    const s = await seedMultiFoursome();

    // Scorer 1 (foursome 1) files teamA press at fromHole=1.
    const app1 = buildApp(s.scorerF1);
    const res1 = await postPress(app1, s.roundId, { team: 'teamA' });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { pressId: string; fromHole: number };
    expect(body1.fromHole).toBe(1);

    // Scorer 2 (foursome 2) files teamA press at fromHole=1.
    const app2 = buildApp(s.scorerF2);
    const res2 = await postPress(app2, s.roundId, { team: 'teamA' });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { pressId: string; fromHole: number };
    expect(body2.fromHole).toBe(1);

    // Two distinct rows with the same (team, startHole, triggerType) tuple,
    // disambiguated only by foursome_number.
    const rows = await db
      .select()
      .from(teamPressLog)
      .where(eq(teamPressLog.roundId, s.roundId));
    expect(rows.length).toBe(2);
    const foursomes = rows.map((r) => r.foursomeNumber).sort();
    expect(foursomes).toEqual([1, 2]);
    expect(new Set(rows.map((r) => r.team)).size).toBe(1);
    expect(new Set(rows.map((r) => r.startHole)).size).toBe(1);
    expect(new Set(rows.map((r) => r.triggerType)).size).toBe(1);
  });

  test('cross-foursome DELETE returns 404 press_not_found (scorer A cannot undo scorer B\'s press)', async () => {
    const s = await seedMultiFoursome();

    // Scorer 2 files a press.
    const app2 = buildApp(s.scorerF2);
    const filed = await postPress(app2, s.roundId, { team: 'teamA' });
    expect(filed.status).toBe(200);
    const { pressId: bobsPress } = (await filed.json()) as { pressId: string };

    // Scorer 1 attempts to DELETE scorer 2's press.
    const app1 = buildApp(s.scorerF1);
    const undoRes = await deletePress(app1, s.roundId, bobsPress);
    expect(undoRes.status).toBe(404);
    expect(((await undoRes.json()) as { code: string }).code).toBe('press_not_found');

    // The press still exists (was NOT deleted by the cross-foursome attempt).
    const rows = await db
      .select()
      .from(teamPressLog)
      .where(eq(teamPressLog.id, bobsPress));
    expect(rows.length).toBe(1);
    expect(rows[0]!.foursomeNumber).toBe(2);

    // Scorer 2 (the legitimate owner) can still undo it. The buildApp call
    // above for scorerF1 reassigned the module-level __testPlayer; reset it
    // back to scorerF2 here so requireSession sees the right caller. The
    // existing Hono router instance is reusable — buildApp's only side
    // effect that matters across requests is the __testPlayer assignment.
    buildApp(s.scorerF2);
    const ownUndo = await deletePress(app2, s.roundId, bobsPress);
    expect(ownUndo.status).toBe(200);
    const after = await db
      .select()
      .from(teamPressLog)
      .where(eq(teamPressLog.id, bobsPress));
    expect(after.length).toBe(0);
  });
});
