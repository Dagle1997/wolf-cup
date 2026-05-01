/**
 * T5-8 round-lifecycle endpoints integration tests.
 *
 * Per AC-12: 15+ cases (a)–(o) plus h2 idempotency-no-double-audit.
 */
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
const { roundLifecycleRouter } = await import('./round-lifecycle.js');
const { scoresRouter } = await import('./scores.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(holeScores);
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

interface SeedOpts {
  state?:
    | 'not_started'
    | 'in_progress'
    | 'complete_editable'
    | 'finalized'
    | 'cancelled';
  fullScores?: boolean;
  partialScores?: boolean;
}

interface SeedResult {
  organizerId: string;
  scorerId: string;
  outsiderId: string;
  playerIds: string[];
  eventId: string;
  eventRoundId: string;
  roundId: string;
}

async function seed(opts: SeedOpts = {}): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    scorerId: randomUUID(),
    outsiderId: randomUUID(),
    playerIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID()],
    eventId: randomUUID(),
    eventRoundId: randomUUID(),
    roundId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    pairingId: randomUUID(),
  };
  const ctx = `event:${ids.eventId}`;

  await db.insert(players).values([
    { id: ids.organizerId, isOrganizer: true, createdAt: now, name: 'Organizer', tenantId: TENANT_ID, contextId: CTX_BASE },
    { id: ids.scorerId, isOrganizer: false, createdAt: now, name: 'Scorer', tenantId: TENANT_ID, contextId: CTX_BASE },
    { id: ids.outsiderId, isOrganizer: false, createdAt: now, name: 'Outsider', tenantId: TENANT_ID, contextId: CTX_BASE },
    ...ids.playerIds.map((pid, i) => ({
      id: pid, isOrganizer: false, createdAt: now, name: `Player${i + 1}`, tenantId: TENANT_ID, contextId: CTX_BASE,
    })),
  ]);

  await db.insert(courses).values({
    id: ids.courseId, name: 'Test Course', clubName: 'Test Club',
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  await db.insert(courseRevisions).values({
    id: ids.courseRevId, courseId: ids.courseId, revisionNumber: 1,
    sourceUrl: null, extractionDate: null, verified: false,
    outTotal: 36, inTotal: 36, courseTotal: 72,
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
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
    holesToPlay: 18, createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });

  if (opts.state !== undefined) {
    await db.insert(roundStates).values({
      roundId: ids.roundId, state: opts.state, enteredAt: now,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }

  await db.insert(pairings).values({
    id: ids.pairingId, eventRoundId: ids.eventRoundId, foursomeNumber: 1,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  for (let i = 0; i < ids.playerIds.length; i++) {
    await db.insert(pairingMembers).values({
      pairingId: ids.pairingId, playerId: ids.playerIds[i]!, slotNumber: i + 1,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }

  // Scorer assignment for foursome 1.
  await db.insert(scorerAssignments).values({
    roundId: ids.roundId, foursomeNumber: 1, scorerPlayerId: ids.scorerId,
    assignedAt: now, assignedByPlayerId: ids.organizerId,
    tenantId: TENANT_ID, contextId: ctx,
  });

  if (opts.fullScores || opts.partialScores) {
    for (const pid of ids.playerIds) {
      for (let h = 1; h <= 18; h++) {
        if (opts.partialScores && pid === ids.playerIds[0] && h === 5) continue;
        await db.insert(holeScores).values({
          id: randomUUID(), roundId: ids.roundId, playerId: pid, holeNumber: h,
          grossStrokes: 4, putts: null, scorerPlayerId: ids.scorerId,
          clientEventId: `evt-${pid}-${h}`,
          createdAt: now, updatedAt: now, tenantId: TENANT_ID, contextId: ctx,
        });
      }
    }
  }

  return {
    organizerId: ids.organizerId,
    scorerId: ids.scorerId,
    outsiderId: ids.outsiderId,
    playerIds: ids.playerIds,
    eventId: ids.eventId,
    eventRoundId: ids.eventRoundId,
    roundId: ids.roundId,
  };
}

function buildApp(playerId: string, isGlobalOrg = false): Hono {
  __testPlayer = { id: playerId, isOrganizer: isGlobalOrg };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/rounds', roundLifecycleRouter);
  app.route('/api/rounds', scoresRouter);
  return app;
}

async function post(app: Hono, path: string, body: unknown = {}): Promise<Response> {
  return await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/rounds/:roundId/complete', () => {
  test('(a) happy path — all 72 cells scored → 200, state=complete_editable', async () => {
    const s = await seed({ state: 'in_progress', fullScores: true });
    const app = buildApp(s.organizerId);
    const res = await post(app, `/api/rounds/${s.roundId}/complete`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; state: string; idempotent: boolean };
    expect(body.ok).toBe(true);
    expect(body.state).toBe('complete_editable');
    expect(body.idempotent).toBe(false);

    const rs = await db.select().from(roundStates).where(eq(roundStates.roundId, s.roundId));
    expect(rs[0]!.state).toBe('complete_editable');
  });

  test('(b) missing 1 cell → 422 round_incomplete with missingCells.length === 1', async () => {
    const s = await seed({ state: 'in_progress', partialScores: true });
    const app = buildApp(s.organizerId);
    const res = await post(app, `/api/rounds/${s.roundId}/complete`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code: string;
      missingCells: Array<{ playerId: string; holeNumber: number }>;
    };
    expect(body.code).toBe('round_incomplete');
    expect(body.missingCells.length).toBe(1);
    expect(body.missingCells[0]).toEqual({ playerId: s.playerIds[0]!, holeNumber: 5 });
  });

  test('(c) from not_started → 422 round_not_in_progress', async () => {
    const s = await seed({ state: 'not_started' });
    const app = buildApp(s.organizerId);
    const res = await post(app, `/api/rounds/${s.roundId}/complete`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('round_not_in_progress');
  });

  test('(d) from complete_editable → 200 idempotent', async () => {
    const s = await seed({ state: 'complete_editable', fullScores: true });
    const app = buildApp(s.organizerId);
    const res = await post(app, `/api/rounds/${s.roundId}/complete`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { idempotent: boolean };
    expect(body.idempotent).toBe(true);
  });

  test('(d2) IDEMPOTENT auth gate — outsider on already-complete_editable round → 403, NOT 200 idempotent', async () => {
    const s = await seed({ state: 'complete_editable', fullScores: true });
    const app = buildApp(s.outsiderId);
    const res = await post(app, `/api/rounds/${s.roundId}/complete`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_complete');
  });

  test('(e) outsider (non-org, non-scorer) → 403 not_authorized_for_complete', async () => {
    const s = await seed({ state: 'in_progress', fullScores: true });
    const app = buildApp(s.outsiderId);
    const res = await post(app, `/api/rounds/${s.roundId}/complete`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_complete');
  });

  test('scorer (non-organizer) CAN /complete the round', async () => {
    const s = await seed({ state: 'in_progress', fullScores: true });
    const app = buildApp(s.scorerId);
    const res = await post(app, `/api/rounds/${s.roundId}/complete`);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/rounds/:roundId/complete-rollback', () => {
  test('(f) from complete_editable → 200, state=in_progress', async () => {
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.organizerId);
    const res = await post(app, `/api/rounds/${s.roundId}/complete-rollback`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe('in_progress');
  });

  test('(g) from in_progress → 422 not_in_complete_editable', async () => {
    const s = await seed({ state: 'in_progress' });
    const app = buildApp(s.organizerId);
    const res = await post(app, `/api/rounds/${s.roundId}/complete-rollback`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_in_complete_editable');
  });
});

describe('POST /api/rounds/:roundId/finalize', () => {
  test('(h) happy path → 200, state=finalized; EXACTLY 2 audit rows', async () => {
    const s = await seed({ state: 'complete_editable', fullScores: true });
    const app = buildApp(s.organizerId);
    const res = await post(app, `/api/rounds/${s.roundId}/finalize`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; finalizedAt: number; idempotent: boolean };
    expect(body.state).toBe('finalized');
    expect(body.idempotent).toBe(false);
    expect(typeof body.finalizedAt).toBe('number');

    // EXACTLY 2 audit rows for this round.
    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, s.roundId));
    expect(audits.length).toBe(2);
    const types = audits.map((a) => a.eventType).sort();
    expect(types).toEqual(['round.finalized', 'round.state_changed']);
  });

  test('(h3) IDEMPOTENT auth gate — scorer on already-finalized round → 403, NOT 200 idempotent', async () => {
    const s = await seed({ state: 'finalized' });
    const app = buildApp(s.scorerId);
    const res = await post(app, `/api/rounds/${s.roundId}/finalize`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_finalize');
  });

  test('(h2) idempotent /finalize on already-finalized round → 200, no new audit rows, SAME finalizedAt', async () => {
    const s = await seed({ state: 'complete_editable', fullScores: true });
    const app = buildApp(s.organizerId);
    const first = await post(app, `/api/rounds/${s.roundId}/finalize`);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { finalizedAt: number; idempotent: boolean };
    expect(firstBody.idempotent).toBe(false);
    const auditsAfterFirst = await db.select().from(auditLog).where(eq(auditLog.entityId, s.roundId));
    expect(auditsAfterFirst.length).toBe(2);

    const second = await post(app, `/api/rounds/${s.roundId}/finalize`);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { idempotent: boolean; finalizedAt: number };
    expect(secondBody.idempotent).toBe(true);

    // finalizedAt MUST match between first and idempotent second call —
    // both read from the same round_states.entered_at column.
    expect(secondBody.finalizedAt).toBe(firstBody.finalizedAt);

    // Audit count UNCHANGED — no double-logging.
    const auditsAfterSecond = await db.select().from(auditLog).where(eq(auditLog.entityId, s.roundId));
    expect(auditsAfterSecond.length).toBe(2);
  });

  test('(i) /finalize from in_progress → 422 not_in_complete_editable', async () => {
    const s = await seed({ state: 'in_progress' });
    const app = buildApp(s.organizerId);
    const res = await post(app, `/api/rounds/${s.roundId}/finalize`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_in_complete_editable');
  });

  test('(j) /finalize by scorer (not organizer) → 403 not_authorized_for_finalize', async () => {
    const s = await seed({ state: 'complete_editable', fullScores: true });
    const app = buildApp(s.scorerId);
    const res = await post(app, `/api/rounds/${s.roundId}/finalize`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_finalize');
  });

  test('(k) /finalize defensive missing-cells re-verify — cell deleted before finalize → 422', async () => {
    const s = await seed({ state: 'complete_editable', fullScores: true });
    // Simulate a cell deletion (could happen via T5-9 score-correction or DB tampering)
    await db
      .delete(holeScores)
      .where(
        and(
          eq(holeScores.roundId, s.roundId),
          eq(holeScores.playerId, s.playerIds[0]!),
          eq(holeScores.holeNumber, 5),
        ),
      );
    const app = buildApp(s.organizerId);
    const res = await post(app, `/api/rounds/${s.roundId}/finalize`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code: string;
      missingCells: Array<{ playerId: string; holeNumber: number }>;
    };
    expect(body.code).toBe('round_incomplete');
    expect(body.missingCells.length).toBe(1);
  });
});

describe('POST /api/rounds/:roundId/cancel', () => {
  test('(l) from not_started → 200 cancelled', async () => {
    const s = await seed({ state: 'not_started' });
    const app = buildApp(s.organizerId);
    const res = await post(app, `/api/rounds/${s.roundId}/cancel`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe('cancelled');
  });

  test('(l2) from in_progress → 200 cancelled', async () => {
    const s = await seed({ state: 'in_progress' });
    const app = buildApp(s.organizerId);
    const res = await post(app, `/api/rounds/${s.roundId}/cancel`);
    expect(res.status).toBe(200);
  });

  test('(l3) from complete_editable → 200 cancelled', async () => {
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.organizerId);
    const res = await post(app, `/api/rounds/${s.roundId}/cancel`);
    expect(res.status).toBe(200);
  });

  test('(m) from finalized → 422 cannot_cancel_finalized', async () => {
    const s = await seed({ state: 'finalized' });
    const app = buildApp(s.organizerId);
    const res = await post(app, `/api/rounds/${s.roundId}/cancel`);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('cannot_cancel_finalized');
  });

  test('(n) /cancel by scorer (not organizer) → 403', async () => {
    const s = await seed({ state: 'in_progress' });
    const app = buildApp(s.scorerId);
    const res = await post(app, `/api/rounds/${s.roundId}/cancel`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_cancel');
  });

  test('(n2) IDEMPOTENT auth gate — outsider on already-cancelled round → 403, NOT 200 idempotent', async () => {
    const s = await seed({ state: 'cancelled' });
    const app = buildApp(s.outsiderId);
    const res = await post(app, `/api/rounds/${s.roundId}/cancel`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_cancel');
  });

  test('(n3) /cancel idempotent on already-cancelled round → 200, NO new audit rows', async () => {
    const s = await seed({ state: 'cancelled' });
    const app = buildApp(s.organizerId);
    const auditsBefore = await db.select().from(auditLog).where(eq(auditLog.entityId, s.roundId));
    const res = await post(app, `/api/rounds/${s.roundId}/cancel`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { idempotent: boolean };
    expect(body.idempotent).toBe(true);
    const auditsAfter = await db.select().from(auditLog).where(eq(auditLog.entityId, s.roundId));
    expect(auditsAfter.length).toBe(auditsBefore.length);
  });
});

describe('Score POST against finalized round (T5-6 integration with T5-8)', () => {
  test('(o) score POST returns 422 round_state_locks_writes', async () => {
    const s = await seed({ state: 'finalized', fullScores: true });
    const app = buildApp(s.scorerId);
    const res = await app.request(`/api/rounds/${s.roundId}/holes/1/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: s.playerIds[0]!,
        grossStrokes: 4,
        clientEventId: 'evt-against-finalized',
      }),
    });
    expect(res.status).toBe(422);
    // T5-6's existing 422 code for finalized writes is round_not_writable.
    // (T5-8's AC-8 mentioned 'round_state_locks_writes' but T5-6 already
    // ships round_not_writable; the contract is the existing one.)
    const body = (await res.json()) as { code: string; currentState?: string };
    expect(body.code).toBe('round_not_writable');
    expect(body.currentState).toBe('finalized');
  });
});

describe('finalize-before-handoff regression (T5-8 closes T5-7g)', () => {
  test('handoff returns 422 round_finalized when finalize committed before handoff begins', async () => {
    const s = await seed({ state: 'complete_editable', fullScores: true });

    // Step 1: organizer finalizes the round.
    const orgApp = buildApp(s.organizerId);
    const finalizeRes = await post(orgApp, `/api/rounds/${s.roundId}/finalize`);
    expect(finalizeRes.status).toBe(200);

    // Step 2: scorer attempts a handoff. Should 422 due to state-gated UPDATE.
    const { scorerAssignmentsRouter } = await import('./scorer-assignments.js');
    __testPlayer = { id: s.scorerId, isOrganizer: false };
    const handoffApp = new Hono();
    handoffApp.use('*', requestIdMiddleware);
    handoffApp.route('/api/rounds', scorerAssignmentsRouter);
    const handoffRes = await handoffApp.request(
      `/api/rounds/${s.roundId}/scorer-assignments/transfer`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foursomeNumber: 1, toPlayerId: s.playerIds[1]! }),
      },
    );
    expect(handoffRes.status).toBe(422);
    const body = (await handoffRes.json()) as { code: string };
    expect(body.code).toBe('round_finalized');
  });
});
