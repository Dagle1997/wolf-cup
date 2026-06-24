/**
 * Player self-serve "The Action" betting + the public board (visibility).
 *
 * Proves: a participant posts their own bet (must be a stakeholder); the public
 * board is AUDIENCE-BOUNDED — 'event_wide' bets show to every participant,
 * 'stakeholders_only' bets show ONLY to their stakeholders (+ the organizer).
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
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
  requireSession: async (c: import('hono').Context, next: () => Promise<void>) => {
    if (!__testPlayer) return c.json({ error: 'unauthorized', code: 'no_test_player' }, 401);
    c.set('player', __testPlayer);
    c.set('session', { sessionId: 'test', playerId: __testPlayer.id });
    await next();
  },
}));

const { db } = await import('../db/index.js');
const {
  players, courses, courseRevisions, courseTees, courseHoles, events, eventRounds,
  groups, groupMembers, pairings, pairingMembers, rounds, holeScores, bets, betSides,
  activity, auditLog,
} = await import('../db/schema/index.js');
const { eventsActionBetsRouter } = await import('./events-action-bets.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});
beforeEach(async () => {
  for (const t of [activity, auditLog, betSides, bets, holeScores, pairingMembers, pairings, rounds, eventRounds, groupMembers, groups, events, courseHoles, courseTees, courseRevisions, courses, players]) {
    await db.delete(t);
  }
});

interface SeedIds {
  organizerId: string; rick: string; ben: string; kyle: string;
  eventId: string; eventRoundId: string; roundId: string;
}

/** Rick, Ben, Kyle are all roster members (pass requireEventParticipant). Organizer is separate. */
async function seed(): Promise<SeedIds> {
  const now = Date.now();
  const ids: SeedIds = {
    organizerId: randomUUID(), rick: randomUUID(), ben: randomUUID(), kyle: randomUUID(),
    eventId: randomUUID(), eventRoundId: randomUUID(), roundId: randomUUID(),
  };
  const courseId = randomUUID(), courseRevId = randomUUID(), groupId = randomUUID(), pairingId = randomUUID();
  const ctx = `event:${ids.eventId}`;
  for (const [id, name] of [
    [ids.organizerId, 'Organizer'], [ids.rick, 'Rick'], [ids.ben, 'Ben'], [ids.kyle, 'Kyle'],
  ] as Array<[string, string]>) {
    await db.insert(players).values({ id, isOrganizer: false, createdAt: now, name, manualHandicapIndex: 0, tenantId: TENANT_ID, contextId: 'league:guyan' });
  }
  await db.insert(courses).values({ id: courseId, name: 'C', clubName: 'CC', createdAt: now, tenantId: TENANT_ID, contextId: 'league:guyan' });
  await db.insert(courseRevisions).values({ id: courseRevId, courseId, revisionNumber: 1, sourceUrl: null, extractionDate: null, verified: false, outTotal: 36, inTotal: 36, courseTotal: 72, createdAt: now, tenantId: TENANT_ID, contextId: 'league:guyan' });
  await db.insert(courseTees).values({ id: randomUUID(), courseRevisionId: courseRevId, teeColor: 'blue', rating: 720, slope: 113, tenantId: TENANT_ID, contextId: 'league:guyan' });
  for (let h = 1; h <= 18; h++) {
    await db.insert(courseHoles).values({ id: randomUUID(), courseRevisionId: courseRevId, holeNumber: h, par: 4, si: ((h * 7) % 18) + 1, yardagePerTeeJson: '{}', tenantId: TENANT_ID, contextId: 'league:guyan' });
  }
  await db.insert(events).values({ id: ids.eventId, name: 'Test', startDate: now, endDate: now + 86400000, timezone: 'America/New_York', organizerPlayerId: ids.organizerId, createdAt: now, tenantId: TENANT_ID, contextId: ctx });
  await db.insert(eventRounds).values({ id: ids.eventRoundId, eventId: ids.eventId, roundNumber: 1, roundDate: now, courseRevisionId: courseRevId, teeColor: 'blue', holesToPlay: 18, createdAt: now, tenantId: TENANT_ID, contextId: ctx });
  await db.insert(rounds).values({ id: ids.roundId, eventId: ids.eventId, eventRoundId: ids.eventRoundId, holesToPlay: 18, createdAt: now, tenantId: TENANT_ID, contextId: ctx });
  await db.insert(groups).values({ id: groupId, eventId: ids.eventId, name: 'G', moneyVisibilityMode: 'open', createdAt: now, tenantId: TENANT_ID, contextId: ctx });
  for (const pid of [ids.rick, ids.ben, ids.kyle]) {
    await db.insert(groupMembers).values({ groupId, playerId: pid, tenantId: TENANT_ID, contextId: ctx });
  }
  await db.insert(pairings).values({ id: pairingId, eventRoundId: ids.eventRoundId, foursomeNumber: 1, createdAt: now, tenantId: TENANT_ID, contextId: ctx });
  let slot = 1;
  for (const pid of [ids.rick, ids.ben]) {
    await db.insert(pairingMembers).values({ pairingId, playerId: pid, slotNumber: slot++, tenantId: TENANT_ID, contextId: ctx });
  }
  return ids;
}

