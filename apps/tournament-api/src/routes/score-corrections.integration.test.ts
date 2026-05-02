/**
 * T5-9 score-corrections endpoint integration tests.
 *
 * 17 cases (a)-(q) per AC-8.
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
  scoreCorrections,
  auditLog,
} = await import('../db/schema/index.js');
const { scoreCorrectionsRouter } = await import('./score-corrections.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(scoreCorrections);
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
  /** Score the cell (player1, hole 5) with gross=4. Default true. */
  scoreCell?: boolean;
  /** Seed a SECOND foursome with its own scorer. Default false. */
  twoFoursomes?: boolean;
}

interface SeedResult {
  organizerId: string;
  /** Foursome 1 scorer (also foursome 1 member). */
  scorerId: string;
  /** Foursome 1 player whose score we'll correct. */
  player1Id: string;
  /** Other foursome 1 members. */
  player2Id: string;
  player3Id: string;
  /** Foursome 2 scorer (only when twoFoursomes=true). */
  foursome2ScorerId: string | null;
  /** Foursome 2 player (only when twoFoursomes=true). */
  foursome2P1Id: string | null;
  outsiderId: string;
  eventId: string;
  eventRoundId: string;
  roundId: string;
  /** id of the seeded hole_scores cell (player1, hole 5). */
  cellId: string | null;
}

