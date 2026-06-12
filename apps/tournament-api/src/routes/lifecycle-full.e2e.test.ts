/**
 * Full-lifecycle E2E (T14-2) — extends the onboarding chain through the MONEY
 * layer over REAL HTTP. The per-route integration tests prove each endpoint's
 * correctness in isolation by SEEDING rows directly; this proves the SEAMS hold
 * when one real scored round flows through every downstream surface:
 *
 *   create event → roster (4) → lock pairing → START → score 18 holes (HTTP)
 *     → manual press → scorer handoff → score correction
 *     → money matrix → bet create+read → complete → finalize.
 *
 * Auth: requireSession mocked via __testPlayer (switchable), matching the
 * established integration pattern; everything else runs for real against the
 * in-memory DB. Prereq config (course tees/holes, rule set) is inserted
 * directly — it's configuration, not a flow under test (mirrors the course
 * revision the onboarding e2e seeds directly).
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
  // Unique temp FILE db per worker process. NOT `file::memory:?cache=shared`:
  // vitest's forks pool reuses worker processes, and that shared-cache name is
  // process-global — `isolate` resets JS modules but not libsql's native cache,
  // so a reused fork leaks another file's tables here (surfaced as money=0 only
  // under the full suite). A per-pid temp file is fully isolated; file dbs share
  // across connections naturally, so db.transaction() still works.
  const { tmpdir } = await import('node:os');
  const { rmSync } = await import('node:fs');
  const dbPath = `${tmpdir()}/e2e-lifecycle-full-${process.pid}.db`.replace(/\\/g, '/');
  for (const s of ['', '-wal', '-shm']) rmSync(`${dbPath}${s}`, { force: true });
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

let __testPlayer: { id: string; isOrganizer: boolean } | null = null;
vi.mock('../middleware/require-session.js', () => ({
  requireSession: async (c: import('hono').Context, next: () => Promise<void>) => {
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
  courseTees,
  courseHoles,
  events,
  eventRounds,
  groups,
  groupMembers,
  pairings,
  pairingMembers,
  rounds,
  roundStates,
  scorerAssignments,
  holeScores,
  ruleSets,
  ruleSetRevisions,
  individualBets,
  individualBetRounds,
  individualBetPresses,
  teamPressLog,
  activity,
  auditLog,
  scoreCorrections,
} = await import('../db/schema/index.js');
const { adminEventsRouter } = await import('./admin-events.js');
const { adminGroupsRouter } = await import('./admin-groups.js');
const { adminEventRoundsRouter } = await import('./admin-event-rounds.js');
const { eventsRouter } = await import('./events.js');
const { eventsLeaderboardRouter } = await import('./events-leaderboard.js');
const { scoresRouter } = await import('./scores.js');
const { moneyRouter } = await import('./money.js');
const { betsRouter } = await import('./bets.js');
const { pressesRouter } = await import('./presses.js');
const { scorerAssignmentsRouter } = await import('./scorer-assignments.js');
const { roundLifecycleRouter } = await import('./round-lifecycle.js');
const { scoreCorrectionsRouter } = await import('./score-corrections.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  // eslint-disable-next-line no-restricted-syntax -- test-cleanup truncate only
  await db.delete(activity);
  await db.delete(auditLog);
  await db.delete(scoreCorrections);
  await db.delete(teamPressLog);
  await db.delete(individualBetPresses);
  await db.delete(individualBetRounds);
  await db.delete(individualBets);
  await db.delete(holeScores);
  await db.delete(scorerAssignments);
  await db.delete(roundStates);
  await db.delete(rounds);
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(ruleSetRevisions);
  await db.delete(ruleSets);
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
  __testPlayer = null;
});

function buildApp(): Hono {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/admin', adminEventsRouter);
  app.route('/api/admin', adminGroupsRouter);
  app.route('/api/admin', adminEventRoundsRouter);
  app.route('/api/events', eventsRouter);
  app.route('/api/events', eventsLeaderboardRouter);
  app.route('/api/events', moneyRouter);
  app.route('/api/events', betsRouter);
  app.route('/api/rounds', scoresRouter);
  app.route('/api/rounds', pressesRouter);
  app.route('/api/rounds', scorerAssignmentsRouter);
  app.route('/api/rounds', roundLifecycleRouter);
  app.route('/api/rounds', scoreCorrectionsRouter);
  return app;
}

function asPlayer(id: string, isOrganizer = false): void {
  __testPlayer = { id, isOrganizer };
}

async function postJson(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Insert config prereqs NOT under test: course tees + 18 holes + a rule set. */
async function seedConfig(): Promise<{ organizerId: string; courseRevId: string }> {
  const now = Date.now();
  const organizerId = randomUUID();
  await db.insert(players).values({
    id: organizerId, isOrganizer: true, createdAt: now, name: 'Organizer',
    tenantId: TENANT_ID, contextId: CTX,
  });
  const courseId = randomUUID();
  const courseRevId = randomUUID();
  await db.insert(courses).values({
    id: courseId, name: 'Guyan', clubName: 'Guyan GCC',
    createdAt: now, tenantId: TENANT_ID, contextId: CTX,
  });
  await db.insert(courseRevisions).values({
    id: courseRevId, courseId, revisionNumber: 1, sourceUrl: null, extractionDate: null,
    verified: true, outTotal: 36, inTotal: 36, courseTotal: 72,
    createdAt: now, tenantId: TENANT_ID, contextId: CTX,
  });
  await db.insert(courseTees).values({
    id: randomUUID(), courseRevisionId: courseRevId, teeColor: 'blue',
    rating: 720, slope: 113, tenantId: TENANT_ID, contextId: CTX,
  });
  for (let h = 1; h <= 18; h++) {
    await db.insert(courseHoles).values({
      id: randomUUID(), courseRevisionId: courseRevId, holeNumber: h, par: 4,
      si: ((h * 7) % 18) + 1, yardagePerTeeJson: '{}',
      tenantId: TENANT_ID, contextId: CTX,
    });
  }
  // Single tenant rule set + revision — money resolves the latest by tenant.
  const ruleSetId = randomUUID();
  await db.insert(ruleSets).values({
    id: ruleSetId, name: 'Standard', createdAt: now,
    tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
  });
  await db.insert(ruleSetRevisions).values({
    id: randomUUID(), ruleSetId, revisionNumber: 1,
    configJson: JSON.stringify({
      basePerHoleCents: 100, sandies: false, sandiesBonusPerHoleCents: 0,
      greenieCarryover: false, greenieValidation: 'none', greenieBaseCents: 0,
      autoPressTriggerAtNDown: null, pressMultiplier: 2,
    }),
    effectiveFromRoundId: null, effectiveFromHole: 1,
    createdByPlayerId: organizerId, reason: null, createdAt: now,
    tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
  });
  return { organizerId, courseRevId };
}