function appAs(actorId: string, isOrganizer = false): Hono {
  __testPlayer = { id: actorId, isOrganizer };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/events', eventsActionBetsRouter);
  return app;
}

function body(ids: SeedIds, a: { st: string; su: string }, b: { st: string; su: string }, visibility?: string) {
  return {
    eventRoundId: ids.eventRoundId, betType: 'h2h', basis: 'net', holeScope: 'full18', stakeCents: 2000,
    sideA: { stakeholderPlayerId: a.st, subjectPlayerId: a.su },
    sideB: { stakeholderPlayerId: b.st, subjectPlayerId: b.su },
    ...(visibility ? { visibility } : {}),
  };
}

async function post(app: Hono, eventId: string, b: unknown) {
  return app.request(`/api/events/${eventId}/action-bets`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
  });
}
async function board(app: Hono, eventId: string) {
  const res = await app.request(`/api/events/${eventId}/action-board`);
  return res;
}

describe('player self-serve action bet creation', () => {
  test('a participant who is a stakeholder can post a bet (200)', async () => {
    const ids = await seed();
    const res = await post(appAs(ids.rick), ids.eventId, body(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  test('a participant who is NOT a stakeholder on the bet is rejected (creator_not_a_stakeholder)', async () => {
    const ids = await seed();
    // Kyle tries to put Rick's and Ben's money on a bet with no stake of his own.
    const res = await post(appAs(ids.kyle), ids.eventId, body(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('creator_not_a_stakeholder');
  });

  test('a non-roster outsider cannot reach the route (participant gate)', async () => {
    const ids = await seed();
    const res = await post(appAs(randomUUID()), ids.eventId, body(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }));
    expect(res.status).toBe(403);
  });

  test('cannot drag an UNINVOLVED third party in as a backer (third_party_stakeholder)', async () => {
    const ids = await seed();
    // Rick (creator/stakeholder A) tries to put Kyle's money on side B for a bet
    // between Rick and Ben — Kyle is neither the creator nor a subject.
    const res = await post(appAs(ids.rick), ids.eventId, body(ids, { st: ids.rick, su: ids.rick }, { st: ids.kyle, su: ids.ben }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('third_party_stakeholder');
  });

  test('self-serve stake is capped ($1,000) — stake_exceeds_self_serve_cap', async () => {
    const ids = await seed();
    const b = { ...body(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }), stakeCents: 200_000 };
    const res = await post(appAs(ids.rick), ids.eventId, b);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('stake_exceeds_self_serve_cap');
  });
});

describe('privacy: a stakeholders_only bet is NOT broadcast to the event activity feed', () => {
  test('event_wide create emits a feed activity; stakeholders_only create does NOT', async () => {
    const ids = await seed();

    await post(appAs(ids.rick), ids.eventId, body(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben })); // event_wide (default)
    const afterPublic = await db.select().from(activity);
    expect(afterPublic.length).toBeGreaterThan(0); // public bet announced on the feed
    const countAfterPublic = afterPublic.length;

    await post(appAs(ids.rick), ids.eventId, body(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }, 'stakeholders_only'));
    const afterPrivate = await db.select().from(activity);
    // The private bet must add NO new event-wide feed row (count unchanged).
    expect(afterPrivate.length).toBe(countAfterPublic);
  });
});

describe('public action board — audience bounding', () => {
  test('event_wide bet shows to a non-stakeholder participant', async () => {
    const ids = await seed();
    await post(appAs(ids.rick), ids.eventId, body(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben })); // default event_wide
    const res = await board(appAs(ids.kyle), ids.eventId); // Kyle is a participant but NOT a stakeholder
    expect(res.status).toBe(200);
    const json = (await res.json()) as { bets: Array<{ visibility: string }> };
    expect(json.bets).toHaveLength(1);
    expect(json.bets[0]!.visibility).toBe('event_wide');
  });

  test('stakeholders_only bet is HIDDEN from a non-stakeholder, VISIBLE to a stakeholder + organizer', async () => {
    const ids = await seed();
    await post(appAs(ids.rick), ids.eventId, body(ids, { st: ids.rick, su: ids.rick }, { st: ids.ben, su: ids.ben }, 'stakeholders_only'));

    const kyleSees = (await (await board(appAs(ids.kyle), ids.eventId)).json()) as { bets: unknown[] };
    expect(kyleSees.bets).toHaveLength(0); // non-stakeholder participant: hidden

    const benSees = (await (await board(appAs(ids.ben), ids.eventId)).json()) as { bets: Array<{ visibility: string }> };
    expect(benSees.bets).toHaveLength(1); // stakeholder: visible
    expect(benSees.bets[0]!.visibility).toBe('stakeholders_only');

    const orgSees = (await (await board(appAs(ids.organizerId, true), ids.eventId)).json()) as { bets: unknown[] };
    expect(orgSees.bets).toHaveLength(1); // organizer always sees all
  });
});
