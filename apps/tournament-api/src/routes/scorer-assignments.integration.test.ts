/**
 * T5-7 scorer-handoff endpoint integration tests.
 *
 * 14 cases per AC-10 (a)–(n). Mirrors the in-memory libsql + migrate
 * pattern from `apps/tournament-api/src/routes/scores.integration.test.ts`.
 *
 * (a) 200 happy path — current scorer transfers to a foursome member.
 * (b) 200 organizer-recovery path — event organizer transfers.
 * (c) 403 not_authorized_for_handoff — non-scorer non-organizer.
 * (d) 422 assignee_not_in_foursome — toPlayerId not in target foursome.
 * (e) 422 round_finalized.
 * (f) 422 round_cancelled.
 * (g) 400 invalid_round_id — malformed UUID.
 * (h) 400 invalid_body — missing fields.
 * (i) Stale-queue scenario — POST a score AS the prior scorer after
 *     handoff; T5-6 middleware returns 403 with `currentScorerName`
 *     populated for the new scorer.
 * (j) Audit-row assertion — exactly one new scorer.transferred row.
 * (k) 422 round_state_missing.
 * (l) 422 foursome_has_no_scorer — no scorer_assignments row.
 * (m) 403 global-isOrganizer-but-not-event-organizer.
 * (n) 403 scorer-of-different-foursome.
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
const { scorerAssignmentsRouter } = await import('./scorer-assignments.js');
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
  /** Round state to seed; default 'in_progress'. Pass 'NONE' to skip the row. */
  state?:
    | 'not_started'
    | 'in_progress'
    | 'complete_editable'
    | 'finalized'
    | 'cancelled'
    | 'NONE';
  /** If true, do NOT seed scorer_assignments (case (l)). */
  noScorerAssignment?: boolean;
  /** If true, seed a SECOND foursome (for case (n)). Default false. */
  twoFoursomes?: boolean;
}

interface SeedResult {
  organizerId: string;
  /** Current scorer of foursome 1. */
  scorerId: string;
  player1Id: string;
  player2Id: string;
  /** Player who is in foursome 1 but NOT scorer; valid handoff target. */
  inFoursomeNonScorerId: string;
  /** Player not in any foursome; for invalid-assignee tests. */
  outsiderId: string;
  /** Player with players.is_organizer=true but NOT events.organizer_player_id. */
  globalOrgNonEventOrgId: string;
  /** Scorer of foursome 2 (only when twoFoursomes=true). */
  foursome2ScorerId: string | null;
  eventId: string;
  eventRoundId: string;
  roundId: string;
}