interface Built {
  organizerId: string;
  eventId: string;
  eventRoundId: string;
  roundId: string;
  /** teamA = [0,1] (slots 1,2), teamB = [2,3] (slots 3,4). */
  members: string[];
  scorerId: string;
}

/** Build a 4-player locked foursome + start the round, all over real HTTP. */
async function buildAndStart(app: Hono): Promise<Built> {
  const { organizerId, courseRevId } = await seedConfig();
  const startDate = Date.UTC(2026, 5, 12, 4);
  asPlayer(organizerId, true);

  const createRes = await postJson(app, '/api/admin/events', {
    name: 'Full Lifecycle', start_date: startDate, end_date: startDate,
    timezone: 'America/New_York',
    rounds: [{ round_date: startDate, course_revision_id: courseRevId, tee_color: 'blue', holes_to_play: 18 }],
  });
  expect(createRes.status).toBe(201);
  const { eventId } = (await createRes.json()) as { eventId: string };
  const groupId = (await db.select().from(groups).where(eq(groups.eventId, eventId)))[0]!.id;
  const eventRoundId = (await db.select().from(eventRounds).where(eq(eventRounds.eventId, eventId)))[0]!.id;

  // 4 manual members, named for deterministic slot ordering.
  for (let i = 0; i < 4; i++) {
    const r = await postJson(app, `/api/admin/groups/${groupId}/members`, {
      mode: 'manual', name: `P${i}`, manualHandicapIndex: 0,
    });
    expect([200, 201]).toContain(r.status);
  }
  const memberRows = await db
    .select({ playerId: groupMembers.playerId, name: players.name })
    .from(groupMembers)
    .innerJoin(players, eq(groupMembers.playerId, players.id))
    .where(eq(groupMembers.groupId, groupId));
  const members = memberRows
    .slice()
    .sort((a, b) => Number((a.name ?? 'P9').slice(1)) - Number((b.name ?? 'P9').slice(1)))
    .map((m) => m.playerId);
  expect(members.length).toBe(4);

  // Lock one foursome; slot order = array order → teamA = members[0,1].
  const pairRes = await postJson(app, `/api/admin/events/${eventId}/pairings`, {
    rounds: [{ eventRoundId, pairings: [{ foursomeNumber: 1, locked: true, memberPlayerIds: members }] }],
  });
  expect(pairRes.status).toBeLessThan(300);

  // Start — designate a foursome MEMBER as scorer (the scorable path).
  const scorerId = members[0]!;
  const startRes = await postJson(app, `/api/admin/event-rounds/${eventRoundId}/start`, {
    scorers: [{ foursomeNumber: 1, scorerPlayerId: scorerId }],
  });
  expect(startRes.status).toBe(201);
  const { roundId } = (await startRes.json()) as { roundId: string };

  return { organizerId, eventId, eventRoundId, roundId, members, scorerId };
}

