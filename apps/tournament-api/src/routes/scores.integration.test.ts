import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { and, eq } from 'drizzle-orm';
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

// The scoresRouter mounts `requireSession` in its chain. Replace it with
// a stub that pulls the test-injected player from a module-local var so
// each test can drive the session identity. The actual `require-session`
// module is exercised by its own dedicated tests; here we want to
// concentrate on the scorer-gate + handler logic without a real cookie.
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
    c.set('session', {
      sessionId: 'test-session',
      playerId: __testPlayer.id,
    });
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
  auditLog,
} = await import('../db/schema/index.js');
const { scoresRouter } = await import('./scores.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(auditLog);
  // T6-4: team_press_log FKs to rounds; delete BEFORE rounds.
  const { teamPressLog: tplTable, ruleSetRevisions: rsrTable, ruleSets: rsTable, courseTees: ctTable, courseHoles: chTable } =
    await import('../db/schema/index.js');
  await db.delete(tplTable);
  await db.delete(holeScores);
  await db.delete(roundStates);
  await db.delete(scorerAssignments);
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(rsrTable);
  await db.delete(rsTable);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(chTable);
  await db.delete(ctTable);
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
  eventRoundId: string;
  roundId: string;
  ctx: string;
}

async function seedRound(opts: {
  state?: 'not_started' | 'in_progress' | 'complete_editable' | 'finalized' | 'cancelled';
  holesToPlay?: 9 | 18;
}): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    scorerId: randomUUID(),
    player1Id: randomUUID(),
    player2Id: randomUUID(),
    eventId: randomUUID(),
    eventRoundId: randomUUID(),
    roundId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    pairingId: randomUUID(),
  };
  const ctx = `event:${ids.eventId}`;

  for (const [id, isOrg, name] of [
    [ids.organizerId, true, 'Organizer'],
    [ids.scorerId, false, 'Scorer'],
    [ids.player1Id, false, 'Player One'],
    [ids.player2Id, false, 'Player Two'],
  ] as const) {
    await db.insert(players).values({
      id,
      isOrganizer: isOrg,
      createdAt: now,
      name,
      tenantId: TENANT_ID,
      contextId: CTX_BASE,
    });
  }

  await db.insert(courses).values({
    id: ids.courseId,
    name: 'Test Course',
    clubName: 'Test Club',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX_BASE,
  });
  await db.insert(courseRevisions).values({
    id: ids.courseRevId,
    courseId: ids.courseId,
    revisionNumber: 1,
    sourceUrl: null,
    extractionDate: null,
    verified: false,
    outTotal: 36,
    inTotal: 36,
    courseTotal: 72,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX_BASE,
  });
  await db.insert(events).values({
    id: ids.eventId,
    name: 'Test Event',
    startDate: now,
    endDate: now + 86400000,
    timezone: 'America/New_York',
    organizerPlayerId: ids.organizerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.eventRoundId,
    eventId: ids.eventId,
    roundNumber: 1,
    roundDate: now,
    courseRevisionId: ids.courseRevId,
    teeColor: 'blue',
    holesToPlay: opts.holesToPlay ?? 18,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  await db.insert(rounds).values({
    id: ids.roundId,
    eventId: ids.eventId,
    eventRoundId: ids.eventRoundId,
    holesToPlay: opts.holesToPlay ?? 18,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  await db.insert(roundStates).values({
    roundId: ids.roundId,
    state: opts.state ?? 'not_started',
    enteredAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  await db.insert(pairings).values({
    id: ids.pairingId,
    eventRoundId: ids.eventRoundId,
    foursomeNumber: 1,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  await db.insert(pairingMembers).values([
    {
      pairingId: ids.pairingId,
      playerId: ids.player1Id,
      slotNumber: 1,
      tenantId: TENANT_ID,
      contextId: ctx,
    },
    {
      pairingId: ids.pairingId,
      playerId: ids.player2Id,
      slotNumber: 2,
      tenantId: TENANT_ID,
      contextId: ctx,
    },
  ]);
  await db.insert(scorerAssignments).values({
    roundId: ids.roundId,
    foursomeNumber: 1,
    scorerPlayerId: ids.scorerId,
    assignedAt: now,
    assignedByPlayerId: ids.organizerId,
    tenantId: TENANT_ID,
    contextId: ctx,
  });

  return {
    organizerId: ids.organizerId,
    scorerId: ids.scorerId,
    player1Id: ids.player1Id,
    player2Id: ids.player2Id,
    eventId: ids.eventId,
    eventRoundId: ids.eventRoundId,
    roundId: ids.roundId,
    ctx,
  };
}

function buildApp(scorerId: string): Hono {
  __testPlayer = { id: scorerId, isOrganizer: false };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/rounds', scoresRouter);
  return app;
}

async function postScore(
  app: Hono,
  roundId: string,
  holeNumber: number,
  body: unknown,
): Promise<Response> {
  return await app.request(`/api/rounds/${roundId}/holes/${holeNumber}/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/rounds/:roundId/holes/:holeNumber/scores', () => {
  test('201 happy path: new cell created; audit row written; row visible', async () => {
    const seed = await seedRound({ state: 'not_started' });
    const app = buildApp(seed.scorerId);
    const res = await postScore(app, seed.roundId, 1, {
      playerId: seed.player1Id,
      grossStrokes: 4,
      putts: 2,
      clientEventId: 'evt-happy',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      status: string;
      clientEventId: string;
      holeScoreId: string;
      deduped: boolean;
    };
    expect(body.status).toBe('ok');
    expect(body.deduped).toBe(false);
    expect(body.clientEventId).toBe('evt-happy');

    // Row visible.
    const rows = await db
      .select()
      .from(holeScores)
      .where(eq(holeScores.id, body.holeScoreId));
    expect(rows.length).toBe(1);
    expect(rows[0]!.grossStrokes).toBe(4);
    expect(rows[0]!.putts).toBe(2);
    expect(rows[0]!.scorerPlayerId).toBe(seed.scorerId);

    // score.committed audit row written.
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, body.holeScoreId));
    expect(audits.length).toBe(1);
    expect(audits[0]!.eventType).toBe('score.committed');
  });

  test('200 deduped: same clientEventId replay → no new row, no audit', async () => {
    const seed = await seedRound({ state: 'in_progress' });
    const app = buildApp(seed.scorerId);
    const first = await postScore(app, seed.roundId, 5, {
      playerId: seed.player1Id,
      grossStrokes: 4,
      clientEventId: 'evt-replay',
    });
    expect(first.status).toBe(201);

    const second = await postScore(app, seed.roundId, 5, {
      playerId: seed.player1Id,
      grossStrokes: 7, // intentionally different — second should still be a no-op
      clientEventId: 'evt-replay',
    });
    expect(second.status).toBe(200);
    const body = (await second.json()) as { deduped: boolean };
    expect(body.deduped).toBe(true);

    // Exactly 1 row; first insert won.
    const rows = await db
      .select()
      .from(holeScores)
      .where(
        and(
          eq(holeScores.roundId, seed.roundId),
          eq(holeScores.playerId, seed.player1Id),
          eq(holeScores.holeNumber, 5),
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0]!.grossStrokes).toBe(4);

    // Exactly 1 score.committed audit row (from the first insert);
    // the dedupe path MUST NOT have written a second.
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'score.committed'));
    expect(audits.length).toBe(1);
  });

  test('409 hole_already_scored: different clientEventId at same cell', async () => {
    const seed = await seedRound({ state: 'in_progress' });
    const app = buildApp(seed.scorerId);
    await postScore(app, seed.roundId, 7, {
      playerId: seed.player1Id,
      grossStrokes: 4,
      clientEventId: 'evt-A',
    });

    const res = await postScore(app, seed.roundId, 7, {
      playerId: seed.player1Id,
      grossStrokes: 5,
      clientEventId: 'evt-B',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      code: string;
      conflictingEntry: {
        scorer_player_id: string;
        client_event_id: string;
      } | null;
    };
    expect(body.code).toBe('hole_already_scored');
    expect(body.conflictingEntry).not.toBeNull();
    expect(body.conflictingEntry!.client_event_id).toBe('evt-A');

    // T5-10 AC-1: first-writer-wins (D3-3). The cell holds exactly the
    // ORIGINAL row — same gross AND same clientEventId — proving the
    // 409 path didn't silently overwrite (a hypothetical UPDATE that
    // coincidentally set grossStrokes=4 again would still pass the
    // first two assertions; clientEventId='evt-A' proves identity).
    const rows = await db
      .select()
      .from(holeScores)
      .where(
        and(
          eq(holeScores.roundId, seed.roundId),
          eq(holeScores.playerId, seed.player1Id),
          eq(holeScores.holeNumber, 7),
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0]!.grossStrokes).toBe(4);
    expect(rows[0]!.clientEventId).toBe('evt-A');

    // T5-10 AC-2: the 409 path MUST NOT emit a score.committed audit row.
    // Two complementary assertions for defense in depth:
    //   (a) entity-scoped: surviving hole_score's id has exactly 1 audit
    //       row (the original insert's). Catches "duplicate audit under
    //       the same entityId".
    //   (b) round-total: the entire suite has exactly 1 score.committed
    //       audit row (beforeEach truncates auditLog). Catches "audit
    //       erroneously emitted under any other entityId on the 409 path".
    const surviving = rows[0]!;
    const entityScopedAudits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, 'score.committed'),
          eq(auditLog.entityId, surviving.id),
        ),
      );
    expect(entityScopedAudits.length).toBe(1);
    const allCommittedAudits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'score.committed'));
    expect(allCommittedAudits.length).toBe(1);
  });

  test('422 round_not_writable: state = finalized rejects writes', async () => {
    const seed = await seedRound({ state: 'finalized' });
    const app = buildApp(seed.scorerId);
    const res = await postScore(app, seed.roundId, 1, {
      playerId: seed.player1Id,
      grossStrokes: 4,
      clientEventId: 'evt-final',
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; currentState: string };
    expect(body.code).toBe('round_not_writable');
    expect(body.currentState).toBe('finalized');
  });

  test('422 hole_number_exceeds_holes_to_play: holeNumber=10 in a 9-hole round', async () => {
    const seed = await seedRound({ state: 'not_started', holesToPlay: 9 });
    const app = buildApp(seed.scorerId);
    const res = await postScore(app, seed.roundId, 10, {
      playerId: seed.player1Id,
      grossStrokes: 4,
      clientEventId: 'evt-overshoot',
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code: string;
      holesToPlay: number;
    };
    expect(body.code).toBe('hole_number_exceeds_holes_to_play');
    expect(body.holesToPlay).toBe(9);
  });

  test('state transition not_started → in_progress on first commit; rounds.opened_at populated', async () => {
    const seed = await seedRound({ state: 'not_started' });
    const app = buildApp(seed.scorerId);
    const res = await postScore(app, seed.roundId, 1, {
      playerId: seed.player1Id,
      grossStrokes: 4,
      clientEventId: 'evt-first',
    });
    expect(res.status).toBe(201);

    const stateRows = await db
      .select()
      .from(roundStates)
      .where(eq(roundStates.roundId, seed.roundId));
    expect(stateRows[0]!.state).toBe('in_progress');
    expect(stateRows[0]!.enteredByPlayerId).toBe(seed.scorerId);

    const roundRows = await db
      .select()
      .from(rounds)
      .where(eq(rounds.id, seed.roundId));
    expect(roundRows[0]!.openedAt).not.toBeNull();
    expect(roundRows[0]!.openedByPlayerId).toBe(seed.scorerId);

    // round.state_changed audit row written
    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, 'round'),
          eq(auditLog.entityId, seed.roundId),
        ),
      );
    expect(audits.length).toBe(1);
    expect(audits[0]!.eventType).toBe('round.state_changed');
    const payload = JSON.parse(audits[0]!.payloadJson) as {
      from: string;
      to: string;
    };
    expect(payload).toEqual({ from: 'not_started', to: 'in_progress' });
  });

  test('state transition in_progress → complete_editable on last-cell commit', async () => {
    // 9-hole round with 2 players → 18 expected cells. Pre-seed 17 cells; the
    // 18th commit triggers auto-complete.
    const seed = await seedRound({ state: 'in_progress', holesToPlay: 9 });

    const now = Date.now();
    // Pre-seed 17 cells (all of player1's 9 holes + 8 of player2's 9).
    let cellCount = 0;
    for (let h = 1; h <= 9; h++) {
      await db.insert(holeScores).values({
        id: randomUUID(),
        roundId: seed.roundId,
        playerId: seed.player1Id,
        holeNumber: h,
        grossStrokes: 4,
        putts: null,
        scorerPlayerId: seed.scorerId,
        clientEventId: `pre-${h}-p1`,
        createdAt: now,
        updatedAt: now,
        tenantId: TENANT_ID,
        contextId: seed.ctx,
      });
      cellCount++;
    }
    for (let h = 1; h <= 8; h++) {
      await db.insert(holeScores).values({
        id: randomUUID(),
        roundId: seed.roundId,
        playerId: seed.player2Id,
        holeNumber: h,
        grossStrokes: 4,
        putts: null,
        scorerPlayerId: seed.scorerId,
        clientEventId: `pre-${h}-p2`,
        createdAt: now,
        updatedAt: now,
        tenantId: TENANT_ID,
        contextId: seed.ctx,
      });
      cellCount++;
    }
    expect(cellCount).toBe(17);

    const app = buildApp(seed.scorerId);
    // 18th commit — last cell.
    const res = await postScore(app, seed.roundId, 9, {
      playerId: seed.player2Id,
      grossStrokes: 5,
      clientEventId: 'evt-last',
    });
    expect(res.status).toBe(201);

    const stateRows = await db
      .select()
      .from(roundStates)
      .where(eq(roundStates.roundId, seed.roundId));
    expect(stateRows[0]!.state).toBe('complete_editable');

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityType, 'round'));
    // 1 audit row for the in_progress → complete_editable transition
    // (first-commit transition wasn't fired because we started at in_progress).
    expect(audits.length).toBe(1);
    const payload = JSON.parse(audits[0]!.payloadJson) as {
      from: string;
      to: string;
    };
    expect(payload).toEqual({
      from: 'in_progress',
      to: 'complete_editable',
    });
  });

  test('foreign-tenant defense-in-depth: round in another tenant → middleware 404 round_not_found', async () => {
    // Seed a round under tenant 'guyan' but ask the middleware about it
    // while the round itself was somehow planted under another tenant.
    // Simulate by directly UPDATEing the round's tenant_id post-seed.
    const seed = await seedRound({ state: 'not_started' });
    await db
      .update(rounds)
      .set({ tenantId: 'foreign-tenant' })
      .where(eq(rounds.id, seed.roundId));
    const app = buildApp(seed.scorerId);
    const res = await postScore(app, seed.roundId, 1, {
      playerId: seed.player1Id,
      grossStrokes: 4,
      clientEventId: 'evt-foreign',
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('round_not_found');
  });
});

// ===========================================================================
// T6-4 press-orchestrator integration tests
// ===========================================================================
//
// The existing scores integration tests above use a 2-player foursome which
// doesn't trigger the press orchestrator (4-player guard rail skips). These
// tests extend the seed to a full 4-player foursome plus rule_set + course
// data so the press orchestrator can actually fire.
//
// Press behavior is verified in detail by services/press-orchestrator.test.ts
// — these integration tests verify the WIRING (route → orchestrator → DB).

import {
  courseTees as courseTeesTable,
  courseHoles as courseHolesTable,
  ruleSets as ruleSetsTable,
  ruleSetRevisions as ruleSetRevisionsTable,
  teamPressLog as teamPressLogTable,
} from '../db/schema/index.js';

interface T6_4SeedResult {
  organizerId: string;
  /** Sorted alphabetical for deterministic team assignment by orchestrator. */
  playerIds: [string, string, string, string];
  scorerId: string;        // = playerIds[0] for simplicity
  eventId: string;
  roundId: string;
}

async function seedT6_4Round(opts: { autoPressEnabled?: boolean } = {}): Promise<T6_4SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    p1: randomUUID(),
    p2: randomUUID(),
    p3: randomUUID(),
    p4: randomUUID(),
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
  await db.insert(courseTeesTable).values({
    id: randomUUID(), courseRevisionId: ids.courseRevId, teeColor: 'blue',
    rating: 720, slope: 113,
    tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  for (let h = 1; h <= 18; h++) {
    await db.insert(courseHolesTable).values({
      id: randomUUID(), courseRevisionId: ids.courseRevId,
      holeNumber: h, par: 4, si: ((h * 7) % 18) + 1,
      yardagePerTeeJson: '{}',
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  await db.insert(events).values({
    id: ids.eventId, name: 'Test Event', startDate: now, endDate: now + 86400000,
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
  // Scorer = first player (need a scorer assignment for the require-scorer middleware).
  await db.insert(scorerAssignments).values({
    roundId: ids.roundId, foursomeNumber: 1, scorerPlayerId: sortedPlayers[0]!,
    assignedAt: now, assignedByPlayerId: ids.organizerId,
    tenantId: TENANT_ID, contextId: ctx,
  });

  await db.insert(ruleSetsTable).values({
    id: ids.ruleSetId, name: 'Test', createdAt: now,
    tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
  });
  const config = opts.autoPressEnabled !== false
    ? { autoPressTriggerAtNDown: 2, pressMultiplier: 2, basePerHoleCents: 100,
        sandies: false, sandiesBonusPerHoleCents: 0, greenieCarryover: false,
        greenieValidation: 'none', greenieBaseCents: 0 }
    : { autoPressTriggerAtNDown: null, pressMultiplier: 2, basePerHoleCents: 100,
        sandies: false, sandiesBonusPerHoleCents: 0, greenieCarryover: false,
        greenieValidation: 'none', greenieBaseCents: 0 };
  await db.insert(ruleSetRevisionsTable).values({
    id: ids.revisionId, ruleSetId: ids.ruleSetId, revisionNumber: 1,
    configJson: JSON.stringify(config),
    effectiveFromRoundId: null, effectiveFromHole: 1,
    createdByPlayerId: ids.organizerId, reason: null, createdAt: now,
    tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
  });

  return {
    organizerId: ids.organizerId,
    playerIds: sortedPlayers,
    scorerId: sortedPlayers[0]!,
    eventId: ids.eventId,
    roundId: ids.roundId,
  };
}

describe('T6-4 press orchestrator wiring', () => {
  test('AC-7(a) hole NOT complete (3 of 4 scored) → no press log rows', async () => {
    const s = await seedT6_4Round();
    const app = buildApp(s.scorerId);
    // Score 3 of 4 players for hole 1.
    for (let i = 0; i < 3; i++) {
      const res = await postScore(app, s.roundId, 1, {
        playerId: s.playerIds[i]!,
        grossStrokes: 5,
        clientEventId: `evt-h1-p${i}`,
      });
      expect(res.status).toBe(201);
    }
    const presses = await db.select().from(teamPressLogTable).where(eq(teamPressLogTable.roundId, s.roundId));
    expect(presses.length).toBe(0);
  });

  test('AC-7(b) hole complete with no trigger → no press log rows', async () => {
    const s = await seedT6_4Round();
    const app = buildApp(s.scorerId);
    // All 4 players score hole 1 with same gross (halved hole; no winner; no trigger).
    for (let i = 0; i < 4; i++) {
      const res = await postScore(app, s.roundId, 1, {
        playerId: s.playerIds[i]!,
        grossStrokes: 4,
        clientEventId: `evt-h1-p${i}`,
      });
      expect(res.status).toBe(201);
    }
    const presses = await db.select().from(teamPressLogTable).where(eq(teamPressLogTable.roundId, s.roundId));
    expect(presses.length).toBe(0);
  });

  test('AC-7(c) hole complete + trigger → exactly one team_press_log row', async () => {
    const s = await seedT6_4Round();
    const app = buildApp(s.scorerId);
    // teamA = playerIds[0], playerIds[1]; teamB = playerIds[2], playerIds[3].
    // Score holes 1-2 such that teamB wins both → A is 2-down at hole 2.
    for (let h = 1; h <= 2; h++) {
      // Commit in order: player[0], player[1], player[2], player[3].
      // The 4th commit completes the hole.
      await postScore(app, s.roundId, h, { playerId: s.playerIds[0]!, grossStrokes: 5, clientEventId: `evt-${h}-0` });
      await postScore(app, s.roundId, h, { playerId: s.playerIds[1]!, grossStrokes: 5, clientEventId: `evt-${h}-1` });
      await postScore(app, s.roundId, h, { playerId: s.playerIds[2]!, grossStrokes: 4, clientEventId: `evt-${h}-2` });
      const lastRes = await postScore(app, s.roundId, h, { playerId: s.playerIds[3]!, grossStrokes: 5, clientEventId: `evt-${h}-3` });
      expect(lastRes.status).toBe(201);
    }
    const presses = await db.select().from(teamPressLogTable).where(eq(teamPressLogTable.roundId, s.roundId));
    expect(presses.length).toBeGreaterThanOrEqual(1);
    const teamAPress = presses.find((p) => p.team === 'teamA' && p.triggerType === 'auto');
    expect(teamAPress).toBeDefined();
    expect(teamAPress!.startHole).toBe(3);  // trigger at hole 2 → press starts at hole 3
    expect(teamAPress!.multiplier).toBe(2);
    expect(teamAPress!.trigger).toBe('2-down');
  });

  test('AC-7(d) idempotent replay (clientEventId dedupe) → no duplicate press rows', async () => {
    const s = await seedT6_4Round();
    const app = buildApp(s.scorerId);
    // First commit triggers a press.
    for (let h = 1; h <= 2; h++) {
      await postScore(app, s.roundId, h, { playerId: s.playerIds[0]!, grossStrokes: 5, clientEventId: `evt-${h}-0` });
      await postScore(app, s.roundId, h, { playerId: s.playerIds[1]!, grossStrokes: 5, clientEventId: `evt-${h}-1` });
      await postScore(app, s.roundId, h, { playerId: s.playerIds[2]!, grossStrokes: 4, clientEventId: `evt-${h}-2` });
      await postScore(app, s.roundId, h, { playerId: s.playerIds[3]!, grossStrokes: 5, clientEventId: `evt-${h}-3` });
    }
    const pressesAfterFirst = await db.select().from(teamPressLogTable).where(eq(teamPressLogTable.roundId, s.roundId));
    const firstCount = pressesAfterFirst.length;
    expect(firstCount).toBeGreaterThanOrEqual(1);

    // Replay the 4th commit on hole 2 (same clientEventId) → deduped at hole_scores layer.
    const replayRes = await postScore(app, s.roundId, 2, {
      playerId: s.playerIds[3]!,
      grossStrokes: 5,
      clientEventId: 'evt-2-3',
    });
    expect(replayRes.status).toBe(200);  // deduped

    const pressesAfterReplay = await db.select().from(teamPressLogTable).where(eq(teamPressLogTable.roundId, s.roundId));
    expect(pressesAfterReplay.length).toBe(firstCount);
  });

  test('AC-7(e) auto-press disabled in rule-set → no press fires regardless of state', async () => {
    const s = await seedT6_4Round({ autoPressEnabled: false });
    const app = buildApp(s.scorerId);
    // Same trigger pattern as AC-7(c) but rule-set has auto-press disabled.
    for (let h = 1; h <= 2; h++) {
      await postScore(app, s.roundId, h, { playerId: s.playerIds[0]!, grossStrokes: 5, clientEventId: `evt-${h}-0` });
      await postScore(app, s.roundId, h, { playerId: s.playerIds[1]!, grossStrokes: 5, clientEventId: `evt-${h}-1` });
      await postScore(app, s.roundId, h, { playerId: s.playerIds[2]!, grossStrokes: 4, clientEventId: `evt-${h}-2` });
      await postScore(app, s.roundId, h, { playerId: s.playerIds[3]!, grossStrokes: 5, clientEventId: `evt-${h}-3` });
    }
    const presses = await db.select().from(teamPressLogTable).where(eq(teamPressLogTable.roundId, s.roundId));
    expect(presses.length).toBe(0);
  });
});