async function seed(opts: SeedOpts = {}): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    scorerId: randomUUID(),
    player1Id: randomUUID(),
    player2Id: randomUUID(),
    inFoursomeNonScorerId: randomUUID(),
    outsiderId: randomUUID(),
    globalOrgNonEventOrgId: randomUUID(),
    foursome2ScorerId: opts.twoFoursomes ? randomUUID() : null,
    foursome2P2Id: opts.twoFoursomes ? randomUUID() : null,
    eventId: randomUUID(),
    eventRoundId: randomUUID(),
    roundId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    pairingId: randomUUID(),
    pairing2Id: opts.twoFoursomes ? randomUUID() : null,
  };
  const ctx = `event:${ids.eventId}`;

  // Players
  const playerSeeds: Array<readonly [string, string, boolean]> = [
    [ids.organizerId, 'Organizer', false], // event organizer (not global)
    [ids.scorerId, 'Scorer', false],
    [ids.player1Id, 'Player1', false],
    [ids.player2Id, 'Player2', false],
    [ids.inFoursomeNonScorerId, 'NonScorerMember', false],
    [ids.outsiderId, 'Outsider', false],
    [ids.globalOrgNonEventOrgId, 'GlobalOrgNonEvent', true], // is_organizer=true
  ];
  if (ids.foursome2ScorerId) {
    playerSeeds.push([ids.foursome2ScorerId, 'Foursome2Scorer', false]);
  }
  if (ids.foursome2P2Id) {
    playerSeeds.push([ids.foursome2P2Id, 'Foursome2P2', false]);
  }
  for (const [id, name, isOrg] of playerSeeds) {
    await db.insert(players).values({
      id,
      isOrganizer: isOrg,
      createdAt: now,
      name,
      tenantId: TENANT_ID,
      contextId: CTX_BASE,
    });
  }

  // Course + revision
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

  // Event (organizer = ids.organizerId)
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

  // Event round + round
  await db.insert(eventRounds).values({
    id: ids.eventRoundId,
    eventId: ids.eventId,
    roundNumber: 1,
    roundDate: now,
    courseRevisionId: ids.courseRevId,
    teeColor: 'blue',
    holesToPlay: 18,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  await db.insert(rounds).values({
    id: ids.roundId,
    eventId: ids.eventId,
    eventRoundId: ids.eventRoundId,
    holesToPlay: 18,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });

  // Round state (skip if 'NONE' for case (k))
  if (opts.state !== 'NONE') {
    await db.insert(roundStates).values({
      roundId: ids.roundId,
      state: opts.state ?? 'in_progress',
      enteredAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
  }

  // Foursome 1: scorerId, player1Id, player2Id, inFoursomeNonScorerId
  await db.insert(pairings).values({
    id: ids.pairingId,
    eventRoundId: ids.eventRoundId,
    foursomeNumber: 1,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  const f1Members: Array<[string, number]> = [
    [ids.scorerId, 1],
    [ids.player1Id, 2],
    [ids.player2Id, 3],
    [ids.inFoursomeNonScorerId, 4],
  ];
  for (const [pid, slot] of f1Members) {
    await db.insert(pairingMembers).values({
      pairingId: ids.pairingId,
      playerId: pid,
      slotNumber: slot,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
  }

  // Optional foursome 2
  if (opts.twoFoursomes && ids.pairing2Id && ids.foursome2ScorerId && ids.foursome2P2Id) {
    await db.insert(pairings).values({
      id: ids.pairing2Id,
      eventRoundId: ids.eventRoundId,
      foursomeNumber: 2,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    await db.insert(pairingMembers).values({
      pairingId: ids.pairing2Id,
      playerId: ids.foursome2ScorerId,
      slotNumber: 1,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    await db.insert(pairingMembers).values({
      pairingId: ids.pairing2Id,
      playerId: ids.foursome2P2Id,
      slotNumber: 2,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
  }

  // Scorer assignments (skip foursome-1's row for case (l))
  if (!opts.noScorerAssignment) {
    await db.insert(scorerAssignments).values({
      roundId: ids.roundId,
      foursomeNumber: 1,
      scorerPlayerId: ids.scorerId,
      assignedAt: now,
      assignedByPlayerId: ids.organizerId,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
  }
  if (opts.twoFoursomes && ids.foursome2ScorerId) {
    await db.insert(scorerAssignments).values({
      roundId: ids.roundId,
      foursomeNumber: 2,
      scorerPlayerId: ids.foursome2ScorerId,
      assignedAt: now,
      assignedByPlayerId: ids.organizerId,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
  }

  return {
    organizerId: ids.organizerId,
    scorerId: ids.scorerId,
    player1Id: ids.player1Id,
    player2Id: ids.player2Id,
    inFoursomeNonScorerId: ids.inFoursomeNonScorerId,
    outsiderId: ids.outsiderId,
    globalOrgNonEventOrgId: ids.globalOrgNonEventOrgId,
    foursome2ScorerId: ids.foursome2ScorerId,
    eventId: ids.eventId,
    eventRoundId: ids.eventRoundId,
    roundId: ids.roundId,
  };
}

function buildApp(playerId: string, isGlobalOrganizer = false): Hono {
  __testPlayer = { id: playerId, isOrganizer: isGlobalOrganizer };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/rounds', scorerAssignmentsRouter);
  app.route('/api/rounds', scoresRouter);
  return app;
}

async function postTransfer(
  app: Hono,
  roundId: string,
  body: unknown,
): Promise<Response> {
  return await app.request(
    `/api/rounds/${roundId}/scorer-assignments/transfer`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('POST /api/rounds/:roundId/scorer-assignments/transfer', () => {
  test('(a) 200 happy path — current scorer transfers to a foursome member', async () => {
    const s = await seed();
    const app = buildApp(s.scorerId);

    const res = await postTransfer(app, s.roundId, {
      foursomeNumber: 1,
      toPlayerId: s.inFoursomeNonScorerId,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      foursomeNumber: number;
      fromPlayerId: string;
      toPlayerId: string;
      assignedAt: number;
    };
    expect(body.ok).toBe(true);
    expect(body.foursomeNumber).toBe(1);
    expect(body.fromPlayerId).toBe(s.scorerId);
    expect(body.toPlayerId).toBe(s.inFoursomeNonScorerId);
    expect(typeof body.assignedAt).toBe('number');

    // Persistence: scorer_assignments row reflects the new scorer.
    const row = await db
      .select()
      .from(scorerAssignments)
      .where(
        and(
          eq(scorerAssignments.roundId, s.roundId),
          eq(scorerAssignments.foursomeNumber, 1),
        ),
      );
    expect(row.length).toBe(1);
    expect(row[0]!.scorerPlayerId).toBe(s.inFoursomeNonScorerId);
    expect(row[0]!.assignedByPlayerId).toBe(s.scorerId);
  });

  test('(b) 200 organizer-recovery path — event organizer transfers', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);

    const res = await postTransfer(app, s.roundId, {
      foursomeNumber: 1,
      toPlayerId: s.player1Id,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      fromPlayerId: string;
      toPlayerId: string;
    };
    expect(body.fromPlayerId).toBe(s.scorerId);
    expect(body.toPlayerId).toBe(s.player1Id);

    const row = await db
      .select()
      .from(scorerAssignments)
      .where(eq(scorerAssignments.roundId, s.roundId));
    expect(row[0]!.scorerPlayerId).toBe(s.player1Id);
    expect(row[0]!.assignedByPlayerId).toBe(s.organizerId);
  });

  test('(c) 403 not_authorized_for_handoff — non-scorer non-organizer', async () => {
    const s = await seed();
    const app = buildApp(s.player1Id); // member of foursome but not scorer

    const res = await postTransfer(app, s.roundId, {
      foursomeNumber: 1,
      toPlayerId: s.player2Id,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_handoff');

    // Verify NO update happened.
    const row = await db
      .select()
      .from(scorerAssignments)
      .where(eq(scorerAssignments.roundId, s.roundId));
    expect(row[0]!.scorerPlayerId).toBe(s.scorerId);
  });

  test('(d) 422 assignee_not_in_foursome — toPlayerId not a member', async () => {
    const s = await seed();
    const app = buildApp(s.scorerId);

    const res = await postTransfer(app, s.roundId, {
      foursomeNumber: 1,
      toPlayerId: s.outsiderId,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('assignee_not_in_foursome');
  });

  test('(e) 422 round_finalized', async () => {
    const s = await seed({ state: 'finalized' });
    const app = buildApp(s.scorerId);

    const res = await postTransfer(app, s.roundId, {
      foursomeNumber: 1,
      toPlayerId: s.player1Id,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('round_finalized');
  });

  test('(f) 422 round_cancelled', async () => {
    const s = await seed({ state: 'cancelled' });
    const app = buildApp(s.scorerId);

    const res = await postTransfer(app, s.roundId, {
      foursomeNumber: 1,
      toPlayerId: s.player1Id,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('round_cancelled');
  });

  test('(g) 400 invalid_round_id — malformed UUID', async () => {
    const s = await seed();
    const app = buildApp(s.scorerId);

    const res = await postTransfer(app, 'not-a-uuid', {
      foursomeNumber: 1,
      toPlayerId: s.player1Id,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_round_id');
  });

  test('(h) 400 invalid_body — missing fields', async () => {
    const s = await seed();
    const app = buildApp(s.scorerId);

    const res = await postTransfer(app, s.roundId, { foursomeNumber: 1 }); // missing toPlayerId
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  test('(i) Group-member gate — prior scorer (a foursome member) can STILL score after handoff (Josh 2026-06-28)', async () => {
    // Behavior change: the group-member gate trusts ANY verified member of a
    // foursome to write for that group (their join code binds them to the
    // roster + handicap), and every write is audit-logged. A handoff re-points
    // the designated-scorer pointer (which still matters for an organizer who
    // isn't a foursome member), but it no longer LOCKS OUT a member who was the
    // prior scorer. The old single-writer stale-queue 403 only applies to a
    // non-member designated scorer now.
    const s = await seed();

    // Step 1: transfer scorer from scorerId → inFoursomeNonScorerId.
    const transferRes = await postTransfer(
      buildApp(s.scorerId),
      s.roundId,
      { foursomeNumber: 1, toPlayerId: s.inFoursomeNonScorerId },
    );
    expect(transferRes.status).toBe(200);

    // Step 2: prior scorer (scorerId) is a member of foursome 1, so they can
    // still POST a score for a groupmate — membership IS the authorization.
    const priorScorerApp = buildApp(s.scorerId);
    const scoreRes = await priorScorerApp.request(
      `/api/rounds/${s.roundId}/holes/1/scores`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: s.player1Id,
          grossStrokes: 4,
          clientEventId: 'evt-stale',
        }),
      },
    );
    expect(scoreRes.status).toBe(201);
  });

  test('(j) Audit-row assertion — exactly one scorer.transferred row after happy path', async () => {
    const s = await seed();
    const app = buildApp(s.scorerId);

    const before = await db.select().from(auditLog);
    expect(before.length).toBe(0);

    await postTransfer(app, s.roundId, {
      foursomeNumber: 1,
      toPlayerId: s.player1Id,
    });

    const after = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'scorer.transferred'));
    expect(after.length).toBe(1);
    const row = after[0]!;
    expect(row.entityId).toBe(s.roundId);
    expect(row.actorPlayerId).toBe(s.scorerId);
    const payload = JSON.parse(row.payloadJson) as {
      foursomeNumber: number;
      fromPlayerId: string;
      toPlayerId: string;
      assignedAt: number;
    };
    expect(payload.foursomeNumber).toBe(1);
    expect(payload.fromPlayerId).toBe(s.scorerId);
    expect(payload.toPlayerId).toBe(s.player1Id);
    expect(typeof payload.assignedAt).toBe('number');
  });

  test('(k) 422 round_state_missing — rounds row exists but no round_states row', async () => {
    const s = await seed({ state: 'NONE' });
    const app = buildApp(s.scorerId);

    const res = await postTransfer(app, s.roundId, {
      foursomeNumber: 1,
      toPlayerId: s.player1Id,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('round_state_missing');
  });

  test('(l) 422 foursome_has_no_scorer — pre-existing scorer_assignments row absent', async () => {
    const s = await seed({ noScorerAssignment: true });
    // Caller is the event organizer (always authorized regardless of scorer state).
    const app = buildApp(s.organizerId);

    const res = await postTransfer(app, s.roundId, {
      foursomeNumber: 1,
      toPlayerId: s.player1Id,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('foursome_has_no_scorer');

    // Verify NO row was inserted (this endpoint does NOT create new
    // assignments; T5-7 only transfers existing ones).
    const rows = await db
      .select()
      .from(scorerAssignments)
      .where(eq(scorerAssignments.roundId, s.roundId));
    expect(rows.length).toBe(0);
  });

  test('(m) 403 global-isOrganizer-but-not-event-organizer', async () => {
    const s = await seed();
    // globalOrgNonEventOrgId: players.is_organizer=true but NOT events.organizer_player_id.
    const app = buildApp(s.globalOrgNonEventOrgId, /* isGlobalOrganizer */ true);

    const res = await postTransfer(app, s.roundId, {
      foursomeNumber: 1,
      toPlayerId: s.player1Id,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_handoff');
  });

  test('(o) organizer-also-scorer: when caller is BOTH event organizer AND current scorer, organizer-path is preferred (override semantics)', async () => {
    // Reseed with the event organizer ALSO assigned as foursome-1 scorer.
    const s = await seed();
    // Re-point scorer_assignments.scorer_player_id to the organizer.
    await db
      .update(scorerAssignments)
      .set({ scorerPlayerId: s.organizerId })
      .where(
        and(
          eq(scorerAssignments.roundId, s.roundId),
          eq(scorerAssignments.foursomeNumber, 1),
        ),
      );

    const app = buildApp(s.organizerId);
    const res = await postTransfer(app, s.roundId, {
      foursomeNumber: 1,
      toPlayerId: s.player1Id,
    });
    // Must succeed; organizer-path is permissive (no narrowing predicate).
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fromPlayerId: string };
    expect(body.fromPlayerId).toBe(s.organizerId);
  });

  test('(n) 403 scorer-of-different-foursome — scorer of foursome 2 cannot transfer foursome 1', async () => {
    const s = await seed({ twoFoursomes: true });
    expect(s.foursome2ScorerId).not.toBeNull();
    const app = buildApp(s.foursome2ScorerId!);

    const res = await postTransfer(app, s.roundId, {
      foursomeNumber: 1, // attempting to transfer FOURSOME 1 (not their own)
      toPlayerId: s.player1Id,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_handoff');

    // Verify foursome 1's scorer assignment is unchanged.
    const f1 = await db
      .select()
      .from(scorerAssignments)
      .where(
        and(
          eq(scorerAssignments.roundId, s.roundId),
          eq(scorerAssignments.foursomeNumber, 1),
        ),
      );
    expect(f1[0]!.scorerPlayerId).toBe(s.scorerId);
  });
});