/** Post a hole's four gross scores as the scorer. teamA lower when aWins. */
async function scoreHole(app: Hono, b: Built, hole: number, aWins: boolean): Promise<void> {
  asPlayer(b.scorerId);
  const aGross = aWins ? 4 : 5;
  const bGross = aWins ? 5 : 4;
  const grossFor = (idx: number) => (idx < 2 ? aGross : bGross);
  for (let i = 0; i < 4; i++) {
    const res = await postJson(app, `/api/rounds/${b.roundId}/holes/${hole}/scores`, {
      playerId: b.members[i], grossStrokes: grossFor(i), clientEventId: `evt-${hole}-${i}`,
    });
    expect(res.status, `score hole ${hole} player ${i}`).toBeLessThan(300);
  }
}

describe('E2E: full lifecycle through the money layer (real HTTP)', () => {
  test('score → press → handoff → correction → money → bet → finalize', async () => {
    const app = buildApp();
    const b = await buildAndStart(app);

    // --- Score hole 1, then file a manual press while holes remain ---
    await scoreHole(app, b, 1, /* aWins */ true);
    asPlayer(b.scorerId);
    const pressRes = await postJson(app, `/api/rounds/${b.roundId}/presses`, { team: 'teamA' });
    const pressText = await pressRes.text();
    expect(pressRes.status, pressText).toBe(200);
    const press = JSON.parse(pressText) as { ok: boolean; pressId: string; fromHole: number };
    expect(press.ok).toBe(true);
    expect(press.fromHole).toBe(2);

    // --- Score the remaining 17 holes (teamA wins 12 total, loses 6) ---
    for (let h = 2; h <= 18; h++) {
      await scoreHole(app, b, h, /* aWins */ h <= 12);
    }

    // --- Scorer handoff: scorer → another member (in_progress allows it) ---
    asPlayer(b.scorerId);
    const handoffRes = await postJson(app, `/api/rounds/${b.roundId}/scorer-assignments/transfer`, {
      foursomeNumber: 1, toPlayerId: b.members[1],
    });
    expect(handoffRes.status, await handoffRes.text()).toBe(200);

    // --- Score correction on hole 1 (organizer is always authorized) ---
    asPlayer(b.organizerId, true);
    const correctRes = await postJson(
      app,
      `/api/rounds/${b.roundId}/scores/${b.members[0]}/1/correct`,
      { grossStrokes: 4, reason: 'e2e correction' },
    );
    expect(correctRes.status, await correctRes.text()).toBeLessThan(300);
    const histRes = await app.request(`/api/rounds/${b.roundId}/score-corrections`);
    expect(histRes.status).toBe(200);
    const hist = (await histRes.json()) as { items: unknown[] };
    expect(hist.items.length).toBeGreaterThanOrEqual(1);

    // --- Money matrix reflects the real scored round ---
    asPlayer(b.members[0]!); // a participant
    const moneyRes = await app.request(`/api/events/${b.eventId}/money`);
    expect(moneyRes.status).toBe(200);
    const money = (await moneyRes.json()) as {
      players: Array<{ id: string }>;
      matrix: Record<string, Record<string, number>>;
      totals: Record<string, number>;
    };
    const [a1, a2, t1, t2] = b.members as [string, string, string, string];
    // Directional: teamA up, teamB down (teamA won the hole count).
    expect(money.totals[a1]!).toBeGreaterThan(0);
    expect(money.totals[a2]!).toBeGreaterThan(0);
    expect(money.totals[t1]!).toBeLessThan(0);
    expect(money.totals[t2]!).toBeLessThan(0);
    // Structural invariants on real data: anti-symmetry + zero diagonal.
    for (const x of b.members) {
      expect(money.matrix[x]![x]).toBe(0);
      for (const y of b.members) {
        if (x !== y) expect(money.matrix[x]![y]! + money.matrix[y]![x]!).toBe(0);
      }
    }

    // --- Individual bet: create + read back standings ---
    asPlayer(a1);
    const betRes = await postJson(app, `/api/events/${b.eventId}/bets`, {
      playerAId: a1, playerBId: t1, betType: 'match_play_per_hole',
      stakePerHoleCents: 100, applicableRoundIds: [b.eventRoundId], config: {},
    });
    expect(betRes.status, await betRes.text()).toBe(200);
    const myBetsRes = await app.request(`/api/events/${b.eventId}/bets/mine`);
    expect(myBetsRes.status).toBe(200);
    const myBets = (await myBetsRes.json()) as { bets?: unknown[] } | unknown[];
    const betList = Array.isArray(myBets) ? myBets : (myBets.bets ?? []);
    expect(betList.length).toBeGreaterThanOrEqual(1);

    // --- Lifecycle: complete (all 18 scored) → finalize (organizer) ---
    asPlayer(b.organizerId, true);
    const completeRes = await postJson(app, `/api/rounds/${b.roundId}/complete`, {});
    expect(completeRes.status, await completeRes.text()).toBeLessThan(300);
    const finalizeRes = await postJson(app, `/api/rounds/${b.roundId}/finalize`, {});
    expect(finalizeRes.status, await finalizeRes.text()).toBeLessThan(300);

    // Round-state row is now finalized.
    const stateRows = await db.select().from(roundStates).where(eq(roundStates.roundId, b.roundId));
    expect(stateRows.some((r) => r.state === 'finalized')).toBe(true);
  });
});
