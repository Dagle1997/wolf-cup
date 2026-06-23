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
  gameConfig,
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
  vi.unstubAllEnvs();
  await db.delete(gameConfig);
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

// ── Story 3-3: per-hole F1 money on the scorecard ─────────────────────────────
// Completes the foursome (target+viewer = team A slots 1&2, two new players =
// team B slots 3&4), adds an event-level F1 game_config + a pin (all CH=0 so
// net==gross) + base-flat scores. The integration course pars for holes 1-6
// ([4,4,3,5,4,4]) match the guyan-2v2-base-flat fixture, so team A player a1
// (= target) earns the APPROVED golden per-hole money: +5/+15/-20/+20/-25/+20.

const F1_CONFIG = {
  scope: 'foursome',
  game: 'guyan-2v2',
  pointValueSchedule: { kind: 'flat', cents: 500 },
  modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } }],
  configVersion: 1,
};
// base-flat per-hole net by player slot (a1=target, a2=viewer, b1, b2).
const BASE_FLAT_NETS: Array<[number, number, number, number, number]> = [
  // [hole, a1, a2, b1, b2]
  [1, 3, 5, 3, 6],
  [2, 3, 5, 4, 4],
  [3, 3, 4, 2, 3],
  [4, 5, 4, 6, 5],
  [5, 3, 6, 2, 5],
  [6, 3, 4, 5, 6],
];
// approved per-hole money (cents) for target (a1): holes 1-6, null elsewhere.
const TARGET_MONEY_CENTS: Record<number, number> = { 1: 500, 2: 1500, 3: -2000, 4: 2000, 5: -2500, 6: 2000 };

async function addF1(
  s: SeedIds,
  opts: { lockState?: 'locked' | 'unlocked'; nets?: Array<[number, number, number, number, number]> } = {},
): Promise<void> {
  const now = Date.now();
  const lockState = opts.lockState ?? 'locked';
  const nets = opts.nets ?? BASE_FLAT_NETS;
  const b1 = randomUUID();
  const b2 = randomUUID();
  for (const [id, name] of [[b1, 'B1'], [b2, 'B2']] as const) {
    await db.insert(players).values({
      id, isOrganizer: false, createdAt: now, name, manualHandicapIndex: null,
      tenantId: TENANT_ID, contextId: CTX,
    });
  }
  // The pairing already exists (seed()); complete it with slots 3 & 4.
  const pr = await db.select({ id: pairings.id }).from(pairings).where(eq(pairings.eventRoundId, s.eventRoundId)).limit(1);
  const pairingId = pr[0]!.id;
  await db.insert(pairingMembers).values([
    { pairingId, playerId: b1, slotNumber: 3, tenantId: TENANT_ID, contextId: CTX },
    { pairingId, playerId: b2, slotNumber: 4, tenantId: TENANT_ID, contextId: CTX },
  ]);
  // Event-level F1 game_config (the dual-read routing key + lock state).
  await db.insert(gameConfig).values({
    id: randomUUID(), level: 'event', refId: s.eventId, configJson: JSON.stringify({ ...F1_CONFIG, lockState }),
    seedRuleSetRevisionId: null, lockState, configVersion: F1_CONFIG.configVersion,
    createdAt: now, updatedAt: now, tenantId: TENANT_ID, contextId: CTX,
  });
  // Pin: CH = 0 for all four (net == gross).
  const perPlayer: Record<string, { hi: number; ch: number }> = {
    [s.targetId]: { hi: 0, ch: 0 }, [s.viewerId]: { hi: 0, ch: 0 }, [b1]: { hi: 0, ch: 0 }, [b2]: { hi: 0, ch: 0 },
  };
  await db.insert(roundPins).values({
    roundId: s.roundId, resolvedConfigJson: JSON.stringify({ ...F1_CONFIG, lockState }),
    seedRuleSetRevisionId: null, courseRevisionId: s.courseRevId, tee: 'blue',
    perPlayerHandicapsJson: JSON.stringify(perPlayer), teamCompositionJson: null,
    createdAt: now, tenantId: TENANT_ID, contextId: CTX,
  });
  // Scores: gross = net (CH=0). Only the supplied holes are scored; the rest unplayed.
  const bySlot = [s.targetId, s.viewerId, b1, b2];
  for (const [hole, ...holeNets] of nets) {
    for (let i = 0; i < 4; i++) {
      await db.insert(holeScores).values({
        id: randomUUID(), roundId: s.roundId, playerId: bySlot[i]!, holeNumber: hole,
        grossStrokes: holeNets[i]!, putts: 2, scorerPlayerId: s.viewerId, clientEventId: `m-${i}-${hole}`,
        createdAt: now, updatedAt: now, tenantId: TENANT_ID, contextId: CTX,
      });
    }
  }
}