async function seed(opts: SeedOpts = {}): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    scorerId: randomUUID(),
    player1Id: randomUUID(),
    player2Id: randomUUID(),
    player3Id: randomUUID(),
    outsiderId: randomUUID(),
    foursome2ScorerId: opts.twoFoursomes ? randomUUID() : null,
    foursome2P1Id: opts.twoFoursomes ? randomUUID() : null,
    eventId: randomUUID(),
    eventRoundId: randomUUID(),
    roundId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    pairingId: randomUUID(),
    pairing2Id: opts.twoFoursomes ? randomUUID() : null,
    cellId: opts.scoreCell !== false ? randomUUID() : null,
  };
  const ctx = `event:${ids.eventId}`;

  const playerSeeds: Array<readonly [string, string, boolean]> = [
    [ids.organizerId, 'Organizer', false],
    [ids.scorerId, 'Scorer', false],
    [ids.player1Id, 'Player1', false],
    [ids.player2Id, 'Player2', false],
    [ids.player3Id, 'Player3', false],
    [ids.outsiderId, 'Outsider', false],
  ];
  if (ids.foursome2ScorerId) playerSeeds.push([ids.foursome2ScorerId, 'F2Scorer', false]);
  if (ids.foursome2P1Id) playerSeeds.push([ids.foursome2P1Id, 'F2P1', false]);
  for (const [id, name, isOrg] of playerSeeds) {
    await db.insert(players).values({
      id, isOrganizer: isOrg, createdAt: now, name,
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

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

  // Foursome 1: scorerId, player1Id, player2Id, player3Id
  await db.insert(pairings).values({
    id: ids.pairingId, eventRoundId: ids.eventRoundId, foursomeNumber: 1,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  for (const [pid, slot] of [
    [ids.scorerId, 1],
    [ids.player1Id, 2],
    [ids.player2Id, 3],
    [ids.player3Id, 4],
  ] as Array<[string, number]>) {
    await db.insert(pairingMembers).values({
      pairingId: ids.pairingId, playerId: pid, slotNumber: slot,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }
  await db.insert(scorerAssignments).values({
    roundId: ids.roundId, foursomeNumber: 1, scorerPlayerId: ids.scorerId,
    assignedAt: now, assignedByPlayerId: ids.organizerId,
    tenantId: TENANT_ID, contextId: ctx,
  });

  if (opts.twoFoursomes && ids.pairing2Id && ids.foursome2ScorerId && ids.foursome2P1Id) {
    await db.insert(pairings).values({
      id: ids.pairing2Id, eventRoundId: ids.eventRoundId, foursomeNumber: 2,
      createdAt: now, tenantId: TENANT_ID, contextId: ctx,
    });
    await db.insert(pairingMembers).values({
      pairingId: ids.pairing2Id, playerId: ids.foursome2ScorerId, slotNumber: 1,
      tenantId: TENANT_ID, contextId: ctx,
    });
    await db.insert(pairingMembers).values({
      pairingId: ids.pairing2Id, playerId: ids.foursome2P1Id, slotNumber: 2,
      tenantId: TENANT_ID, contextId: ctx,
    });
    await db.insert(scorerAssignments).values({
      roundId: ids.roundId, foursomeNumber: 2, scorerPlayerId: ids.foursome2ScorerId,
      assignedAt: now, assignedByPlayerId: ids.organizerId,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }

  if (opts.scoreCell !== false && ids.cellId) {
    await db.insert(holeScores).values({
      id: ids.cellId, roundId: ids.roundId, playerId: ids.player1Id, holeNumber: 5,
      grossStrokes: 4, putts: 2, scorerPlayerId: ids.scorerId,
      clientEventId: 'evt-seed', createdAt: now, updatedAt: now,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }

  return {
    organizerId: ids.organizerId,
    scorerId: ids.scorerId,
    player1Id: ids.player1Id,
    player2Id: ids.player2Id,
    player3Id: ids.player3Id,
    foursome2ScorerId: ids.foursome2ScorerId,
    foursome2P1Id: ids.foursome2P1Id,
    outsiderId: ids.outsiderId,
    eventId: ids.eventId,
    eventRoundId: ids.eventRoundId,
    roundId: ids.roundId,
    cellId: ids.cellId,
  };
}

function buildApp(playerId: string): Hono {
  __testPlayer = { id: playerId, isOrganizer: false };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/rounds', scoreCorrectionsRouter);
  return app;
}

async function postCorrect(
  app: Hono,
  roundId: string,
  playerId: string,
  holeNumber: number | string,
  body: unknown,
): Promise<Response> {
  return await app.request(
    `/api/rounds/${roundId}/scores/${playerId}/${holeNumber}/correct`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

async function getHistory(app: Hono, roundId: string): Promise<Response> {
  return await app.request(`/api/rounds/${roundId}/score-corrections`);
}

describe('POST /api/rounds/:roundId/scores/:playerId/:holeNumber/correct', () => {
  test('(a) 200 happy path — scorer corrects gross 4 → 5 on complete_editable round', async () => {
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.scorerId);
    const res = await postCorrect(app, s.roundId, s.player1Id, 5, {
      grossStrokes: 5,
      reason: 'mistyped',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      correctionId: string;
      prior: { grossStrokes: number; putts: number | null };
      new: { grossStrokes: number; putts: number | null };
    };
    expect(body.ok).toBe(true);
    expect(body.prior.grossStrokes).toBe(4);
    expect(body.new.grossStrokes).toBe(5);

    // hole_scores updated.
    const cell = await db.select().from(holeScores).where(eq(holeScores.id, s.cellId!));
    expect(cell[0]!.grossStrokes).toBe(5);

    // score_corrections row written.
    const corrections = await db.select().from(scoreCorrections).where(eq(scoreCorrections.roundId, s.roundId));
    expect(corrections.length).toBe(1);
    expect(corrections[0]!.actorPlayerId).toBe(s.scorerId);
    expect(corrections[0]!.reason).toBe('mistyped');

    // audit_log row written.
    const audits = await db.select().from(auditLog).where(eq(auditLog.eventType, 'score.corrected'));
    expect(audits.length).toBe(1);
    expect(audits[0]!.entityId).toBe(s.cellId);
  });

  test('(b) 200 organizer-recovery path — organizer corrects player not in their foursome', async () => {
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.organizerId);
    const res = await postCorrect(app, s.roundId, s.player1Id, 5, { grossStrokes: 6 });
    expect(res.status).toBe(200);
  });

  test('(c) 200 finalized round — correction allowed, no T6 recompute v1', async () => {
    const s = await seed({ state: 'finalized' });
    const app = buildApp(s.scorerId);
    const res = await postCorrect(app, s.roundId, s.player1Id, 5, { grossStrokes: 7 });
    expect(res.status).toBe(200);
    // hole_scores updated even on finalized round.
    const cell = await db.select().from(holeScores).where(eq(holeScores.id, s.cellId!));
    expect(cell[0]!.grossStrokes).toBe(7);
  });

  test('AC-4 breadcrumb — finalized correction emits correction_post_finalize_pending_t6 AFTER tx commit', async () => {
    const s = await seed({ state: 'finalized' });
    const app = buildApp(s.scorerId);
    const { logger } = await import('../lib/log.js');
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    try {
      const res = await postCorrect(app, s.roundId, s.player1Id, 5, { grossStrokes: 8 });
      expect(res.status).toBe(200);
      // Among logger.info calls, find the breadcrumb.
      const breadcrumb = infoSpy.mock.calls.find((call) => {
        const arg = call[0];
        return (
          arg !== null &&
          typeof arg === 'object' &&
          (arg as { event?: string }).event === 'correction_post_finalize_pending_t6'
        );
      });
      expect(breadcrumb).toBeDefined();
    } finally {
      infoSpy.mockRestore();
    }
  });

  test('AC-4 breadcrumb — non-finalized correction does NOT emit the breadcrumb', async () => {
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.scorerId);
    const { logger } = await import('../lib/log.js');
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    try {
      const res = await postCorrect(app, s.roundId, s.player1Id, 5, { grossStrokes: 8 });
      expect(res.status).toBe(200);
      const breadcrumb = infoSpy.mock.calls.find((call) => {
        const arg = call[0];
        return (
          arg !== null &&
          typeof arg === 'object' &&
          (arg as { event?: string }).event === 'correction_post_finalize_pending_t6'
        );
      });
      expect(breadcrumb).toBeUndefined();
    } finally {
      infoSpy.mockRestore();
    }
  });

  test('putts preservation — omitting putts in body keeps existing value (data loss prevention)', async () => {
    // Seeded cell has gross=4, putts=2. Correct only the gross.
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.scorerId);
    const res = await postCorrect(app, s.roundId, s.player1Id, 5, { grossStrokes: 5 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { new: { putts: number | null } };
    expect(body.new.putts).toBe(2); // PRESERVED, not nulled.
    // hole_scores reflects.
    const cell = await db.select().from(holeScores).where(eq(holeScores.id, s.cellId!));
    expect(cell[0]!.putts).toBe(2);
  });

  test('putts explicit null — clears the field intentionally', async () => {
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.scorerId);
    const res = await postCorrect(app, s.roundId, s.player1Id, 5, {
      grossStrokes: 5,
      putts: null,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { new: { putts: number | null } };
    expect(body.new.putts).toBeNull();
    const cell = await db.select().from(holeScores).where(eq(holeScores.id, s.cellId!));
    expect(cell[0]!.putts).toBeNull();
  });

  test('putts explicit number — updates the field', async () => {
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.scorerId);
    const res = await postCorrect(app, s.roundId, s.player1Id, 5, {
      grossStrokes: 5,
      putts: 3,
    });
    expect(res.status).toBe(200);
    const cell = await db.select().from(holeScores).where(eq(holeScores.id, s.cellId!));
    expect(cell[0]!.putts).toBe(3);
  });

  test('(d) 403 non-authorized — outsider', async () => {
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.outsiderId);
    const res = await postCorrect(app, s.roundId, s.player1Id, 5, { grossStrokes: 5 });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_correction');
  });

  test('(e) 403 wrong-foursome scorer — scorer of foursome 2 attempting foursome 1 correction', async () => {
    const s = await seed({ state: 'complete_editable', twoFoursomes: true });
    expect(s.foursome2ScorerId).not.toBeNull();
    const app = buildApp(s.foursome2ScorerId!);
    const res = await postCorrect(app, s.roundId, s.player1Id, 5, { grossStrokes: 5 });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_correction');
  });

  test('(f) 404 unscored cell — cannot_correct_unscored_hole', async () => {
    const s = await seed({ state: 'complete_editable', scoreCell: false });
    const app = buildApp(s.scorerId);
    const res = await postCorrect(app, s.roundId, s.player1Id, 5, { grossStrokes: 5 });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('cannot_correct_unscored_hole');
  });

  test('(g) 422 not_started → round_state_forbids_correction', async () => {
    const s = await seed({ state: 'not_started' });
    const app = buildApp(s.scorerId);
    const res = await postCorrect(app, s.roundId, s.player1Id, 5, { grossStrokes: 5 });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('round_state_forbids_correction');
  });

  test('(h) 422 cancelled → round_state_forbids_correction', async () => {
    const s = await seed({ state: 'cancelled' });
    const app = buildApp(s.scorerId);
    const res = await postCorrect(app, s.roundId, s.player1Id, 5, { grossStrokes: 5 });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('round_state_forbids_correction');
  });

  test('(i) 200 in_progress state — correction allowed', async () => {
    const s = await seed({ state: 'in_progress' });
    const app = buildApp(s.scorerId);
    const res = await postCorrect(app, s.roundId, s.player1Id, 5, { grossStrokes: 5 });
    expect(res.status).toBe(200);
  });

  test('(j) 400 invalid_round_id', async () => {
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.scorerId);
    const res = await postCorrect(app, 'not-a-uuid', s.player1Id, 5, { grossStrokes: 5 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_round_id');
  });

  test('(k) 400 invalid_player_id', async () => {
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.scorerId);
    const res = await postCorrect(app, s.roundId, 'not-a-uuid', 5, { grossStrokes: 5 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_player_id');
  });

  test('(l) 400 invalid_hole_number — out of 1-18', async () => {
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.scorerId);
    const res = await postCorrect(app, s.roundId, s.player1Id, 19, { grossStrokes: 5 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_hole_number');
  });

  test('(m) 400 invalid_body — Zod validation (grossStrokes too high)', async () => {
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.scorerId);
    const res = await postCorrect(app, s.roundId, s.player1Id, 5, { grossStrokes: 99 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  test('(p) POST auth-leak regression — outsider on NONEXISTENT roundId → 403, NOT 404', async () => {
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.outsiderId);
    const nonexistentRoundId = randomUUID();
    const res = await postCorrect(app, nonexistentRoundId, s.player1Id, 5, { grossStrokes: 5 });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_correction');
  });
});

describe('GET /api/rounds/:roundId/score-corrections', () => {
  test('(n) 200 happy path — returns history desc by createdAt', async () => {
    const s = await seed({ state: 'complete_editable' });
    const scorerApp = buildApp(s.scorerId);
    // Make 2 corrections (older + newer).
    await postCorrect(scorerApp, s.roundId, s.player1Id, 5, { grossStrokes: 5 });
    // Tiny wait so createdAt differs.
    await new Promise((r) => setTimeout(r, 5));
    await postCorrect(scorerApp, s.roundId, s.player1Id, 5, { grossStrokes: 6 });

    const res = await getHistory(scorerApp, s.roundId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; createdAt: number; newValueJson: string }>;
    };
    expect(body.items.length).toBe(2);
    // Ordered desc.
    expect(body.items[0]!.createdAt).toBeGreaterThanOrEqual(body.items[1]!.createdAt);
    // Newest correction's newValueJson reflects gross=6.
    const newestNew = JSON.parse(body.items[0]!.newValueJson) as { grossStrokes: number };
    expect(newestNew.grossStrokes).toBe(6);
  });

  test('(o) 403 non-authorized — outsider', async () => {
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.outsiderId);
    const res = await getHistory(app, s.roundId);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_correction_history');
  });

  test('(q) GET auth-leak regression — outsider on NONEXISTENT roundId → 403, NOT 200 empty list / 404', async () => {
    const s = await seed({ state: 'complete_editable' });
    const app = buildApp(s.outsiderId);
    const nonexistentRoundId = randomUUID();
    const res = await getHistory(app, nonexistentRoundId);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_correction_history');
  });
});
