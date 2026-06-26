/**
 * Story 1.1 walking-skeleton integration tests for "The Action" admin betting.
 *
 * Proves the end-to-end loop the story exists for: an organizer creates an
 * h2h-net bet, recorded scores settle it via the pure engine, and the
 * SettlementEdge folds into the EXISTING pairwise settle-up (computeMoneyMatrix)
 * and the viewer My Money board (computeMyMoney) — no parallel money surface.
 *
 * Covers: create + list (route), organizer gate (403), FR50 (same stakeholder),
 * FR49 (placement cutoff), push contributes nothing (FR26/FR39), and the open
 * book (FR8/FR10/FR38 — non-playing backer collects and appears in settle-up).
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { and, eq } from 'drizzle-orm';
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
  requireSession: async (c: import('hono').Context, next: () => Promise<void>) => {
    if (!__testPlayer) return c.json({ error: 'unauthorized', code: 'no_test_player' }, 401);
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
  pairings,
  pairingMembers,
  rounds,
  holeScores,
  bets,
  betSides,
  activity,
  auditLog,
} = await import('../db/schema/index.js');
const { adminEventBetsRouter } = await import('./admin-event-bets.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');
const { computeMoneyMatrix } = await import('../services/money.js');
const { computeMyMoney } = await import('../services/money-detail.js');

const TENANT_ID = 'guyan';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(activity);
  await db.delete(auditLog);
  await db.delete(betSides);
  await db.delete(bets);
  await db.delete(holeScores);
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface SeedIds {
  organizerId: string;
  rick: string;
  ben: string;
  kyle: string; // non-playing backer (open book)
  steven: string; // non-playing backer
  outsiderId: string;
  eventId: string;
  eventRoundId: string;
  roundId: string;
}

/** Seed an 18-hole event. All players HI 0 (net = gross). Rick/Ben play; Kyle/Steven are roster-only backers. */
async function seed(): Promise<SeedIds> {
  const now = Date.now();
  const ids: SeedIds = {
    organizerId: randomUUID(),
    rick: randomUUID(),
    ben: randomUUID(),
    kyle: randomUUID(),
    steven: randomUUID(),
    outsiderId: randomUUID(),
    eventId: randomUUID(),
    eventRoundId: randomUUID(),
    roundId: randomUUID(),
  };
  const courseId = randomUUID();
  const courseRevId = randomUUID();
  const groupId = randomUUID();
  const pairingId = randomUUID();
  const ctx = `event:${ids.eventId}`;
  const CTX_BASE = 'league:guyan';

  for (const [id, name] of [
    [ids.organizerId, 'Organizer'],
    [ids.rick, 'Rick'],
    [ids.ben, 'Ben'],
    [ids.kyle, 'Kyle'],
    [ids.steven, 'Steven'],
    [ids.outsiderId, 'Outsider'],
  ] as Array<[string, string]>) {
    await db.insert(players).values({
      id, isOrganizer: false, createdAt: now, name, manualHandicapIndex: 0,
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  await db.insert(courses).values({
    id: courseId, name: 'C', clubName: 'CC', createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  await db.insert(courseRevisions).values({
    id: courseRevId, courseId, revisionNumber: 1, sourceUrl: null, extractionDate: null,
    verified: false, outTotal: 36, inTotal: 36, courseTotal: 72, createdAt: now,
    tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  await db.insert(courseTees).values({
    id: randomUUID(), courseRevisionId: courseRevId, teeColor: 'blue', rating: 720, slope: 113,
    tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  for (let h = 1; h <= 18; h++) {
    await db.insert(courseHoles).values({
      id: randomUUID(), courseRevisionId: courseRevId, holeNumber: h, par: 4,
      si: ((h * 7) % 18) + 1, yardagePerTeeJson: '{}', tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  await db.insert(events).values({
    id: ids.eventId, name: 'Test', startDate: now, endDate: now + 86400000,
    timezone: 'America/New_York', organizerPlayerId: ids.organizerId, createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.eventRoundId, eventId: ids.eventId, roundNumber: 1, roundDate: now,
    courseRevisionId: courseRevId, teeColor: 'blue', holesToPlay: 18, createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(rounds).values({
    id: ids.roundId, eventId: ids.eventId, eventRoundId: ids.eventRoundId, holesToPlay: 18,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(groups).values({
    id: groupId, eventId: ids.eventId, name: 'G', moneyVisibilityMode: 'open', createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  // Roster = Rick, Ben (playing) + Kyle, Steven (non-playing backers).
  for (const pid of [ids.rick, ids.ben, ids.kyle, ids.steven]) {
    await db.insert(groupMembers).values({
      groupId, playerId: pid, tenantId: TENANT_ID, contextId: ctx,
    });
  }
  // Only Rick + Ben are paired (they tee off); Kyle/Steven never play.
  await db.insert(pairings).values({
    id: pairingId, eventRoundId: ids.eventRoundId, foursomeNumber: 1, createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  let slot = 1;
  for (const pid of [ids.rick, ids.ben]) {
    await db.insert(pairingMembers).values({
      pairingId, playerId: pid, slotNumber: slot++, tenantId: TENANT_ID, contextId: ctx,
    });
  }
  return ids;
}

/** Record gross scores for a player on holes 1..count. base=4 baseline; bump adds a stroke on hole `bumpHole`. */
async function scorePlayer(
  ids: SeedIds,
  playerId: string,
  opts: { count?: number; bumpHole?: number } = {},
): Promise<void> {
  const now = Date.now();
  const count = opts.count ?? 18;
  for (let h = 1; h <= count; h++) {
    const gross = h === opts.bumpHole ? 5 : 4;
    await db.insert(holeScores).values({
      id: randomUUID(), roundId: ids.roundId, playerId, holeNumber: h, grossStrokes: gross, putts: 2,
      scorerPlayerId: ids.rick, clientEventId: `evt-${playerId}-${h}`, createdAt: now, updatedAt: now,
      tenantId: TENANT_ID, contextId: `event:${ids.eventId}`,
    });
  }
}

function buildApp(actorId: string, isOrganizer = true): Hono {
  __testPlayer = { id: actorId, isOrganizer };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/admin', adminEventBetsRouter);
  return app;
}

function h2hNetBody(ids: SeedIds, sideA: { st: string; su: string }, sideB: { st: string; su: string }) {
  return {
    eventRoundId: ids.eventRoundId,
    betType: 'h2h',
    basis: 'net',
    holeScope: 'full18',
    stakeCents: 2000,
    sideA: { stakeholderPlayerId: sideA.st, subjectPlayerId: sideA.su },
    sideB: { stakeholderPlayerId: sideB.st, subjectPlayerId: sideB.su },
  };
}

async function postBet(app: Hono, eventId: string, body: unknown): Promise<Response> {
  return app.request(`/api/admin/events/${eventId}/bets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchBet(app: Hono, eventId: string, betId: string, body: unknown): Promise<Response> {
  return app.request(`/api/admin/events/${eventId}/bets/${betId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function voidBet(app: Hono, eventId: string, betId: string): Promise<Response> {
  return app.request(`/api/admin/events/${eventId}/bets/${betId}/void`, { method: 'POST' });
}

async function listBets(app: Hono, eventId: string) {
  return (await (await app.request(`/api/admin/events/${eventId}/bets`)).json()) as {
    bets: Array<{ betId: string; state: string; stakeCents: number; winnerSubjectId: string | null }>;
  };
}

describe('POST/GET /api/admin/events/:eventId/bets — Story 1.1', () => {
  test('organizer creates an h2h-net bet; it lists as provisional with no scores', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);
    const res = await postBet(app, ids.eventId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }));
    expect(res.status).toBe(200);
    const { betId } = (await res.json()) as { betId: string };
    expect(betId).toBeTruthy();

    const list = await app.request(`/api/admin/events/${ids.eventId}/bets`);
    expect(list.status).toBe(200);
    const body = (await list.json()) as { bets: Array<{ betId: string; state: string }> };
    expect(body.bets.length).toBe(1);
    expect(body.bets[0]!.betId).toBe(betId);
    expect(body.bets[0]!.state).toBe('provisional');

    // Audit + activity rows written in the same tx (FR45/NFR-S3).
    const aud = await db.select().from(auditLog);
    expect(aud.some((r) => r.eventType === 'action_bet.created' && r.entityId === betId)).toBe(true);
    const act = await db.select().from(activity);
    expect(act.some((r) => r.type === 'action_bet.created')).toBe(true);
  });

  test('non-event-organizer is rejected (403)', async () => {
    const ids = await seed();
    // Authenticated organizer-role player, but NOT this event's organizer.
    const app = buildApp(ids.outsiderId, true);
    const res = await postBet(app, ids.eventId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_event_organizer');
  });

  test('FR50: same player on both stakeholder sides is rejected (400)', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);
    const res = await postBet(app, ids.eventId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.rick, su: ids.ben }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('same_stakeholder_both_sides');
  });

  test('FR49: betting closes once an in-scope score exists (422)', async () => {
    const ids = await seed();
    await scorePlayer(ids, ids.rick, { count: 1 }); // hole 1 scored — in scope for full18
    const app = buildApp(ids.organizerId);
    const res = await postBet(app, ids.eventId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('betting_closed_scores_exist');
  });

  test('settles into pairwise settle-up: Rick beats Ben → Ben pays Rick the stake', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);
    const { betId } = (await (
      await postBet(app, ids.eventId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }))
    ).json()) as { betId: string };

    // Rick 72 (all 4s); Ben 73 (one 5 on hole 7). Lower wins → Rick.
    await scorePlayer(ids, ids.rick);
    await scorePlayer(ids, ids.ben, { bumpHole: 7 });

    const list = (await (await app.request(`/api/admin/events/${ids.eventId}/bets`)).json()) as {
      bets: Array<{ betId: string; state: string; winnerSubjectId: string | null }>;
    };
    expect(list.bets[0]!.state).toBe('settled');
    expect(list.bets[0]!.winnerSubjectId).toBe(ids.rick);

    // Folds into the EXISTING combined matrix + the action ledger split.
    const matrix = await computeMoneyMatrix(db, ids.eventId, ids.rick, TENANT_ID);
    expect(matrix.matrix[ids.rick]![ids.ben]).toBe(2000);
    expect(matrix.matrix[ids.ben]![ids.rick]).toBe(-2000);
    expect(matrix.actionLedger.matrix[ids.rick]![ids.ben]).toBe(2000);
    expect(matrix.totals[ids.rick]).toBe(2000);
    expect(matrix.totals[ids.ben]).toBe(-2000);

    // My Money board: Rick +2000, Ben -2000; per-hole sums to round net (invariant).
    const rickMM = await computeMyMoney(db, ids.eventId, ids.rick, TENANT_ID);
    const actionGame = rickMM.games.find((g) => g.key === betId);
    expect(actionGame?.kind).toBe('action');
    expect(actionGame?.netToViewerCents).toBe(2000);
    for (const g of rickMM.games) {
      for (const r of g.perRound) {
        expect(r.perHole.reduce((a, h) => a + h.moneyToViewerCents, 0)).toBe(r.netToViewerCents);
      }
    }
    expect(rickMM.totalNetCents).toBe(matrix.totals[ids.rick]);
  });

  test('FR26/FR39: a level (push) bet contributes nothing to settle-up', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);
    await (await postBet(app, ids.eventId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }))).json();
    // Both shoot 72 → push.
    await scorePlayer(ids, ids.rick);
    await scorePlayer(ids, ids.ben);

    const list = (await (await app.request(`/api/admin/events/${ids.eventId}/bets`)).json()) as {
      bets: Array<{ state: string }>;
    };
    expect(list.bets[0]!.state).toBe('push');
    const matrix = await computeMoneyMatrix(db, ids.eventId, ids.rick, TENANT_ID);
    expect(matrix.matrix[ids.rick]![ids.ben]).toBe(0);
    expect(matrix.totals[ids.rick]).toBe(0);
  });

  test('Story 1.2: per-hole match-play (net) settles by hole-margin into settle-up', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);
    const { betId } = (await (
      await postBet(app, ids.eventId, {
        eventRoundId: ids.eventRoundId,
        betType: 'per_hole_match',
        basis: 'net',
        holeScope: 'full18',
        stakeCents: 500,
        sideA: { stakeholderPlayerId: ids.rick, subjectPlayerId: ids.rick },
        sideB: { stakeholderPlayerId: ids.ben, subjectPlayerId: ids.ben },
      })
    ).json()) as { betId: string };

    // Rick beats Ben on holes 1-3 (gross 4 vs 5); Ben beats Rick on hole 4;
    // holes 5-18 tie. Rick wins 3, loses 1 → 2 up. 2 × $5 = $10.00.
    const now = Date.now();
    const ctx = `event:${ids.eventId}`;
    for (let h = 1; h <= 18; h++) {
      const rickGross = h === 4 ? 5 : 4;
      const benGross = h <= 3 ? 5 : h === 4 ? 4 : 4;
      await db.insert(holeScores).values({
        id: randomUUID(), roundId: ids.roundId, playerId: ids.rick, holeNumber: h, grossStrokes: rickGross,
        putts: 2, scorerPlayerId: ids.rick, clientEventId: `r-${h}`, createdAt: now, updatedAt: now,
        tenantId: TENANT_ID, contextId: ctx,
      });
      await db.insert(holeScores).values({
        id: randomUUID(), roundId: ids.roundId, playerId: ids.ben, holeNumber: h, grossStrokes: benGross,
        putts: 2, scorerPlayerId: ids.rick, clientEventId: `b-${h}`, createdAt: now, updatedAt: now,
        tenantId: TENANT_ID, contextId: ctx,
      });
    }

    const list = (await (await app.request(`/api/admin/events/${ids.eventId}/bets`)).json()) as {
      bets: Array<{ betId: string; betType: string; state: string; winnerSubjectId: string | null; marginNet: number }>;
    };
    expect(list.bets[0]!.betType).toBe('per_hole_match');
    expect(list.bets[0]!.state).toBe('settled');
    expect(list.bets[0]!.winnerSubjectId).toBe(ids.rick);
    expect(list.bets[0]!.marginNet).toBe(2); // 2 holes up

    const matrix = await computeMoneyMatrix(db, ids.eventId, ids.rick, TENANT_ID);
    expect(matrix.matrix[ids.rick]![ids.ben]).toBe(1000); // 2 × 500c
    expect(matrix.actionLedger.matrix[ids.rick]![ids.ben]).toBe(1000);
    expect(betId).toBeTruthy();
  });

  test('over_under (gross): subject under the line → over-backer pays under-backer the stake', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);
    // Line 80 on Rick; Ben backs UNDER (side A), Steven backs OVER (side B).
    const { betId } = (await (
      await postBet(app, ids.eventId, {
        eventRoundId: ids.eventRoundId,
        betType: 'over_under',
        basis: 'gross',
        holeScope: 'full18',
        stakeCents: 1000,
        line: 80,
        sideA: { stakeholderPlayerId: ids.ben, subjectPlayerId: ids.rick },
        sideB: { stakeholderPlayerId: ids.steven, subjectPlayerId: ids.rick },
      })
    ).json()) as { betId: string };

    // Rick shoots 4 on every hole = 72 gross < 80 → UNDER wins. Only the
    // subject's scores matter for over_under.
    const now = Date.now();
    const ctx = `event:${ids.eventId}`;
    for (let h = 1; h <= 18; h++) {
      await db.insert(holeScores).values({
        id: randomUUID(), roundId: ids.roundId, playerId: ids.rick, holeNumber: h, grossStrokes: 4,
        putts: 2, scorerPlayerId: ids.rick, clientEventId: `r-${h}`, createdAt: now, updatedAt: now,
        tenantId: TENANT_ID, contextId: ctx,
      });
    }

    const list = (await (await app.request(`/api/admin/events/${ids.eventId}/bets`)).json()) as {
      bets: Array<{ betId: string; betType: string; state: string; line: number | null; winnerSubjectId: string | null }>;
    };
    expect(list.bets[0]!.betType).toBe('over_under');
    expect(list.bets[0]!.line).toBe(80);
    expect(list.bets[0]!.state).toBe('settled');

    // Over-backer (Steven) pays under-backer (Ben) the stake. The matrix is
    // keyed [receiver][payer], so Ben (who collects) is owed by Steven.
    const matrix = await computeMoneyMatrix(db, ids.eventId, ids.ben, TENANT_ID);
    expect(matrix.matrix[ids.ben]![ids.steven]).toBe(1000);
    expect(matrix.actionLedger.matrix[ids.ben]![ids.steven]).toBe(1000);
    expect(betId).toBeTruthy();
  });

  test('over_under requires a line → 400 over_under_needs_line', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);
    const res = await postBet(app, ids.eventId, {
      eventRoundId: ids.eventRoundId,
      betType: 'over_under',
      basis: 'gross',
      holeScope: 'full18',
      stakeCents: 1000,
      // line omitted
      sideA: { stakeholderPlayerId: ids.ben, subjectPlayerId: ids.rick },
      sideB: { stakeholderPlayerId: ids.steven, subjectPlayerId: ids.rick },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('over_under_needs_line');
  });

  test('Story 1.3: h2h gross settles on GROSS — gross winner differs from net winner', async () => {
    const ids = await seed();
    // Give Ben an 18 handicap: his NET would win, but his GROSS loses. A gross
    // bet resolving to Rick proves the gross column (not net) was used.
    await db
      .update(players)
      .set({ manualHandicapIndex: 18 })
      .where(and(eq(players.id, ids.ben), eq(players.tenantId, TENANT_ID)));
    const app = buildApp(ids.organizerId);
    const { betId } = (await (
      await postBet(app, ids.eventId, {
        eventRoundId: ids.eventRoundId,
        betType: 'h2h',
        basis: 'gross',
        holeScope: 'full18',
        stakeCents: 2500,
        sideA: { stakeholderPlayerId: ids.rick, subjectPlayerId: ids.rick },
        sideB: { stakeholderPlayerId: ids.ben, subjectPlayerId: ids.ben },
      })
    ).json()) as { betId: string };

    // Rick gross 72 (all 4s). Ben gross 76 (5 on holes 1-4). Gross: Rick wins
    // (72 < 76). Net: Ben 76 − 18 = 58 beats Rick 72 — a NET bet would flip.
    await scorePlayer(ids, ids.rick); // all 4s
    const now = Date.now();
    const ctx = `event:${ids.eventId}`;
    for (let h = 1; h <= 18; h++) {
      await db.insert(holeScores).values({
        id: randomUUID(), roundId: ids.roundId, playerId: ids.ben, holeNumber: h,
        grossStrokes: h <= 4 ? 5 : 4, putts: 2, scorerPlayerId: ids.rick,
        clientEventId: `bg-${h}`, createdAt: now, updatedAt: now, tenantId: TENANT_ID, contextId: ctx,
      });
    }

    const list = (await (await app.request(`/api/admin/events/${ids.eventId}/bets`)).json()) as {
      bets: Array<{ betId: string; basis: string; state: string; winnerSubjectId: string | null; marginNet: number }>;
    };
    expect(list.bets[0]!.basis).toBe('gross');
    expect(list.bets[0]!.state).toBe('settled');
    expect(list.bets[0]!.winnerSubjectId).toBe(ids.rick); // gross winner, not net
    expect(list.bets[0]!.marginNet).toBe(4); // |72 − 76| gross

    const matrix = await computeMoneyMatrix(db, ids.eventId, ids.rick, TENANT_ID);
    expect(matrix.matrix[ids.rick]![ids.ben]).toBe(2500); // winner-take-stake
    expect(betId).toBeTruthy();
  });

  test('FR12: putts basis is rejected for per_hole_match at creation (400)', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);
    const res = await postBet(app, ids.eventId, {
      eventRoundId: ids.eventRoundId,
      betType: 'per_hole_match',
      basis: 'putts',
      holeScope: 'full18',
      stakeCents: 500,
      sideA: { stakeholderPlayerId: ids.rick, subjectPlayerId: ids.rick },
      sideB: { stakeholderPlayerId: ids.ben, subjectPlayerId: ids.ben },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('unsupported_basis');
  });

  test('open book (FR8/FR10/FR38): non-playing backer Kyle collects and appears in settle-up', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);
    // Kyle backs Rick; Steven backs Ben. Neither Kyle nor Steven plays.
    await (await postBet(app, ids.eventId, h2hNetBody(ids, { st: ids.kyle, su: ids.rick }, { st: ids.steven, su: ids.ben }))).json();
    await scorePlayer(ids, ids.rick); // 72
    await scorePlayer(ids, ids.ben, { bumpHole: 7 }); // 73 → Rick wins → Kyle collects

    const matrix = await computeMoneyMatrix(db, ids.eventId, ids.kyle, TENANT_ID);
    // Edge is between STAKEHOLDERS (Steven → Kyle), never the subjects.
    expect(matrix.matrix[ids.kyle]![ids.steven]).toBe(2000);
    expect(matrix.matrix[ids.steven]![ids.kyle]).toBe(-2000);
    // Kyle never teed off but is in settle-up (FR38).
    expect(matrix.players.some((p) => p.id === ids.kyle)).toBe(true);
    expect(matrix.totals[ids.kyle]).toBe(2000);
  });
});

describe('PATCH/POST-void /api/admin/events/:eventId/bets/:betId — Story 1.4', () => {
  test('edit recomputes settle-up (FR4): changing the stake changes the amount owed', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);
    const { betId } = (await (
      await postBet(app, ids.eventId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }))
    ).json()) as { betId: string };

    // Rick beats Ben → Ben owes Rick the stake (2000c at create time).
    await scorePlayer(ids, ids.rick);
    await scorePlayer(ids, ids.ben, { bumpHole: 7 });

    let matrix = await computeMoneyMatrix(db, ids.eventId, ids.rick, TENANT_ID);
    expect(matrix.matrix[ids.rick]![ids.ben]).toBe(2000);

    // Organizer corrects the stake to 5000c after play (admin may correct
    // anytime — no override); recompute-on-read must reflect it.
    const res = await patchBet(app, ids.eventId, betId, {
      ...h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }),
      stakeCents: 5000,
    });
    expect(res.status).toBe(200);

    const list = await listBets(app, ids.eventId);
    expect(list.bets[0]!.stakeCents).toBe(5000);
    expect(list.bets[0]!.state).toBe('settled');

    matrix = await computeMoneyMatrix(db, ids.eventId, ids.rick, TENANT_ID);
    expect(matrix.matrix[ids.rick]![ids.ben]).toBe(5000);
    expect(matrix.matrix[ids.ben]![ids.rick]).toBe(-5000);
    expect(matrix.totals[ids.rick]).toBe(5000);

    // Edit writes a before/after audit row + activity, in the same tx.
    const aud = await db.select().from(auditLog);
    const edit = aud.find((r) => r.eventType === 'action_bet.edited' && r.entityId === betId);
    expect(edit).toBeTruthy();
    const payload = JSON.parse(edit!.payloadJson) as { before: { stakeCents: number }; after: { stakeCents: number } };
    expect(payload.before.stakeCents).toBe(2000);
    expect(payload.after.stakeCents).toBe(5000);
    const act = await db.select().from(activity);
    expect(act.some((r) => r.type === 'action_bet.edited')).toBe(true);
  });

  test('void: bet drops out of settle-up, ledger stays zero-sum (FR5/FR47), audit preserved', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);
    const { betId } = (await (
      await postBet(app, ids.eventId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }))
    ).json()) as { betId: string };
    await scorePlayer(ids, ids.rick);
    await scorePlayer(ids, ids.ben, { bumpHole: 7 });

    // Settled before void.
    let matrix = await computeMoneyMatrix(db, ids.eventId, ids.rick, TENANT_ID);
    expect(matrix.matrix[ids.rick]![ids.ben]).toBe(2000);

    const res = await voidBet(app, ids.eventId, betId);
    expect(res.status).toBe(200);

    const list = await listBets(app, ids.eventId);
    expect(list.bets[0]!.state).toBe('void');

    // No contribution to settle-up; every total nets to zero.
    matrix = await computeMoneyMatrix(db, ids.eventId, ids.rick, TENANT_ID);
    expect(matrix.matrix[ids.rick]![ids.ben]).toBe(0);
    expect(matrix.matrix[ids.ben]![ids.rick]).toBe(0);
    for (const p of matrix.players) {
      expect(matrix.totals[p.id]).toBe(0);
    }

    // Audit history preserved: both the create and the void rows exist.
    const aud = await db.select().from(auditLog);
    expect(aud.some((r) => r.eventType === 'action_bet.created' && r.entityId === betId)).toBe(true);
    expect(aud.some((r) => r.eventType === 'action_bet.voided' && r.entityId === betId)).toBe(true);
    const act = await db.select().from(activity);
    expect(act.some((r) => r.type === 'action_bet.voided')).toBe(true);
  });

  test('terminal-state guards: a voided bet cannot be voided again or edited (409)', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);
    const { betId } = (await (
      await postBet(app, ids.eventId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }))
    ).json()) as { betId: string };
    expect((await voidBet(app, ids.eventId, betId)).status).toBe(200);

    const again = await voidBet(app, ids.eventId, betId);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code: string }).code).toBe('cannot_void_terminal');

    const edit = await patchBet(app, ids.eventId, betId, {
      ...h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }),
      stakeCents: 9000,
    });
    expect(edit.status).toBe(409);
    expect(((await edit.json()) as { code: string }).code).toBe('cannot_edit_terminal');
  });

  test('edit/void of an unknown bet → 404', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);
    const ghost = randomUUID();
    const edit = await patchBet(app, ids.eventId, ghost, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }));
    expect(edit.status).toBe(404);
    expect(((await edit.json()) as { code: string }).code).toBe('bet_not_found');
    const v = await voidBet(app, ids.eventId, ghost);
    expect(v.status).toBe(404);
  });

  test('edit re-validates params: same stakeholder on both sides → 400', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);
    const { betId } = (await (
      await postBet(app, ids.eventId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }))
    ).json()) as { betId: string };
    const res = await patchBet(app, ids.eventId, betId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.rick, su: ids.ben }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('same_stakeholder_both_sides');
  });

  test('non-event-organizer cannot edit or void (403)', async () => {
    const ids = await seed();
    const owner = buildApp(ids.organizerId);
    const { betId } = (await (
      await postBet(owner, ids.eventId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }))
    ).json()) as { betId: string };

    const intruder = buildApp(ids.outsiderId, true);
    const edit = await patchBet(intruder, ids.eventId, betId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }));
    expect(edit.status).toBe(403);
    const v = await voidBet(intruder, ids.eventId, betId);
    expect(v.status).toBe(403);
  });

  test('FR49 admin override: create after an in-scope score exists is allowed only with override (audited)', async () => {
    const ids = await seed();
    await scorePlayer(ids, ids.rick, { count: 1 }); // hole 1 scored — in scope for full18
    const app = buildApp(ids.organizerId);

    // Without override → blocked (regression with the Story 1.1 cutoff test).
    const blocked = await postBet(app, ids.eventId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }));
    expect(blocked.status).toBe(422);

    // With override → allowed, and the override is recorded in the audit row.
    const res = await postBet(app, ids.eventId, {
      ...h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }),
      override: true,
    });
    expect(res.status).toBe(200);
    const { betId } = (await res.json()) as { betId: string };
    const aud = await db.select().from(auditLog);
    const created = aud.find((r) => r.eventType === 'action_bet.created' && r.entityId === betId);
    expect((JSON.parse(created!.payloadJson) as { override: boolean }).override).toBe(true);
  });

  test('admin may correct a bet anytime: an edit after scores exist is allowed (no override) and audited', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);
    // Bet placed before any score (legitimately).
    const { betId } = (await (
      await postBet(app, ids.eventId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }))
    ).json()) as { betId: string };
    // Now scores arrive on in-scope holes — the admin can still correct the bet
    // (the audit + UI confirmation are the safety net, not a hard block).
    await scorePlayer(ids, ids.rick, { count: 1 });

    const ok = await patchBet(app, ids.eventId, betId, {
      ...h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }),
      stakeCents: 7000,
    });
    expect(ok.status).toBe(200);
    const list = await listBets(app, ids.eventId);
    expect(list.bets[0]!.stakeCents).toBe(7000);
    const aud = await db.select().from(auditLog);
    const edit = aud.find((r) => r.eventType === 'action_bet.edited' && r.entityId === betId);
    const payload = JSON.parse(edit!.payloadJson) as { before: { stakeCents: number }; after: { stakeCents: number } };
    expect(payload.before.stakeCents).toBe(2000);
    expect(payload.after.stakeCents).toBe(7000);
  });

  test('whole-dollar stakes only: a stake with cents is rejected on create AND edit (400)', async () => {
    const ids = await seed();
    const app = buildApp(ids.organizerId);

    // Create with $25.50 → rejected.
    const badCreate = await postBet(app, ids.eventId, {
      ...h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }),
      stakeCents: 2550,
    });
    expect(badCreate.status).toBe(400);
    expect(((await badCreate.json()) as { code: string }).code).toBe('non_whole_dollar_stake');

    // Create a valid whole-dollar bet, then try to edit it to a cents value.
    const { betId } = (await (
      await postBet(app, ids.eventId, h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }))
    ).json()) as { betId: string };
    const badEdit = await patchBet(app, ids.eventId, betId, {
      ...h2hNetBody(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }),
      stakeCents: 2599,
    });
    expect(badEdit.status).toBe(400);
    expect(((await badEdit.json()) as { code: string }).code).toBe('non_whole_dollar_stake');
  });
});