describe('GET scorecard — per-hole F1 money (Story 3-3)', () => {
  test('locked F1 + flag ON: moneyNet matches the approved golden on settled holes, null on unplayed', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const s = await seed();
    await addF1(s, { lockState: 'locked' });
    const app = buildApp(s.viewerId);
    const res = await app.request(url(s.roundId, s.targetId), { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { holes: ScorecardHole[] };
    for (const h of body.holes) {
      if (h.holeNumber <= 6) {
        expect(h.moneyNet).toBe(TARGET_MONEY_CENTS[h.holeNumber]);
      } else {
        expect(h.moneyNet).toBeNull(); // unplayed → unsettled → null (never $0)
      }
    }
  });

  test('flag OFF: moneyNet null on every hole (3-2 parity, scores-only)', async () => {
    // no stubEnv → flag unset
    const s = await seed();
    await addF1(s, { lockState: 'locked' });
    const app = buildApp(s.viewerId);
    const res = await app.request(url(s.roundId, s.targetId), { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { holes: ScorecardHole[] };
    for (const h of body.holes) expect(h.moneyNet).toBeNull();
  });

  test('event UNLOCKED (flag on): moneyNet null on every hole (scores-only mode)', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const s = await seed();
    await addF1(s, { lockState: 'unlocked' });
    const app = buildApp(s.viewerId);
    const res = await app.request(url(s.roundId, s.targetId), { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { holes: ScorecardHole[] };
    for (const h of body.holes) expect(h.moneyNet).toBeNull();
  });

  test('settled PUSH hole preserves moneyNet 0 (NOT null/—); unplayed stays null', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const s = await seed();
    // Hole 1 (par 4): all four players net 4 → low tie / skin 0 / team-total tie /
    // net-skins all-par no-blood → pts 0 → a settled PUSH (money 0, not unsettled).
    await addF1(s, { lockState: 'locked', nets: [[1, 4, 4, 4, 4]] });
    const app = buildApp(s.viewerId);
    const res = await app.request(url(s.roundId, s.targetId), { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { holes: ScorecardHole[] };
    const h1 = body.holes.find((h) => h.holeNumber === 1)!;
    expect(h1.moneyNet).toBe(0); // settled push → explicit $0, never erased to null
    const h2 = body.holes.find((h) => h.holeNumber === 2)!;
    expect(h2.moneyNet).toBeNull(); // unplayed → unsettled → null
  });
});

describe('GET scorecard — pinned course revision authority (Story 3-3 divergence fix)', () => {
  test('par/si/net come from the PINNED revision, not a post-pin event_round course edit', async () => {
    const s = await seed();
    const now = Date.now();
    // Pin the round to the ORIGINAL revision (s.courseRevId; si[hole]=hole) with target ch=5.
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
    // A DIFFERENT revision (reversed SI, par 5) that the event_round is later
    // edited to point at — the B3 edit-round-course path AFTER the pin.
    const courseId2 = randomUUID();
    const rev2 = randomUUID();
    await db.insert(courses).values({ id: courseId2, name: 'Edited', clubName: 'Edited', createdAt: now, tenantId: TENANT_ID, contextId: CTX });
    await db.insert(courseRevisions).values({
      id: rev2, courseId: courseId2, revisionNumber: 2, sourceUrl: null, extractionDate: null,
      verified: false, outTotal: 36, inTotal: 36, courseTotal: 72, createdAt: now, tenantId: TENANT_ID, contextId: CTX,
    });
    for (let n = 1; n <= 18; n++) {
      await db.insert(courseHoles).values({
        id: randomUUID(), courseRevisionId: rev2, holeNumber: n,
        par: 5, si: 19 - n, yardagePerTeeJson: '{}', tenantId: TENANT_ID, contextId: CTX,
      });
    }
    await db.update(eventRounds).set({ courseRevisionId: rev2 }).where(eq(eventRounds.id, s.eventRoundId));

    const app = buildApp(s.viewerId);
    const res = await app.request(url(s.roundId, s.targetId), { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { holes: ScorecardHole[] };
    const h1 = body.holes.find((h) => h.holeNumber === 1)!;
    // PINNED rev hole 1: par 4, si 1 → ch5 receives a stroke. The edited rev2 would
    // give par 5 + si 18 → 0 strokes; the scorecard must IGNORE rev2 (use the pin),
    // so net display can never diverge from the pinned money settlement.
    expect(h1.par).toBe(4);
    expect(h1.relativeStrokes).toBe(1);
  });
});
