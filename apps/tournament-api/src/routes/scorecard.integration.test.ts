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

// Private in-memory DB. NOT file::memory:?cache=shared (leaks across reused
// fork workers — T14-2 lesson) and NOT a temp file (slow under full-suite disk
// contention → spurious 5s timeouts). One client for this file ⇒ a single
// private :memory: DB shared by the test seed and the route handler (both read
// the mocked db): isolated AND fast.
vi.mock('../db/index.js', async () => {
  const client = createClient({ url: ':memory:' });
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
    c.set('session', { sessionId: 'test-session', playerId: __testPlayer.id });
    await next();
  },
}));

const { db } = await import('../db/index.js');
const {
  players,
  courses,
  courseRevisions,
  courseHoles,
  events,
  eventRounds,
  groups,
  groupMembers,
  pairings,
  pairingMembers,
  rounds,
  roundStates,
  roundPins,
  holeScores,
  holeClaimWrites,
} = await import('../db/schema/index.js');
const { scorecardRouter } = await import('./scorecard.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX = 'event:scorecard-route-test';
const PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4] as const;

interface SeedIds {
  organizerId: string;
  viewerId: string;
  targetId: string;
  outsiderId: string;
  eventId: string;
  eventRoundId: string;
  roundId: string;
  courseRevId: string;
}

