/**
 * T6-3 — POST /api/events/:eventId/bets integration tests.
 *
 * 11 spec-mandated cases (i)-(xi) per AC-13 + 1 defensive case (ii-b
 * reverse-order players to verify canonical normalize) = 12 tests.
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
    c.set('session', { sessionId: 'test', playerId: __testPlayer.id });
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
  rounds,
  holeScores,
  individualBets,
  individualBetRounds,
  individualBetPresses,
  auditLog,
} = await import('../db/schema/index.js');
const { betsRouter } = await import('./bets.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(individualBetPresses);
  await db.delete(individualBetRounds);
  await db.delete(individualBets);
  await db.delete(holeScores);
  await db.delete(rounds);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface SeedResult {
  organizerId: string;
  participantAId: string;
  participantBId: string;
  outsiderId: string;
  eventId: string;
  otherEventId: string;
  eventRoundIds: [string, string];          // 2 rounds in primary event
  otherEventRoundId: string;                 // 1 round in other event
}

async function seed(): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    participantAId: randomUUID(),
    participantBId: randomUUID(),
    outsiderId: randomUUID(),
    eventId: randomUUID(),
    otherEventId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    groupId: randomUUID(),
    otherGroupId: randomUUID(),
    eventRound1Id: randomUUID(),
    eventRound2Id: randomUUID(),
    otherEventRoundId: randomUUID(),
  };
  const ctx = `event:${ids.eventId}`;
  const otherCtx = `event:${ids.otherEventId}`;

  for (const [id, name] of [
    [ids.organizerId, 'Organizer'],
    [ids.participantAId, 'ParticipantA'],
    [ids.participantBId, 'ParticipantB'],
    [ids.outsiderId, 'Outsider'],
  ] as Array<[string, string]>) {
    await db.insert(players).values({
      id, isOrganizer: false, createdAt: now, name,
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  await db.insert(courses).values({
    id: ids.courseId, name: 'C', clubName: 'CC',
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  await db.insert(courseRevisions).values({
    id: ids.courseRevId, courseId: ids.courseId, revisionNumber: 1,
    sourceUrl: null, extractionDate: null, verified: false,
    outTotal: 36, inTotal: 36, courseTotal: 72,
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  await db.insert(courseTees).values({
    id: randomUUID(), courseRevisionId: ids.courseRevId, teeColor: 'blue',
    rating: 720, slope: 113,
    tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  for (let h = 1; h <= 18; h++) {
    await db.insert(courseHoles).values({
      id: randomUUID(), courseRevisionId: ids.courseRevId,
      holeNumber: h, par: 4, si: ((h * 7) % 18) + 1,
      yardagePerTeeJson: '{}',
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  // Primary event with 2 rounds.
  await db.insert(events).values({
    id: ids.eventId, name: 'Primary', startDate: now, endDate: now + 4 * 86400000,
    timezone: 'America/New_York', organizerPlayerId: ids.organizerId,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.eventRound1Id, eventId: ids.eventId, roundNumber: 1, roundDate: now,
    courseRevisionId: ids.courseRevId, teeColor: 'blue', holesToPlay: 18,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.eventRound2Id, eventId: ids.eventId, roundNumber: 2, roundDate: now + 86400000,
    courseRevisionId: ids.courseRevId, teeColor: 'blue', holesToPlay: 18,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  // Runtime rounds rows (one per event_round) — engine assembly looks
  // these up via eventRoundId → rounds.id.
  await db.insert(rounds).values({
    id: randomUUID(), eventId: ids.eventId, eventRoundId: ids.eventRound1Id,
    holesToPlay: 18, createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(rounds).values({
    id: randomUUID(), eventId: ids.eventId, eventRoundId: ids.eventRound2Id,
    holesToPlay: 18, createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(groups).values({
    id: ids.groupId, eventId: ids.eventId, name: 'G',
    moneyVisibilityMode: 'open', createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  for (const pid of [ids.organizerId, ids.participantAId, ids.participantBId]) {
    await db.insert(groupMembers).values({
      groupId: ids.groupId, playerId: pid,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }

  // Other event with 1 round; outsider is the lone member.
  await db.insert(events).values({
    id: ids.otherEventId, name: 'Other', startDate: now, endDate: now + 86400000,
    timezone: 'America/New_York', organizerPlayerId: ids.outsiderId,
    createdAt: now, tenantId: TENANT_ID, contextId: otherCtx,
  });
  await db.insert(eventRounds).values({
    id: ids.otherEventRoundId, eventId: ids.otherEventId, roundNumber: 1, roundDate: now,
    courseRevisionId: ids.courseRevId, teeColor: 'blue', holesToPlay: 18,
    createdAt: now, tenantId: TENANT_ID, contextId: otherCtx,
  });
  await db.insert(groups).values({
    id: ids.otherGroupId, eventId: ids.otherEventId, name: 'OG',
    moneyVisibilityMode: 'open', createdAt: now,
    tenantId: TENANT_ID, contextId: otherCtx,
  });
  await db.insert(groupMembers).values({
    groupId: ids.otherGroupId, playerId: ids.outsiderId,
    tenantId: TENANT_ID, contextId: otherCtx,
  });

  return {
    organizerId: ids.organizerId,
    participantAId: ids.participantAId,
    participantBId: ids.participantBId,
    outsiderId: ids.outsiderId,
    eventId: ids.eventId,
    otherEventId: ids.otherEventId,
    eventRoundIds: [ids.eventRound1Id, ids.eventRound2Id],
    otherEventRoundId: ids.otherEventRoundId,
  };
}

function buildApp(playerId: string): Hono {
  __testPlayer = { id: playerId, isOrganizer: false };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/events', betsRouter);
  return app;
}

async function postBet(
  app: Hono,
  eventId: string,
  body: unknown,
): Promise<Response> {
  return await app.request(`/api/events/${eventId}/bets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/events/:eventId/bets', () => {
  test('(i) happy path — organizer creates $5/hole match for two participants', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const res = await postBet(app, s.eventId, {
      playerAId: s.participantAId,
      playerBId: s.participantBId,
      betType: 'match_play_per_hole',
      stakePerHoleCents: 500,
      applicableRoundIds: s.eventRoundIds,
      config: {},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; betId: string };
    expect(body.ok).toBe(true);
    expect(body.betId).toBeDefined();

    // Bet row exists; canonical alphabetical ordering.
    const betRows = await db.select().from(individualBets).where(eq(individualBets.id, body.betId));
    expect(betRows.length).toBe(1);
    const stored = betRows[0]!;
    const expectedA = [s.participantAId, s.participantBId].sort()[0];
    const expectedB = [s.participantAId, s.participantBId].sort()[1];
    expect(stored.playerAId).toBe(expectedA);
    expect(stored.playerBId).toBe(expectedB);

    // 2 bet_rounds rows.
    const roundRows = await db.select().from(individualBetRounds).where(eq(individualBetRounds.betId, body.betId));
    expect(roundRows.length).toBe(2);

    // 1 audit row.
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.eventType, 'bet.created'), eq(auditLog.entityId, body.betId)));
    expect(audits.length).toBe(1);
  });

  test('(ii) duplicate bet — second request with same A↔B + bet_type → 422 duplicate_bet', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const body = {
      playerAId: s.participantAId,
      playerBId: s.participantBId,
      betType: 'match_play_per_hole',
      stakePerHoleCents: 500,
      applicableRoundIds: [s.eventRoundIds[0]],
      config: {},
    };
    const res1 = await postBet(app, s.eventId, body);
    expect(res1.status).toBe(200);
    const res2 = await postBet(app, s.eventId, body);
    expect(res2.status).toBe(422);
    expect(((await res2.json()) as { code: string }).code).toBe('duplicate_bet');
  });

  test('(ii-b) reverse-order players still hit duplicate_bet (canonical normalize works)', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const res1 = await postBet(app, s.eventId, {
      playerAId: s.participantAId,
      playerBId: s.participantBId,
      betType: 'match_play_per_hole',
      stakePerHoleCents: 500,
      applicableRoundIds: [s.eventRoundIds[0]],
      config: {},
    });
    expect(res1.status).toBe(200);
    const res2 = await postBet(app, s.eventId, {
      playerAId: s.participantBId,
      playerBId: s.participantAId,
      betType: 'match_play_per_hole',
      stakePerHoleCents: 500,
      applicableRoundIds: [s.eventRoundIds[0]],
      config: {},
    });
    expect(res2.status).toBe(422);
    expect(((await res2.json()) as { code: string }).code).toBe('duplicate_bet');
  });

  test('(iii) non-participant requester → 403 not_event_participant', async () => {
    const s = await seed();
    const app = buildApp(s.outsiderId);  // outsider is in OTHER event, not Primary.
    const res = await postBet(app, s.eventId, {
      playerAId: s.participantAId,
      playerBId: s.participantBId,
      betType: 'match_play_per_hole',
      stakePerHoleCents: 500,
      applicableRoundIds: [s.eventRoundIds[0]],
      config: {},
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });

  test('(iv) playerAId not in event → 422 players_not_in_event', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const res = await postBet(app, s.eventId, {
      playerAId: s.outsiderId,  // outsider is NOT in Primary event's group_members
      playerBId: s.participantBId,
      betType: 'match_play_per_hole',
      stakePerHoleCents: 500,
      applicableRoundIds: [s.eventRoundIds[0]],
      config: {},
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('players_not_in_event');
  });

  test('(v) applicableRoundIds references a round in a different event → 422 round_not_in_event', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const res = await postBet(app, s.eventId, {
      playerAId: s.participantAId,
      playerBId: s.participantBId,
      betType: 'match_play_per_hole',
      stakePerHoleCents: 500,
      applicableRoundIds: [s.otherEventRoundId],
      config: {},
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('round_not_in_event');
  });

  test('(vi) stakePerHoleCents = 0 → 400 invalid_body (Zod range)', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const res = await postBet(app, s.eventId, {
      playerAId: s.participantAId,
      playerBId: s.participantBId,
      betType: 'match_play_per_hole',
      stakePerHoleCents: 0,
      applicableRoundIds: [s.eventRoundIds[0]],
      config: {},
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_body');
  });

  test('(vii) match_play_with_auto_press without config → 400 invalid_config', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const res = await postBet(app, s.eventId, {
      playerAId: s.participantAId,
      playerBId: s.participantBId,
      betType: 'match_play_with_auto_press',
      stakePerHoleCents: 500,
      applicableRoundIds: [s.eventRoundIds[0]],
      config: {},
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_config');
  });

  test('(viii) audit row + canonical ordering preserved', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const res = await postBet(app, s.eventId, {
      playerAId: s.participantBId,  // intentionally B first
      playerBId: s.participantAId,
      betType: 'match_play_with_auto_press',
      stakePerHoleCents: 500,
      applicableRoundIds: s.eventRoundIds,
      config: { autoPressTriggerAtNDown: 2, pressMultiplier: 2 },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { betId: string };
    const betRows = await db.select().from(individualBets).where(eq(individualBets.id, body.betId));
    const expectedA = [s.participantAId, s.participantBId].sort()[0];
    expect(betRows[0]!.playerAId).toBe(expectedA);

    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, body.betId));
    expect(audits.length).toBe(1);
    const payload = JSON.parse(audits[0]!.payloadJson) as { playerAId: string };
    expect(payload.playerAId).toBe(expectedA);
  });

  test('(ix) self-bet → 400 self_bet_not_allowed', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const res = await postBet(app, s.eventId, {
      playerAId: s.participantAId,
      playerBId: s.participantAId,
      betType: 'match_play_per_hole',
      stakePerHoleCents: 500,
      applicableRoundIds: [s.eventRoundIds[0]],
      config: {},
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('self_bet_not_allowed');
  });

  test('(x) duplicate applicableRoundIds → 400 duplicate_applicable_round_ids', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const res = await postBet(app, s.eventId, {
      playerAId: s.participantAId,
      playerBId: s.participantBId,
      betType: 'match_play_per_hole',
      stakePerHoleCents: 500,
      applicableRoundIds: [s.eventRoundIds[0], s.eventRoundIds[0]],
      config: {},
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('duplicate_applicable_round_ids');
  });

  test('(xi) malformed eventId UUID → 403 not_event_participant (no-existence-leak)', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const fakeEventId = randomUUID();  // valid-shape UUID but nonexistent
    const res = await postBet(app, fakeEventId, {
      playerAId: s.participantAId,
      playerBId: s.participantBId,
      betType: 'match_play_per_hole',
      stakePerHoleCents: 500,
      applicableRoundIds: [s.eventRoundIds[0]],
      config: {},
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });
});

// ---------------------------------------------------------------------------
// T6-8 GET tests
// ---------------------------------------------------------------------------

async function getMine(app: Hono, eventId: string): Promise<Response> {
  return await app.request(`/api/events/${eventId}/bets/mine`);
}

async function getBet(app: Hono, eventId: string, betId: string): Promise<Response> {
  return await app.request(`/api/events/${eventId}/bets/${betId}`);
}

async function createBetDirect(
  eventId: string,
  playerAId: string,
  playerBId: string,
  applicableRoundIds: string[],
  ctx: string,
  stakePerHoleCents = 500,
): Promise<string> {
  const sorted = [playerAId, playerBId].sort();
  const betId = randomUUID();
  const now = Date.now();
  await db.insert(individualBets).values({
    id: betId, eventId, playerAId: sorted[0]!, playerBId: sorted[1]!,
    betType: 'match_play_per_hole', stakePerHoleCents,
    configJson: '{}',
    createdByPlayerId: sorted[0]!, createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  for (const erid of applicableRoundIds) {
    await db.insert(individualBetRounds).values({
      betId, eventRoundId: erid,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }
  return betId;
}

describe('GET /api/events/:eventId/bets/mine', () => {
  test('(a) happy path — viewer party to 1 bet, returns it with sign positive to viewer when viewer === playerA', async () => {
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    const sortedAB = [s.participantAId, s.participantBId].sort();
    const betId = await createBetDirect(
      s.eventId, s.participantAId, s.participantBId, s.eventRoundIds, ctx,
    );

    const app = buildApp(sortedAB[0]!);          // viewer is playerA (canonical)
    const res = await getMine(app, s.eventId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bets: Array<{
        betId: string;
        playerAId: string; playerBId: string;
        opponentPlayerId: string;
        stakePerHoleCents: number;
        applicableRoundIds: string[];
        perRoundStanding: Array<{ eventRoundId: string; roundNumber: number; netToViewerCents: number }>;
        totalNetToViewerCents: number;
      }>;
    };
    expect(body.bets.length).toBe(1);
    expect(body.bets[0]!.betId).toBe(betId);
    expect(body.bets[0]!.opponentPlayerId).toBe(sortedAB[1]!);
    expect(body.bets[0]!.applicableRoundIds.sort()).toEqual([...s.eventRoundIds].sort());
    expect(body.bets[0]!.perRoundStanding.length).toBe(2);
    expect(Number.isInteger(body.bets[0]!.totalNetToViewerCents)).toBe(true);
    // No scores → all rounds are 0-net.
    expect(body.bets[0]!.totalNetToViewerCents).toBe(0);
  });

  test('(b) sign-flip — same bet, viewed by playerB, opponent is playerA', async () => {
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    const sortedAB = [s.participantAId, s.participantBId].sort();
    await createBetDirect(
      s.eventId, s.participantAId, s.participantBId, s.eventRoundIds, ctx,
    );

    const app = buildApp(sortedAB[1]!);          // viewer is playerB
    const res = await getMine(app, s.eventId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bets: Array<{ opponentPlayerId: string; totalNetToViewerCents: number }>;
    };
    expect(body.bets.length).toBe(1);
    expect(body.bets[0]!.opponentPlayerId).toBe(sortedAB[0]!);
    expect(body.bets[0]!.totalNetToViewerCents).toBe(0);   // sign-flipped 0 is still 0
  });

  test('(c) empty — viewer party to 0 bets returns { bets: [] }', async () => {
    const s = await seed();
    // No bets created.
    const app = buildApp(s.participantAId);
    const res = await getMine(app, s.eventId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bets: unknown[] };
    expect(body.bets).toEqual([]);
  });

  test('(d) non-participant 403', async () => {
    const s = await seed();
    const app = buildApp(s.outsiderId);
    const res = await getMine(app, s.eventId);
    expect(res.status).toBe(403);
  });

  test('(e0) holesPlayed counts only holes where BOTH parties scored (and ≤ holesToPlay)', async () => {
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    const sortedAB = [s.participantAId, s.participantBId].sort();
    await createBetDirect(
      s.eventId, s.participantAId, s.participantBId, [s.eventRoundIds[0]], ctx,
    );
    const r1Rows = await db.select().from(rounds).where(eq(rounds.eventRoundId, s.eventRoundIds[0]));
    const round1Id = r1Rows[0]!.id;
    const now = Date.now();

    // playerA scored holes 1, 2, 3. playerB scored only holes 1, 2.
    // Expected: holesPlayed = 2 (holes where BOTH scored).
    for (const h of [1, 2, 3]) {
      await db.insert(holeScores).values({
        id: randomUUID(), roundId: round1Id, playerId: sortedAB[0]!,
        holeNumber: h, grossStrokes: 4, putts: 2,
        scorerPlayerId: sortedAB[0]!, clientEventId: `evt-a-${h}`,
        createdAt: now, updatedAt: now,
        tenantId: TENANT_ID, contextId: ctx,
      });
    }
    for (const h of [1, 2]) {
      await db.insert(holeScores).values({
        id: randomUUID(), roundId: round1Id, playerId: sortedAB[1]!,
        holeNumber: h, grossStrokes: 5, putts: 2,
        scorerPlayerId: sortedAB[0]!, clientEventId: `evt-b-${h}`,
        createdAt: now, updatedAt: now,
        tenantId: TENANT_ID, contextId: ctx,
      });
    }

    const app = buildApp(sortedAB[0]!);
    const res = await getMine(app, s.eventId);
    const body = (await res.json()) as {
      bets: Array<{ perRoundStanding: Array<{ holesPlayed: number; holesRemaining: number }> }>;
    };
    expect(body.bets[0]!.perRoundStanding[0]!.holesPlayed).toBe(2);
    expect(body.bets[0]!.perRoundStanding[0]!.holesRemaining).toBe(16);
  });

  test('(e) sign-flip with real scores — playerA wins hole 1 by 1; netToViewerCents flips between viewers', async () => {
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    const sortedAB = [s.participantAId, s.participantBId].sort();
    await createBetDirect(
      s.eventId, s.participantAId, s.participantBId, [s.eventRoundIds[0]], ctx,
    );

    // Look up the runtime round for eventRound1.
    const r1Rows = await db.select().from(rounds).where(eq(rounds.eventRoundId, s.eventRoundIds[0]));
    const round1Id = r1Rows[0]!.id;

    // playerA gross 4, playerB gross 5 on hole 1; both 0 HI → playerA wins by 1 stroke.
    const now = Date.now();
    await db.insert(holeScores).values({
      id: randomUUID(), roundId: round1Id, playerId: sortedAB[0]!,
      holeNumber: 1, grossStrokes: 4, putts: 2,
      scorerPlayerId: sortedAB[0]!, clientEventId: 'evt-a-1',
      createdAt: now, updatedAt: now,
      tenantId: TENANT_ID, contextId: ctx,
    });
    await db.insert(holeScores).values({
      id: randomUUID(), roundId: round1Id, playerId: sortedAB[1]!,
      holeNumber: 1, grossStrokes: 5, putts: 2,
      scorerPlayerId: sortedAB[0]!, clientEventId: 'evt-b-1',
      createdAt: now, updatedAt: now,
      tenantId: TENANT_ID, contextId: ctx,
    });

    const aApp = buildApp(sortedAB[0]!);
    const aRes = await getMine(aApp, s.eventId);
    const aBody = (await aRes.json()) as { bets: Array<{ totalNetToViewerCents: number }> };
    const bApp = buildApp(sortedAB[1]!);
    const bRes = await getMine(bApp, s.eventId);
    const bBody = (await bRes.json()) as { bets: Array<{ totalNetToViewerCents: number }> };

    // playerA up 1 hole × 500c stake = 500c.
    expect(aBody.bets[0]!.totalNetToViewerCents).toBe(500);
    // Sign-flipped for playerB.
    expect(bBody.bets[0]!.totalNetToViewerCents).toBe(-500);
    // Anti-symmetry across viewers.
    expect(aBody.bets[0]!.totalNetToViewerCents).toBe(-bBody.bets[0]!.totalNetToViewerCents);
    // perRoundStanding[0].netToViewerCents must also flip sign (codex L #6).
    const aRoundCast = aBody as unknown as { bets: Array<{ perRoundStanding: Array<{ netToViewerCents: number }> }> };
    const bRoundCast = bBody as unknown as { bets: Array<{ perRoundStanding: Array<{ netToViewerCents: number }> }> };
    expect(aRoundCast.bets[0]!.perRoundStanding[0]!.netToViewerCents).toBe(500);
    expect(bRoundCast.bets[0]!.perRoundStanding[0]!.netToViewerCents).toBe(-500);
  });
});

describe('GET /api/events/:eventId/bets/:betId', () => {
  test('(f) 200 as party', async () => {
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    const sortedAB = [s.participantAId, s.participantBId].sort();
    const betId = await createBetDirect(
      s.eventId, s.participantAId, s.participantBId, s.eventRoundIds, ctx,
    );
    const app = buildApp(sortedAB[0]!);
    const res = await getBet(app, s.eventId, betId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { betId: string; opponentPlayerId: string };
    expect(body.betId).toBe(betId);
    expect(body.opponentPlayerId).toBe(sortedAB[1]!);
  });

  test('(g) 403 not_party_to_bet — event participant who is NOT a bet party', async () => {
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    // Bet between participantA and participantB; organizer is in event but not party.
    const betId = await createBetDirect(
      s.eventId, s.participantAId, s.participantBId, s.eventRoundIds, ctx,
    );
    const app = buildApp(s.organizerId);
    const res = await getBet(app, s.eventId, betId);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_party_to_bet');
  });

  test('(h) 403 unknown betId (no-existence-leak)', async () => {
    const s = await seed();
    const app = buildApp(s.participantAId);
    const res = await getBet(app, s.eventId, randomUUID());
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_party_to_bet');
  });

  test('(i) 403 betId from a different event (no-existence-leak)', async () => {
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    // Create the bet under the OTHER event but lookup via primary eventId.
    const sortedAB = [s.participantAId, s.participantBId].sort();
    const otherCtx = `event:${s.otherEventId}`;
    const betId = randomUUID();
    const now = Date.now();
    await db.insert(individualBets).values({
      id: betId, eventId: s.otherEventId, playerAId: sortedAB[0]!, playerBId: sortedAB[1]!,
      betType: 'match_play_per_hole', stakePerHoleCents: 500,
      configJson: '{}',
      createdByPlayerId: s.outsiderId, createdAt: now,
      tenantId: TENANT_ID, contextId: otherCtx,
    });
    void ctx;

    // Viewer is participantA (party to the bet) but querying via primary eventId.
    const app = buildApp(s.participantAId);
    const res = await getBet(app, s.eventId, betId);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_party_to_bet');
  });

  test('(j) 400 invalid_bet_id_format for malformed UUID', async () => {
    const s = await seed();
    const app = buildApp(s.participantAId);
    const res = await getBet(app, s.eventId, 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('invalid_bet_id_format');
  });

  test('(k) 403 non-event-participant (outsider tries to fetch bet in primary event)', async () => {
    const s = await seed();
    const ctx = `event:${s.eventId}`;
    const betId = await createBetDirect(
      s.eventId, s.participantAId, s.participantBId, s.eventRoundIds, ctx,
    );
    const app = buildApp(s.outsiderId);
    const res = await getBet(app, s.eventId, betId);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });
});
