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
  roundPins,
  roundStates,
  scorerAssignments,
  holeScores,
} = await import('../db/schema/index.js');
const { scoresRouter } = await import('./scores.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(holeScores);
  await db.delete(roundPins);
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
  state?: 'not_started' | 'in_progress' | 'complete_editable' | 'finalized' | 'cancelled';
  holesToPlay?: 9 | 18;
  skipScorerAssignment?: boolean;
  skipRoundState?: boolean;
}

interface SeedResult {
  organizerId: string;
  scorerId: string;
  player1Id: string;
  player2Id: string;
  outsiderId: string;
  eventId: string;
  eventRoundId: string;
  roundId: string;
  courseRevId: string;
  ctx: string;
}

async function seed(opts: SeedOpts = {}): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    scorerId: randomUUID(),
    player1Id: randomUUID(),
    player2Id: randomUUID(),
    outsiderId: randomUUID(),
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
    [ids.outsiderId, false, 'Outsider'],
  ] as const) {
    await db.insert(players).values({
      id,
      isOrganizer: isOrg,
      createdAt: now,
      name,
      manualHandicapIndex: name === 'Scorer' ? 12 : null,
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
  if (!opts.skipRoundState) {
    await db.insert(roundStates).values({
      roundId: ids.roundId,
      state: opts.state ?? 'not_started',
      enteredAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
  }
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
      playerId: ids.scorerId,
      slotNumber: 1,
      tenantId: TENANT_ID,
      contextId: ctx,
    },
    {
      pairingId: ids.pairingId,
      playerId: ids.player1Id,
      slotNumber: 2,
      tenantId: TENANT_ID,
      contextId: ctx,
    },
    {
      pairingId: ids.pairingId,
      playerId: ids.player2Id,
      slotNumber: 3,
      tenantId: TENANT_ID,
      contextId: ctx,
    },
  ]);
  if (!opts.skipScorerAssignment) {
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

  return {
    organizerId: ids.organizerId,
    scorerId: ids.scorerId,
    player1Id: ids.player1Id,
    player2Id: ids.player2Id,
    outsiderId: ids.outsiderId,
    eventId: ids.eventId,
    eventRoundId: ids.eventRoundId,
    roundId: ids.roundId,
    courseRevId: ids.courseRevId,
    ctx,
  };
}

function buildApp(playerId: string): Hono {
  __testPlayer = { id: playerId, isOrganizer: false };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/rounds', scoresRouter);
  return app;
}

async function getRoundDetail(app: Hono, roundId: string): Promise<Response> {
  return await app.request(`/api/rounds/${roundId}`, { method: 'GET' });
}

describe('GET /api/rounds/:roundId', () => {
  test('200 happy path: scorer + members (slot_number ASC) + scorerName + holesToPlay + state', async () => {
    const s = await seed({ state: 'in_progress' });
    const app = buildApp(s.scorerId);
    const res = await getRoundDetail(app, s.roundId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      roundId: string;
      state: string;
      holesToPlay: number;
      myFoursome: {
        foursomeNumber: number;
        isScorer: boolean;
        scorerPlayerId: string;
        scorerName: string;
        members: Array<{ playerId: string; name: string; handicapIndex: number | null; courseHandicap: number | null }>;
        holeScores: unknown[];
      };
    };
    expect(body.state).toBe('in_progress');
    expect(body.holesToPlay).toBe(18);
    expect(body.myFoursome.foursomeNumber).toBe(1);
    expect(body.myFoursome.isScorer).toBe(true);
    expect(body.myFoursome.scorerPlayerId).toBe(s.scorerId);
    expect(body.myFoursome.scorerName).toBe('Scorer');
    // Members ordered by slot_number ASC: scorer (slot 1), p1 (slot 2), p2 (slot 3).
    expect(body.myFoursome.members.map((m) => m.name)).toEqual([
      'Scorer',
      'Player One',
      'Player Two',
    ]);
    // Scorer's manualHandicapIndex was set to 12; others null.
    expect(body.myFoursome.members[0]!.handicapIndex).toBe(12);
    expect(body.myFoursome.members[1]!.handicapIndex).toBeNull();
    // No round pin in this fixture → course handicap is null (HI-only display).
    expect(body.myFoursome.members[0]!.courseHandicap).toBeNull();
  });

  test('200: members carry the PINNED course handicap when the round is pinned', async () => {
    const s = await seed({ state: 'in_progress' });
    // Pin per-player handicaps: scorer ch=10, player1 ch=null (no handicap),
    // player2 ch=18. courseHandicap must reflect the pin's `ch`, not recompute.
    await db.insert(roundPins).values({
      roundId: s.roundId,
      resolvedConfigJson: '{}',
      seedRuleSetRevisionId: null,
      courseRevisionId: s.courseRevId,
      tee: 'blue',
      perPlayerHandicapsJson: JSON.stringify({
        [s.scorerId]: { hi: 12, ch: 10 },
        [s.player1Id]: { hi: null, ch: null },
        [s.player2Id]: { hi: 15, ch: 18 },
      }),
      teamCompositionJson: null,
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: s.ctx,
    });
    const app = buildApp(s.scorerId);
    const res = await getRoundDetail(app, s.roundId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      myFoursome: { members: Array<{ name: string; courseHandicap: number | null }> };
    };
    // Slot order: Scorer (1), Player One (2), Player Two (3).
    expect(body.myFoursome.members[0]!.courseHandicap).toBe(10);
    expect(body.myFoursome.members[1]!.courseHandicap).toBeNull();
    expect(body.myFoursome.members[2]!.courseHandicap).toBe(18);
  });

  test('enabledClaimTypes: null when the round is un-pinned (non-F1 / not started)', async () => {
    const s = await seed({ state: 'in_progress' });
    const app = buildApp(s.scorerId);
    const res = await getRoundDetail(app, s.roundId);
    const body = (await res.json()) as { myFoursome: { enabledClaimTypes: unknown } };
    // No pin → client falls back to showing all three claim buttons (no regression).
    expect(body.myFoursome.enabledClaimTypes).toBeNull();
  });

  test('enabledClaimTypes: null when the pinned config is unparseable', async () => {
    const s = await seed({ state: 'in_progress' });
    await db.insert(roundPins).values({
      roundId: s.roundId,
      resolvedConfigJson: '{}', // not a valid GameConfig → parse fails → null
      seedRuleSetRevisionId: null,
      courseRevisionId: s.courseRevId,
      tee: 'blue',
      perPlayerHandicapsJson: JSON.stringify({ [s.scorerId]: { hi: 12, ch: 10 } }),
      teamCompositionJson: null,
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: s.ctx,
    });
    const app = buildApp(s.scorerId);
    const res = await getRoundDetail(app, s.roundId);
    const body = (await res.json()) as { myFoursome: { enabledClaimTypes: unknown } };
    expect(body.myFoursome.enabledClaimTypes).toBeNull();
  });

  test('enabledClaimTypes: reflects ONLY the enabled claim-modifiers from the pinned config', async () => {
    const s = await seed({ state: 'in_progress' });
    // greenie + sandie ON, polie OFF; net-skins is ON but is NOT a claim-type, so
    // it must not appear in enabledClaimTypes.
    await db.insert(roundPins).values({
      roundId: s.roundId,
      resolvedConfigJson: JSON.stringify({
        game: 'guyan-2v2',
        pointValueSchedule: { kind: 'flat', cents: 500 },
        modifiers: [
          { type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } },
          { type: 'greenie', enabled: true, variant: { carryover: true } },
          { type: 'polie', enabled: false },
          { type: 'sandie', enabled: true },
        ],
        lockState: 'locked',
        configVersion: 1,
      }),
      seedRuleSetRevisionId: null,
      courseRevisionId: s.courseRevId,
      tee: 'blue',
      perPlayerHandicapsJson: JSON.stringify({ [s.scorerId]: { hi: 12, ch: 10 } }),
      teamCompositionJson: null,
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: s.ctx,
    });
    const app = buildApp(s.scorerId);
    const res = await getRoundDetail(app, s.roundId);
    const body = (await res.json()) as { myFoursome: { enabledClaimTypes: string[] } };
    // Stable order greenie→polie→sandie; polie excluded (off), net-skins excluded (not a claim).
    expect(body.myFoursome.enabledClaimTypes).toEqual(['greenie', 'sandie']);
  });

  test('200 non-scorer participant: isScorer=false but scorer info populated', async () => {
    const s = await seed({ state: 'not_started' });
    const app = buildApp(s.player1Id);
    const res = await getRoundDetail(app, s.roundId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      myFoursome: { isScorer: boolean; scorerPlayerId: string; scorerName: string };
    };
    expect(body.myFoursome.isScorer).toBe(false);
    expect(body.myFoursome.scorerPlayerId).toBe(s.scorerId);
    expect(body.myFoursome.scorerName).toBe('Scorer');
  });

  test('404 round_not_found when session is not in any foursome (uniform with foreign-tenant)', async () => {
    const s = await seed({ state: 'not_started' });
    const app = buildApp(s.outsiderId);
    const res = await getRoundDetail(app, s.roundId);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('round_not_found');
  });

  test('200 with hole_scores populated', async () => {
    const s = await seed({ state: 'in_progress' });
    const now = Date.now();
    // Pre-seed 3 cells for player1.
    for (let h = 1; h <= 3; h++) {
      await db.insert(holeScores).values({
        id: randomUUID(),
        roundId: s.roundId,
        playerId: s.player1Id,
        holeNumber: h,
        grossStrokes: 4,
        putts: null,
        scorerPlayerId: s.scorerId,
        clientEventId: `pre-${h}`,
        createdAt: now,
        updatedAt: now,
        tenantId: TENANT_ID,
        contextId: s.ctx,
      });
    }
    const app = buildApp(s.scorerId);
    const res = await getRoundDetail(app, s.roundId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      myFoursome: { holeScores: Array<{ holeNumber: number; playerId: string }> };
    };
    expect(body.myFoursome.holeScores.length).toBe(3);
    expect(body.myFoursome.holeScores.map((hs) => hs.holeNumber).sort()).toEqual([1, 2, 3]);
  });

  test('200 state=finalized reflects round_states.state', async () => {
    const s = await seed({ state: 'finalized' });
    const app = buildApp(s.scorerId);
    const res = await getRoundDetail(app, s.roundId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string };
    expect(body.state).toBe('finalized');
  });

  test('200 holes_to_play=9 returns holesToPlay: 9', async () => {
    const s = await seed({ state: 'not_started', holesToPlay: 9 });
    const app = buildApp(s.scorerId);
    const res = await getRoundDetail(app, s.roundId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { holesToPlay: number };
    expect(body.holesToPlay).toBe(9);
  });

  test('200 no-scorer-yet: scorerPlayerId/scorerName null, isScorer false', async () => {
    const s = await seed({ state: 'not_started', skipScorerAssignment: true });
    const app = buildApp(s.player1Id);
    const res = await getRoundDetail(app, s.roundId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      myFoursome: {
        isScorer: boolean;
        scorerPlayerId: string | null;
        scorerName: string | null;
      };
    };
    expect(body.myFoursome.isScorer).toBe(false);
    expect(body.myFoursome.scorerPlayerId).toBeNull();
    expect(body.myFoursome.scorerName).toBeNull();
  });

  test('422 round_state_missing when round_states row absent', async () => {
    const s = await seed({ skipRoundState: true });
    const app = buildApp(s.scorerId);
    const res = await getRoundDetail(app, s.roundId);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('round_state_missing');
  });

  test('400 invalid_round_id: non-UUID path param', async () => {
    const s = await seed({ state: 'not_started' });
    const app = buildApp(s.scorerId);
    const res = await getRoundDetail(app, 'not-a-uuid');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_round_id');
  });

  test('404 round_not_found: foreign-tenant round (byte-identical body to non-participant)', async () => {
    const s = await seed({ state: 'not_started' });
    await db
      .update(rounds)
      .set({ tenantId: 'foreign-tenant' })
      .where(eq(rounds.id, s.roundId));
    const app = buildApp(s.scorerId);
    const res = await getRoundDetail(app, s.roundId);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('round_not_found');
    expect(body.error).toBe('not_found');
  });
});
