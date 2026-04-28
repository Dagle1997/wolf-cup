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
} = await import('../db/schema/index.js');
const { requireScorerForRound } = await import('./require-scorer-for-round.js');
const { requestIdMiddleware } = await import('./request-id.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  // Reverse FK dependency order. CASCADE handles most but explicit truncate
  // keeps isolation loud + matches existing test convention.
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

function stubPlayerMiddleware(
  player: { id: string; isOrganizer: boolean } | undefined,
) {
  return async (c: import('hono').Context, next: () => Promise<void>) => {
    if (player !== undefined) {
      c.set('player', player);
    }
    await next();
  };
}

interface SeedResult {
  organizerId: string;
  scorerOneId: string; // scorer for foursome 1
  scorerTwoId: string; // scorer for foursome 2
  outsiderId: string; // not a scorer of any foursome
  player1Id: string; // member of foursome 1
  player2Id: string; // member of foursome 2
  eventId: string;
  eventRoundId: string;
  roundId: string;
  ctx: string;
}

async function seedFullScoringSetup(): Promise<SeedResult> {
  const now = Date.now();
  const organizerId = randomUUID();
  const scorerOneId = randomUUID();
  const scorerTwoId = randomUUID();
  const outsiderId = randomUUID();
  const player1Id = randomUUID();
  const player2Id = randomUUID();
  const eventId = randomUUID();
  const eventRoundId = randomUUID();
  const roundId = randomUUID();
  const courseId = randomUUID();
  const courseRevId = randomUUID();
  const pairing1Id = randomUUID();
  const pairing2Id = randomUUID();
  const ctx = `event:${eventId}`;

  for (const [id, isOrg, name] of [
    [organizerId, true, 'Organizer'],
    [scorerOneId, false, 'Scorer One'],
    [scorerTwoId, false, 'Scorer Two'],
    [outsiderId, false, 'Outsider'],
    [player1Id, false, 'Player One'],
    [player2Id, false, 'Player Two'],
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
    id: courseId,
    name: 'Test Course',
    clubName: 'Test Club',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX_BASE,
  });
  await db.insert(courseRevisions).values({
    id: courseRevId,
    courseId,
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
    id: eventId,
    name: 'Test Event',
    startDate: now,
    endDate: now + 86400000,
    timezone: 'America/New_York',
    organizerPlayerId: organizerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: eventRoundId,
    eventId,
    roundNumber: 1,
    roundDate: now,
    courseRevisionId: courseRevId,
    teeColor: 'blue',
    holesToPlay: 18,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  await db.insert(rounds).values({
    id: roundId,
    eventId,
    eventRoundId,
    holesToPlay: 18,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });

  // Two foursomes; player1 in foursome 1, player2 in foursome 2.
  await db.insert(pairings).values([
    {
      id: pairing1Id,
      eventRoundId,
      foursomeNumber: 1,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    },
    {
      id: pairing2Id,
      eventRoundId,
      foursomeNumber: 2,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    },
  ]);
  await db.insert(pairingMembers).values([
    {
      pairingId: pairing1Id,
      playerId: player1Id,
      slotNumber: 1,
      tenantId: TENANT_ID,
      contextId: ctx,
    },
    {
      pairingId: pairing2Id,
      playerId: player2Id,
      slotNumber: 1,
      tenantId: TENANT_ID,
      contextId: ctx,
    },
  ]);

  // Scorers: scorerOne for foursome 1, scorerTwo for foursome 2.
  await db.insert(scorerAssignments).values([
    {
      roundId,
      foursomeNumber: 1,
      scorerPlayerId: scorerOneId,
      assignedAt: now,
      assignedByPlayerId: organizerId,
      tenantId: TENANT_ID,
      contextId: ctx,
    },
    {
      roundId,
      foursomeNumber: 2,
      scorerPlayerId: scorerTwoId,
      assignedAt: now,
      assignedByPlayerId: organizerId,
      tenantId: TENANT_ID,
      contextId: ctx,
    },
  ]);

  return {
    organizerId,
    scorerOneId,
    scorerTwoId,
    outsiderId,
    player1Id,
    player2Id,
    eventId,
    eventRoundId,
    roundId,
    ctx,
  };
}

function buildApp(opts: {
  player: { id: string; isOrganizer: boolean } | undefined;
  routePath?: string; // override the route to test misuse cases
}): Hono {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.use('*', stubPlayerMiddleware(opts.player));
  const path = opts.routePath ?? '/test/:roundId/holes/:holeNumber/scores';
  app.post(path, requireScorerForRound, (c) => {
    const body = c.get('scorePostBody');
    return c.json({ ok: true, scorePostBody: body }, 200);
  });
  return app;
}

async function postScore(
  app: Hono,
  roundId: string,
  holeNumber: number | string,
  body: unknown,
): Promise<Response> {
  return await app.request(`/test/${roundId}/holes/${holeNumber}/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('require-scorer-for-round', () => {
  test('500 middleware_misuse when requireSession not ahead of it', async () => {
    const seed = await seedFullScoringSetup();
    const app = buildApp({ player: undefined });
    const res = await postScore(app, seed.roundId, 1, {
      playerId: seed.player1Id,
      grossStrokes: 4,
      clientEventId: 'evt-misuse',
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('middleware_misuse');
  });

  test('500 middleware_misuse_no_round_id when route lacks :roundId', async () => {
    const seed = await seedFullScoringSetup();
    const app = buildApp({
      player: { id: seed.scorerOneId, isOrganizer: false },
      routePath: '/no-round-id/:somethingElse/scores',
    });
    const res = await app.request(`/no-round-id/anything/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('middleware_misuse_no_round_id');
  });

  test('400 invalid_round_id when path :roundId fails UUID-shape regex', async () => {
    const seed = await seedFullScoringSetup();
    const app = buildApp({ player: { id: seed.scorerOneId, isOrganizer: false } });
    const res = await postScore(app, 'not-a-uuid', 1, {
      playerId: seed.player1Id,
      grossStrokes: 4,
      clientEventId: 'evt-bad-id',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_round_id');
  });

  test('400 invalid_hole_number when :holeNumber is not in [1,18]', async () => {
    const seed = await seedFullScoringSetup();
    const app = buildApp({ player: { id: seed.scorerOneId, isOrganizer: false } });
    const res = await postScore(app, seed.roundId, 99, {
      playerId: seed.player1Id,
      grossStrokes: 4,
      clientEventId: 'evt-bad-hole',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_hole_number');
  });

  test('400 invalid_body with reason malformed_json on non-JSON body', async () => {
    const seed = await seedFullScoringSetup();
    const app = buildApp({ player: { id: seed.scorerOneId, isOrganizer: false } });
    const res = await app.request(
      `/test/${seed.roundId}/holes/1/scores`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json{[',
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; reason?: string };
    expect(body.code).toBe('invalid_body');
    expect(body.reason).toBe('malformed_json');
  });

  test('400 invalid_body on Zod parse failure', async () => {
    const seed = await seedFullScoringSetup();
    const app = buildApp({ player: { id: seed.scorerOneId, isOrganizer: false } });
    const res = await postScore(app, seed.roundId, 1, {
      // missing playerId
      grossStrokes: 4,
      clientEventId: 'evt-bad-body',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  test('404 player_not_in_any_foursome when body.playerId not in any pairing for the round', async () => {
    const seed = await seedFullScoringSetup();
    const app = buildApp({ player: { id: seed.scorerOneId, isOrganizer: false } });
    const ghostPlayerId = randomUUID();
    // Insert the ghost player so the FK doesn't bite (otherwise we couldn't
    // even get past the body check; we want to specifically exercise the
    // foursome lookup returning 0 rows).
    await db.insert(players).values({
      id: ghostPlayerId,
      isOrganizer: false,
      createdAt: Date.now(),
      name: 'Ghost',
      tenantId: TENANT_ID,
      contextId: CTX_BASE,
    });
    const res = await postScore(app, seed.roundId, 1, {
      playerId: ghostPlayerId,
      grossStrokes: 4,
      clientEventId: 'evt-ghost',
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('player_not_in_any_foursome');
  });

  test('422 foursome_has_no_scorer when scorer_assignments row missing for the target foursome', async () => {
    const seed = await seedFullScoringSetup();
    // Wipe the foursome 1 scorer assignment.
    await db
      .delete(scorerAssignments)
      .where(eq(scorerAssignments.foursomeNumber, 1));
    const app = buildApp({ player: { id: seed.scorerTwoId, isOrganizer: false } });
    const res = await postScore(app, seed.roundId, 1, {
      playerId: seed.player1Id, // foursome 1
      grossStrokes: 4,
      clientEventId: 'evt-no-scorer',
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('foursome_has_no_scorer');
  });

  test('403 not_scorer_for_this_foursome when session is not a scorer in any foursome', async () => {
    const seed = await seedFullScoringSetup();
    const app = buildApp({ player: { id: seed.outsiderId, isOrganizer: false } });
    const res = await postScore(app, seed.roundId, 1, {
      playerId: seed.player1Id,
      grossStrokes: 4,
      clientEventId: 'evt-outsider',
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      code: string;
      currentScorerName: string | null;
    };
    expect(body.code).toBe('not_scorer_for_this_foursome');
    expect(body.currentScorerName).toBe('Scorer One');
  });

  test('403 player_not_in_your_foursome when session is scorer of foursome 1 but body.playerId is in foursome 2', async () => {
    const seed = await seedFullScoringSetup();
    const app = buildApp({ player: { id: seed.scorerOneId, isOrganizer: false } });
    const res = await postScore(app, seed.roundId, 1, {
      playerId: seed.player2Id, // member of foursome 2
      grossStrokes: 4,
      clientEventId: 'evt-cross-foursome',
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      code: string;
      currentScorerName: string | null;
    };
    expect(body.code).toBe('player_not_in_your_foursome');
    expect(body.currentScorerName).toBe('Scorer Two');
  });

  test('next() invoked when session is the assigned scorer; c.get(scorePostBody) populated', async () => {
    const seed = await seedFullScoringSetup();
    const app = buildApp({ player: { id: seed.scorerOneId, isOrganizer: false } });
    const res = await postScore(app, seed.roundId, 1, {
      playerId: seed.player1Id,
      grossStrokes: 4,
      clientEventId: 'evt-happy',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      scorePostBody: { playerId: string; grossStrokes: number; clientEventId: string };
    };
    expect(body.ok).toBe(true);
    expect(body.scorePostBody.playerId).toBe(seed.player1Id);
    expect(body.scorePostBody.grossStrokes).toBe(4);
    expect(body.scorePostBody.clientEventId).toBe('evt-happy');
  });
});