async function seed(opts: { holesToPlay?: 9 | 18 } = {}): Promise<SeedIds> {
  const now = Date.now();
  const ids: SeedIds = {
    organizerId: randomUUID(),
    viewerId: randomUUID(),
    targetId: randomUUID(),
    outsiderId: randomUUID(),
    eventId: randomUUID(),
    eventRoundId: randomUUID(),
    roundId: randomUUID(),
    courseRevId: randomUUID(),
  };
  const courseId = randomUUID();
  const groupId = randomUUID();
  const pairingId = randomUUID();
  const holesToPlay = opts.holesToPlay ?? 18;

  for (const [id, name, isOrg] of [
    [ids.organizerId, 'Organizer', true],
    [ids.viewerId, 'Viewer', false],
    [ids.targetId, 'Target', false],
    [ids.outsiderId, 'Outsider', false],
  ] as const) {
    await db.insert(players).values({
      id,
      isOrganizer: isOrg,
      createdAt: now,
      name,
      manualHandicapIndex: null,
      tenantId: TENANT_ID,
      contextId: CTX,
    });
  }

  await db.insert(courses).values({
    id: courseId,
    name: 'Test Course',
    clubName: 'Test Club',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  await db.insert(courseRevisions).values({
    id: ids.courseRevId,
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
    contextId: CTX,
  });
  for (let n = 1; n <= 18; n++) {
    await db.insert(courseHoles).values({
      id: randomUUID(),
      courseRevisionId: ids.courseRevId,
      holeNumber: n,
      par: PARS[n - 1]!,
      si: n,
      yardagePerTeeJson: '{}',
      tenantId: TENANT_ID,
      contextId: CTX,
    });
  }
  await db.insert(events).values({
    id: ids.eventId,
    name: 'Test Event',
    startDate: now,
    endDate: now + 86400000,
    timezone: 'America/New_York',
    organizerPlayerId: ids.organizerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  await db.insert(eventRounds).values({
    id: ids.eventRoundId,
    eventId: ids.eventId,
    roundNumber: 1,
    roundDate: now,
    courseRevisionId: ids.courseRevId,
    teeColor: 'blue',
    holesToPlay,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  await db.insert(rounds).values({
    id: ids.roundId,
    eventId: ids.eventId,
    eventRoundId: ids.eventRoundId,
    holesToPlay,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  await db.insert(roundStates).values({
    roundId: ids.roundId,
    state: 'in_progress',
    enteredAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  // Event roster: viewer + target are group members; outsider is NOT.
  await db.insert(groups).values({
    id: groupId,
    eventId: ids.eventId,
    name: 'Roster',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  await db.insert(groupMembers).values([
    { groupId, playerId: ids.viewerId, tenantId: TENANT_ID, contextId: CTX },
    { groupId, playerId: ids.targetId, tenantId: TENANT_ID, contextId: CTX },
  ]);
  // Pairing: target + viewer are in the round.
  await db.insert(pairings).values({
    id: pairingId,
    eventRoundId: ids.eventRoundId,
    foursomeNumber: 1,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  await db.insert(pairingMembers).values([
    { pairingId, playerId: ids.targetId, slotNumber: 1, tenantId: TENANT_ID, contextId: CTX },
    { pairingId, playerId: ids.viewerId, slotNumber: 2, tenantId: TENANT_ID, contextId: CTX },
  ]);
  return ids;
}

function buildApp(callerId: string, isOrganizer = false): Hono {
  __testPlayer = { id: callerId, isOrganizer };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/rounds', scorecardRouter);
  return app;
}

function url(roundId: string, playerId: string): string {
  return `/api/rounds/${roundId}/players/${playerId}/scorecard`;
}

interface ScorecardHole {
  holeNumber: number;
  par: number;
  grossScore: number | null;
  netScore: number | null;
  relativeStrokes: number;
  hasGreenie: boolean;
  hasPolie: boolean;
  hasSandie: boolean;
  moneyNet: number | null;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(holeClaimWrites);
  await db.delete(holeScores);
  await db.delete(roundPins);
  await db.delete(roundStates);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseHoles);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

describe('GET /api/rounds/:roundId/players/:playerId/scorecard', () => {
  test('200 happy path: participant views a target with pinned strokes + a played hole + a claim', async () => {
    const s = await seed();
    const now = Date.now();
    await db.insert(roundPins).values({
      roundId: s.roundId,
      resolvedConfigJson: '{}',
      seedRuleSetRevisionId: null,
      courseRevisionId: s.courseRevId,
      tee: 'blue',
      perPlayerHandicapsJson: JSON.stringify({ [s.targetId]: { hi: 5, ch: 5 } }),
      teamCompositionJson: null,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: CTX,
    });
    await db.insert(holeScores).values({
      id: randomUUID(),
      roundId: s.roundId,
      playerId: s.targetId,
      holeNumber: 1,
      grossStrokes: 5,
      putts: null,
      scorerPlayerId: s.viewerId,
      clientEventId: 'rt-1',
      createdAt: now,
      updatedAt: now,
      tenantId: TENANT_ID,
      contextId: CTX,
    });
    await db.insert(holeClaimWrites).values({
      id: randomUUID(),
      roundId: s.roundId,
      playerId: s.targetId,
      holeNumber: 1,
      claimType: 'greenie',
      op: 'set',
      scorerPlayerId: s.viewerId,
      clientEventId: 'claim-rt-1',
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: CTX,
    });

    const app = buildApp(s.viewerId);
    const res = await app.request(url(s.roundId, s.targetId), { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { holes: ScorecardHole[] };
    expect(body.holes).toHaveLength(18);
    const h1 = body.holes.find((h) => h.holeNumber === 1)!;
    expect(h1.grossScore).toBe(5);
    expect(h1.relativeStrokes).toBe(1); // si1 ≤ ch5
    expect(h1.netScore).toBe(4);
    expect(h1.hasGreenie).toBe(true);
    expect(h1.moneyNet).toBeNull();
    // Live-board freshness: responses must not be cached (Story 3-4 polls this).
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  test('200 the event organizer (not a group member) may view (T13-1 exemption)', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId, true);
    const res = await app.request(url(s.roundId, s.targetId), { method: 'GET' });
    expect(res.status).toBe(200);
  });

  test('403 not_event_participant: signed-in non-participant, non-organizer', async () => {
    const s = await seed();
    const app = buildApp(s.outsiderId);
    const res = await app.request(url(s.roundId, s.targetId), { method: 'GET' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });

  test('404 round_not_found: nonexistent round', async () => {
    const s = await seed();
    const app = buildApp(s.viewerId);
    const res = await app.request(url(randomUUID(), s.targetId), { method: 'GET' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('round_not_found');
  });

  test('404 round_not_found: foreign-tenant round', async () => {
    const s = await seed();
    await db.update(rounds).set({ tenantId: 'foreign' }).where(eq(rounds.id, s.roundId));
    const app = buildApp(s.viewerId);
    const res = await app.request(url(s.roundId, s.targetId), { method: 'GET' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('round_not_found');
  });

  test('404 player_not_in_round: target is not in the round pairings', async () => {
    const s = await seed();
    const app = buildApp(s.viewerId);
    // outsider is a valid player UUID but not a pairing member of this round.
    const res = await app.request(url(s.roundId, s.outsiderId), { method: 'GET' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('player_not_in_round');
  });

  test('200 9-hole round returns exactly 9 holes', async () => {
    const s = await seed({ holesToPlay: 9 });
    const app = buildApp(s.viewerId);
    const res = await app.request(url(s.roundId, s.targetId), { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { holes: ScorecardHole[] };
    expect(body.holes).toHaveLength(9);
    expect(body.holes.map((h) => h.holeNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('400 invalid_round_id / invalid_player_id on non-UUID path params', async () => {
    const s = await seed();
    const app = buildApp(s.viewerId);
    const r1 = await app.request(url('not-a-uuid', s.targetId), { method: 'GET' });
    expect(r1.status).toBe(400);
    expect(((await r1.json()) as { code: string }).code).toBe('invalid_round_id');
    const r2 = await app.request(url(s.roundId, 'not-a-uuid'), { method: 'GET' });
    expect(r2.status).toBe(400);
    expect(((await r2.json()) as { code: string }).code).toBe('invalid_player_id');
  });
});
