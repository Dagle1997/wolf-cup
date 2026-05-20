/**
 * T7-5 GET /api/events/:eventId/export/raw integration tests.
 *
 * Covers AC-1..AC-9:
 *  (a) Happy path — populated fixture (2 rounds, hole scores, 1 bet, 1 gallery photo,
 *      audit rows seeded for every known entity_type) — all top-level keys present,
 *      type invariants hold, filename header parses cleanly.
 *  (b) Empty event — no rounds, no scores — 200 with empty arrays.
 *  (c) Auth — anonymous 401, non-organizer 403, non-existent event 404.
 *  (d) Round-trip — export → re-insert into a fresh DB → recompute money matrix →
 *      asserts deep-equal the exported moneyMatrix.matrix.
 *  (e) Filename slug edge cases.
 *  (f) auditLog filtering — seed audit rows for THIS event AND for an unrelated
 *      event; export's auditLog contains only THIS event's rows.
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
  const dbInstance = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db: dbInstance };
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
  events,
  eventRounds,
  rounds,
  roundStates,
  holeScores,
  groups,
  groupMembers,
  invites,
  ruleSets,
  ruleSetRevisions,
  pairings,
  pairingMembers,
  individualBets,
  individualBetRounds,
  individualBetPresses,
  teamPressLog,
  subGames,
  subGameParticipants,
  subGameResults,
  galleryPhotos,
  auditLog,
  courses,
  courseRevisions,
  courseTees,
  courseHoles,
  players,
  scoreCorrections,
  scorerAssignments,
} = await import('../db/schema/index.js');
const { exportRouter } = await import('./export.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');
const { buildEventExport } = await import('../services/export.js');
const { computeMoneyMatrix } = await import('../services/money.js');

const TENANT_ID = 'guyan';
const CTX_LEAGUE = 'league:guyan-wolf-cup-friday';

type SeedResult = {
  organizerId: string;
  participantAId: string;
  participantBId: string;
  outsiderId: string;
  eventId: string;
  unrelatedEventId: string;
  roundId: string | null;
  eventRoundId: string | null;
  ruleSetRevisionId: string | null;
  betId: string | null;
  subGameId: string | null;
  galleryPhotoId: string | null;
  unrelatedRoundId: string | null;
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  // Reset every table the seed touches, in FK-safe order.
  await db.delete(auditLog);
  await db.delete(galleryPhotos);
  await db.delete(subGameResults);
  await db.delete(subGameParticipants);
  await db.delete(subGames);
  await db.delete(teamPressLog);
  await db.delete(individualBetPresses);
  await db.delete(individualBetRounds);
  await db.delete(individualBets);
  await db.delete(scorerAssignments);
  await db.delete(scoreCorrections);
  await db.delete(holeScores);
  await db.delete(roundStates);
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(rounds);
  await db.delete(ruleSetRevisions);
  await db.delete(ruleSets);
  await db.delete(invites);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
  __testPlayer = null;
});

type SeedOpts = {
  populated?: boolean;
  unrelatedEvent?: boolean;
};

async function seed(opts: SeedOpts = {}): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    participantAId: randomUUID(),
    participantBId: randomUUID(),
    outsiderId: randomUUID(),
    eventId: randomUUID(),
    unrelatedEventId: randomUUID(),
    courseId: randomUUID(),
    revId: randomUUID(),
    erId: randomUUID(),
    er2Id: randomUUID(),
    roundId: randomUUID(),
    round2Id: randomUUID(),
    unrelatedErId: randomUUID(),
    unrelatedRoundId: randomUUID(),
    groupId: randomUUID(),
    ruleSetId: randomUUID(),
    ruleSetRevisionId: randomUUID(),
    betId: randomUUID(),
    subGameId: randomUUID(),
    galleryPhotoId: randomUUID(),
    pairingId: randomUUID(),
  };
  const ctx = `event:${ids.eventId}`;
  const ctxOther = `event:${ids.unrelatedEventId}`;

  for (const [id, name, isOrg] of [
    [ids.organizerId, 'Organizer', true],
    [ids.participantAId, 'Player A', false],
    [ids.participantBId, 'Player B', false],
    [ids.outsiderId, 'Outsider', false],
  ] as Array<[string, string, boolean]>) {
    await db.insert(players).values({
      id,
      isOrganizer: isOrg,
      createdAt: now,
      name,
      tenantId: TENANT_ID,
      contextId: CTX_LEAGUE,
    });
  }

  await db.insert(courses).values({
    id: ids.courseId,
    name: 'Pine Needles',
    clubName: 'Pine Needles GC',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX_LEAGUE,
  });
  await db.insert(courseRevisions).values({
    id: ids.revId,
    courseId: ids.courseId,
    revisionNumber: 1,
    outTotal: 36,
    inTotal: 36,
    courseTotal: 72,
    extractionDate: now,
    verified: true,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX_LEAGUE,
  });
  await db.insert(courseTees).values({
    id: randomUUID(),
    courseRevisionId: ids.revId,
    teeColor: 'blue',
    rating: 720,
    slope: 113,
    tenantId: TENANT_ID,
    contextId: CTX_LEAGUE,
  });
  for (let h = 1; h <= 18; h++) {
    await db.insert(courseHoles).values({
      id: randomUUID(),
      courseRevisionId: ids.revId,
      holeNumber: h,
      par: 4,
      si: ((h * 7) % 18) + 1,
      yardagePerTeeJson: JSON.stringify({ blue: 400 + h }),
      tenantId: TENANT_ID,
      contextId: CTX_LEAGUE,
    });
  }

  await db.insert(events).values({
    id: ids.eventId,
    name: 'Pinehurst 2026',
    startDate: now,
    endDate: now + 4 * 86400000,
    timezone: 'America/New_York',
    organizerPlayerId: ids.organizerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });

  await db.insert(eventRounds).values({
    id: ids.erId,
    eventId: ids.eventId,
    roundNumber: 1,
    roundDate: now,
    courseRevisionId: ids.revId,
    teeColor: 'blue',
    holesToPlay: 18,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });

  await db.insert(groups).values({
    id: ids.groupId,
    eventId: ids.eventId,
    name: 'A',
    moneyVisibilityMode: 'open',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  for (const pid of [ids.organizerId, ids.participantAId, ids.participantBId]) {
    await db.insert(groupMembers).values({
      groupId: ids.groupId,
      playerId: pid,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
  }

  await db.insert(invites).values({
    id: randomUUID(),
    eventId: ids.eventId,
    token: 'invite-token-' + ids.eventId.slice(0, 8),
    expiresAt: now + 7 * 86400000,
    createdByPlayerId: ids.organizerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });

  let roundId: string | null = null;
  let ruleSetRevisionId: string | null = null;
  let betId: string | null = null;
  let subGameId: string | null = null;
  let galleryPhotoId: string | null = null;

  if (opts.populated) {
    await db.insert(rounds).values({
      id: ids.roundId,
      eventId: ids.eventId,
      eventRoundId: ids.erId,
      holesToPlay: 18,
      openedAt: now,
      openedByPlayerId: ids.organizerId,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    await db.insert(roundStates).values({
      roundId: ids.roundId,
      state: 'in_progress',
      enteredAt: now,
      enteredByPlayerId: ids.organizerId,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    roundId = ids.roundId;

    // Hole scores: 18 holes for each of 2 players (A scoring B, B scoring A).
    for (let h = 1; h <= 18; h++) {
      await db.insert(holeScores).values({
        id: randomUUID(),
        roundId: ids.roundId,
        playerId: ids.participantAId,
        scorerPlayerId: ids.organizerId,
        holeNumber: h,
        grossStrokes: 4,
        putts: 2,
        clientEventId: `cev-a-${h}`,
        createdAt: now,
        updatedAt: now,
        tenantId: TENANT_ID,
        contextId: ctx,
      });
      await db.insert(holeScores).values({
        id: randomUUID(),
        roundId: ids.roundId,
        playerId: ids.participantBId,
        scorerPlayerId: ids.organizerId,
        holeNumber: h,
        grossStrokes: 5,
        putts: 2,
        clientEventId: `cev-b-${h}`,
        createdAt: now,
        updatedAt: now,
        tenantId: TENANT_ID,
        contextId: ctx,
      });
    }

    await db.insert(ruleSets).values({
      id: ids.ruleSetId,
      name: 'Default',
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: CTX_LEAGUE,
    });
    await db.insert(ruleSetRevisions).values({
      id: ids.ruleSetRevisionId,
      ruleSetId: ids.ruleSetId,
      revisionNumber: 1,
      configJson: JSON.stringify({ skinsBaseCents: 100 }),
      effectiveFromRoundId: ids.erId,
      effectiveFromHole: 1,
      createdByPlayerId: ids.organizerId,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    ruleSetRevisionId = ids.ruleSetRevisionId;

    // Pairing for round 1.
    await db.insert(pairings).values({
      id: ids.pairingId,
      eventRoundId: ids.erId,
      foursomeNumber: 1,
      locked: false,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    let slot = 1;
    for (const pid of [ids.organizerId, ids.participantAId, ids.participantBId]) {
      await db.insert(pairingMembers).values({
        pairingId: ids.pairingId,
        playerId: pid,
        slotNumber: slot++,
        tenantId: TENANT_ID,
        contextId: ctx,
      });
    }

    // 1 individual bet between A and B.
    await db.insert(individualBets).values({
      id: ids.betId,
      eventId: ids.eventId,
      playerAId: ids.participantAId,
      playerBId: ids.participantBId,
      betType: 'match_play_per_hole',
      stakePerHoleCents: 100,
      configJson: JSON.stringify({}),
      createdByPlayerId: ids.organizerId,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    await db.insert(individualBetRounds).values({
      betId: ids.betId,
      eventRoundId: ids.erId,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    betId = ids.betId;

    // 1 sub-game.
    await db.insert(subGames).values({
      id: ids.subGameId,
      eventRoundId: ids.erId,
      type: 'skins',
      configJson: JSON.stringify({}),
      buyInPerParticipant: 500,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    for (const pid of [ids.participantAId, ids.participantBId]) {
      await db.insert(subGameParticipants).values({
        subGameId: ids.subGameId,
        playerId: pid,
        optedInAt: now,
        tenantId: TENANT_ID,
        contextId: ctx,
      });
    }
    subGameId = ids.subGameId;

    // 1 gallery photo.
    await db.insert(galleryPhotos).values({
      id: ids.galleryPhotoId,
      eventId: ids.eventId,
      roundId: ids.roundId,
      uploadedByPlayerId: ids.participantAId,
      r2Key: `tournament/events/${ids.eventId}/sample.jpg`,
      contentType: 'image/jpeg',
      uploadedAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    galleryPhotoId = ids.galleryPhotoId;

    // Audit rows — one per known event-scoped entity_type.
    const auditSeeds: Array<{
      entityType: string;
      entityId: string;
      eventType: string;
    }> = [
      { entityType: 'round', entityId: ids.roundId, eventType: 'round.state_changed' },
      {
        entityType: 'hole_score',
        entityId: (await db.select({ id: holeScores.id }).from(holeScores).limit(1))[0]!.id,
        eventType: 'score.committed',
      },
      { entityType: 'rule_set', entityId: ids.ruleSetRevisionId, eventType: 'rule_set.revised' },
      { entityType: 'bet', entityId: ids.betId, eventType: 'bet.created' },
      { entityType: 'sub_game', entityId: ids.subGameId, eventType: 'subgame.computed' },
      {
        entityType: 'gallery_photo',
        entityId: ids.galleryPhotoId,
        eventType: 'gallery.uploaded',
      },
    ];
    for (const a of auditSeeds) {
      await db.insert(auditLog).values({
        id: randomUUID(),
        eventType: a.eventType,
        entityType: a.entityType,
        entityId: a.entityId,
        actorPlayerId: ids.organizerId,
        payloadJson: JSON.stringify({ eventId: ids.eventId }),
        createdAt: now,
        tenantId: TENANT_ID,
        contextId: `audit:${a.entityType}`,
      });
    }
  }

  let unrelatedRoundId: string | null = null;

  if (opts.unrelatedEvent) {
    await db.insert(events).values({
      id: ids.unrelatedEventId,
      name: 'Other',
      startDate: now,
      endDate: now + 86400000,
      timezone: 'America/New_York',
      organizerPlayerId: ids.organizerId,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctxOther,
    });
    await db.insert(eventRounds).values({
      id: ids.unrelatedErId,
      eventId: ids.unrelatedEventId,
      roundNumber: 1,
      roundDate: now,
      courseRevisionId: ids.revId,
      teeColor: 'blue',
      holesToPlay: 18,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctxOther,
    });
    await db.insert(rounds).values({
      id: ids.unrelatedRoundId,
      eventId: ids.unrelatedEventId,
      eventRoundId: ids.unrelatedErId,
      holesToPlay: 18,
      openedAt: now,
      openedByPlayerId: ids.organizerId,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctxOther,
    });
    // Audit row scoped to the OTHER event — must NOT appear in our export.
    await db.insert(auditLog).values({
      id: randomUUID(),
      eventType: 'round.state_changed',
      entityType: 'round',
      entityId: ids.unrelatedRoundId,
      actorPlayerId: ids.organizerId,
      payloadJson: JSON.stringify({ eventId: ids.unrelatedEventId }),
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: 'audit:round',
    });
    unrelatedRoundId = ids.unrelatedRoundId;
  }

  return {
    organizerId: ids.organizerId,
    participantAId: ids.participantAId,
    participantBId: ids.participantBId,
    outsiderId: ids.outsiderId,
    eventId: ids.eventId,
    unrelatedEventId: ids.unrelatedEventId,
    roundId,
    eventRoundId: ids.erId,
    ruleSetRevisionId,
    betId,
    subGameId,
    galleryPhotoId,
    unrelatedRoundId,
  };
}

function buildApp(player: { id: string; isOrganizer: boolean } | null): Hono {
  __testPlayer = player;
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/events', exportRouter);
  return app;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

describe('GET /api/events/:eventId/export/raw', () => {
  test('happy path — populated fixture, all keys present, type invariants hold', async () => {
    const s = await seed({ populated: true });
    const app = buildApp({ id: s.organizerId, isOrganizer: true });
    const res = await app.request(`/api/events/${s.eventId}/export/raw`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const cd = res.headers.get('Content-Disposition');
    expect(cd).toMatch(/attachment; filename="pinehurst-2026-\d{8}\.raw\.json"/);

    const body = (await res.json()) as Record<string, unknown>;
    // Top-level keys.
    for (const k of [
      'schemaVersion',
      'exportedAt',
      'warnings',
      'event',
      'events',
      'roster',
      'players',
      'eventRounds',
      'rounds',
      'groups',
      'groupMembers',
      'invites',
      'ruleSets',
      'ruleSetRevisions',
      'courses',
      'courseRevisions',
      'courseTees',
      'courseHoles',
      'pairings',
      'pairingMembers',
      'holeScores',
      'scoreCorrections',
      'roundStates',
      'scorerAssignments',
      'individualBets',
      'individualBetRounds',
      'individualBetPresses',
      'teamPressLog',
      'subGames',
      'subGameParticipants',
      'subGameResults',
      'galleryPhotos',
      'auditLog',
      'activity',
      'moneyMatrix',
      'settleUp',
    ]) {
      expect(body, `missing top-level key: ${k}`).toHaveProperty(k);
    }
    expect(body['schemaVersion']).toBe(1);
    expect(typeof body['exportedAt']).toBe('string');
    expect(body['exportedAt']).toMatch(ISO_RE);
    expect(body['warnings']).toEqual([]);
    expect(body['activity']).toEqual([]);

    const event = body['event'] as Record<string, unknown>;
    expect(event['id']).toBe(s.eventId);
    expect(typeof event['startDate']).toBe('string');
    expect(event['startDate']).toMatch(ISO_RE);

    // Money values are integer cents.
    const matrix = body['moneyMatrix'] as { matrix: Record<string, Record<string, number>>; totals: Record<string, number> };
    for (const row of Object.values(matrix.matrix)) {
      for (const cell of Object.values(row)) {
        expect(Number.isInteger(cell)).toBe(true);
      }
    }
    for (const t of Object.values(matrix.totals)) {
      expect(Number.isInteger(t)).toBe(true);
    }

    // Sub-game results from a fresh seed are empty (no compute run); but
    // total_pot_cents on subGames seed is the buy-in. Spot-check that the
    // bet's stakePerHoleCents made the round-trip as an integer.
    const bets = body['individualBets'] as Array<Record<string, unknown>>;
    expect(bets.length).toBe(1);
    expect(Number.isInteger(bets[0]!['stakePerHoleCents'])).toBe(true);

    // JSON-blob columns parsed to objects, not strings.
    const ruleRev = (body['ruleSetRevisions'] as Array<Record<string, unknown>>)[0]!;
    expect(typeof ruleRev['configJson']).toBe('object');
    expect(ruleRev['configJson']).toEqual({ skinsBaseCents: 100 });

    // auditLog has 6 rows (one per known event-scoped entity_type).
    expect((body['auditLog'] as unknown[]).length).toBe(6);

    // Booleans round-trip as booleans.
    const cr = (body['courseRevisions'] as Array<Record<string, unknown>>)[0]!;
    expect(typeof cr['verified']).toBe('boolean');
  });

  test('empty event — 200 with empty arrays', async () => {
    const s = await seed();
    const app = buildApp({ id: s.organizerId, isOrganizer: true });
    const res = await app.request(`/api/events/${s.eventId}/export/raw`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['rounds']).toEqual([]);
    expect(body['holeScores']).toEqual([]);
    expect(body['individualBets']).toEqual([]);
    expect(body['subGames']).toEqual([]);
    expect(body['galleryPhotos']).toEqual([]);
    expect(body['auditLog']).toEqual([]);
    const matrix = body['moneyMatrix'] as { matrix: Record<string, unknown> };
    // computeMoneyMatrix returns all-zeros for an event with members but no scores.
    expect(matrix['matrix']).toBeDefined();
  });

  test('401 anonymous, 403 non-organizer, 404 unknown event for organizer', async () => {
    const s = await seed();

    // Anonymous → 401 from session middleware.
    const anonApp = buildApp(null);
    const r1 = await anonApp.request(`/api/events/${s.eventId}/export/raw`);
    expect(r1.status).toBe(401);

    // Authenticated non-organizer → 403.
    const partApp = buildApp({ id: s.participantAId, isOrganizer: false });
    const r2 = await partApp.request(`/api/events/${s.eventId}/export/raw`);
    expect(r2.status).toBe(403);
    expect(((await r2.json()) as { code: string }).code).toBe('not_organizer');

    // Organizer + unknown event → 404.
    const orgApp = buildApp({ id: s.organizerId, isOrganizer: true });
    const r3 = await orgApp.request(`/api/events/${randomUUID()}/export/raw`);
    expect(r3.status).toBe(404);
    expect(((await r3.json()) as { error: string }).error).toBe('event_not_found');
  });

  test('auditLog filtering scopes to THIS event only', async () => {
    const s = await seed({ populated: true, unrelatedEvent: true });
    const app = buildApp({ id: s.organizerId, isOrganizer: true });
    const res = await app.request(`/api/events/${s.eventId}/export/raw`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const audits = body['auditLog'] as Array<{ entityId: string }>;
    // The unrelated event's audit row references s.unrelatedRoundId; it MUST
    // NOT appear in our export.
    expect(audits.find((a) => a.entityId === s.unrelatedRoundId)).toBeUndefined();
    // Our event's 6 known audit rows DO appear.
    expect(audits.length).toBe(6);
  });

  test('round-trip — re-insert export into a fresh DB and recompute money matrix', async () => {
    const s = await seed({ populated: true });
    // Build the export directly via the service so we don't depend on JSON
    // round-tripping through the route's response body.
    const exported = await buildEventExport(db, s.eventId, TENANT_ID);
    expect(exported).not.toBeNull();
    const matrixBefore = exported!.moneyMatrix.matrix;

    // Spin up a fresh in-memory DB, run migrations, replay the export.
    const freshClient = createClient({ url: ':memory:' });
    const freshDb = drizzle(freshClient);
    await freshClient.execute('PRAGMA foreign_keys = ON');
    await migrate(freshDb, { migrationsFolder });

    // Replay helper — converts ISO strings back to ms, parsed JSON back to
    // strings for the columns the schema expects as text.
    const isoToMs = (v: unknown): number | null => {
      if (typeof v !== 'string') return null;
      const t = Date.parse(v);
      return Number.isNaN(t) ? null : t;
    };
    const stringifyJson = (v: unknown): string =>
      typeof v === 'string' ? v : JSON.stringify(v);

    // Insert in dependency order. We re-use the same uuids from the export
    // so FK target ids match.
    for (const p of exported!.players) {
      await freshDb.insert(players).values({
        id: String(p['id']),
        isOrganizer: Boolean(p['isOrganizer']),
        createdAt: isoToMs(p['createdAt']) ?? Date.now(),
        name: String(p['name'] ?? ''),
        ghin: (p['ghin'] as string | null) ?? null,
        manualHandicapIndex: (p['manualHandicapIndex'] as number | null) ?? null,
        preferredTeeColor: (p['preferredTeeColor'] as string | null) ?? null,
        tenantId: String(p['tenantId']),
        contextId: String(p['contextId']),
      });
    }
    for (const c of exported!.courses) {
      await freshDb.insert(courses).values({
        id: String(c['id']),
        name: String(c['name']),
        clubName: String(c['clubName']),
        createdAt: isoToMs(c['createdAt']) ?? Date.now(),
        tenantId: String(c['tenantId']),
        contextId: String(c['contextId']),
      });
    }
    for (const cr of exported!.courseRevisions) {
      await freshDb.insert(courseRevisions).values({
        id: String(cr['id']),
        courseId: String(cr['courseId']),
        revisionNumber: Number(cr['revisionNumber']),
        sourceUrl: (cr['sourceUrl'] as string | null) ?? null,
        extractionDate: isoToMs(cr['extractionDate']),
        verified: Boolean(cr['verified']),
        outTotal: Number(cr['outTotal']),
        inTotal: Number(cr['inTotal']),
        courseTotal: Number(cr['courseTotal']),
        createdAt: isoToMs(cr['createdAt']) ?? Date.now(),
        tenantId: String(cr['tenantId']),
        contextId: String(cr['contextId']),
      });
    }
    for (const ct of exported!.courseTees) {
      await freshDb.insert(courseTees).values({
        id: String(ct['id']),
        courseRevisionId: String(ct['courseRevisionId']),
        teeColor: String(ct['teeColor']),
        rating: Number(ct['rating']),
        slope: Number(ct['slope']),
        tenantId: String(ct['tenantId']),
        contextId: String(ct['contextId']),
      });
    }
    for (const ch of exported!.courseHoles) {
      await freshDb.insert(courseHoles).values({
        id: String(ch['id']),
        courseRevisionId: String(ch['courseRevisionId']),
        holeNumber: Number(ch['holeNumber']),
        par: Number(ch['par']),
        si: Number(ch['si']),
        yardagePerTeeJson: stringifyJson(ch['yardagePerTeeJson']),
        tenantId: String(ch['tenantId']),
        contextId: String(ch['contextId']),
      });
    }
    for (const e of exported!.events) {
      await freshDb.insert(events).values({
        id: String(e['id']),
        name: String(e['name']),
        startDate: isoToMs(e['startDate']) ?? Date.now(),
        endDate: isoToMs(e['endDate']) ?? Date.now(),
        timezone: String(e['timezone']),
        organizerPlayerId: String(e['organizerPlayerId']),
        createdAt: isoToMs(e['createdAt']) ?? Date.now(),
        tenantId: String(e['tenantId']),
        contextId: String(e['contextId']),
      });
    }
    for (const er of exported!.eventRounds) {
      await freshDb.insert(eventRounds).values({
        id: String(er['id']),
        eventId: String(er['eventId']),
        roundNumber: Number(er['roundNumber']),
        roundDate: isoToMs(er['roundDate']) ?? Date.now(),
        courseRevisionId: String(er['courseRevisionId']),
        teeColor: String(er['teeColor']),
        holesToPlay: Number(er['holesToPlay']),
        createdAt: isoToMs(er['createdAt']) ?? Date.now(),
        tenantId: String(er['tenantId']),
        contextId: String(er['contextId']),
      });
    }
    for (const r of exported!.rounds) {
      await freshDb.insert(rounds).values({
        id: String(r['id']),
        eventId: r['eventId'] === null ? null : String(r['eventId']),
        eventRoundId: r['eventRoundId'] === null ? null : String(r['eventRoundId']),
        holesToPlay: Number(r['holesToPlay']),
        openedAt: isoToMs(r['openedAt']),
        openedByPlayerId: (r['openedByPlayerId'] as string | null) ?? null,
        createdAt: isoToMs(r['createdAt']) ?? Date.now(),
        tenantId: String(r['tenantId']),
        contextId: String(r['contextId']),
      });
    }
    for (const g of exported!.groups) {
      await freshDb.insert(groups).values({
        id: String(g['id']),
        eventId: String(g['eventId']),
        name: String(g['name']),
        moneyVisibilityMode: String(g['moneyVisibilityMode']),
        createdAt: isoToMs(g['createdAt']) ?? Date.now(),
        tenantId: String(g['tenantId']),
        contextId: String(g['contextId']),
      });
    }
    for (const m of exported!.groupMembers) {
      await freshDb.insert(groupMembers).values({
        groupId: String(m['groupId']),
        playerId: String(m['playerId']),
        tenantId: String(m['tenantId']),
        contextId: String(m['contextId']),
      });
    }
    for (const rs of exported!.ruleSets) {
      await freshDb.insert(ruleSets).values({
        id: String(rs['id']),
        name: String(rs['name']),
        createdAt: isoToMs(rs['createdAt']) ?? Date.now(),
        tenantId: String(rs['tenantId']),
        contextId: String(rs['contextId']),
      });
    }
    for (const rsr of exported!.ruleSetRevisions) {
      await freshDb.insert(ruleSetRevisions).values({
        id: String(rsr['id']),
        ruleSetId: String(rsr['ruleSetId']),
        revisionNumber: Number(rsr['revisionNumber']),
        configJson: stringifyJson(rsr['configJson']),
        effectiveFromRoundId: (rsr['effectiveFromRoundId'] as string | null) ?? null,
        effectiveFromHole: Number(rsr['effectiveFromHole']),
        createdByPlayerId: String(rsr['createdByPlayerId']),
        reason: (rsr['reason'] as string | null) ?? null,
        createdAt: isoToMs(rsr['createdAt']) ?? Date.now(),
        tenantId: String(rsr['tenantId']),
        contextId: String(rsr['contextId']),
      });
    }
    for (const hs of exported!.holeScores) {
      await freshDb.insert(holeScores).values({
        id: String(hs['id']),
        roundId: String(hs['roundId']),
        playerId: String(hs['playerId']),
        holeNumber: Number(hs['holeNumber']),
        grossStrokes: Number(hs['grossStrokes']),
        putts: (hs['putts'] as number | null) ?? null,
        scorerPlayerId: String(hs['scorerPlayerId']),
        clientEventId: String(hs['clientEventId']),
        createdAt: isoToMs(hs['createdAt']) ?? Date.now(),
        updatedAt: isoToMs(hs['updatedAt']) ?? Date.now(),
        tenantId: String(hs['tenantId']),
        contextId: String(hs['contextId']),
      });
    }
    for (const b of exported!.individualBets) {
      await freshDb.insert(individualBets).values({
        id: String(b['id']),
        eventId: String(b['eventId']),
        playerAId: String(b['playerAId']),
        playerBId: String(b['playerBId']),
        betType: String(b['betType']),
        stakePerHoleCents: Number(b['stakePerHoleCents']),
        configJson: stringifyJson(b['configJson']),
        createdByPlayerId: String(b['createdByPlayerId']),
        createdAt: isoToMs(b['createdAt']) ?? Date.now(),
        tenantId: String(b['tenantId']),
        contextId: String(b['contextId']),
      });
    }
    for (const br of exported!.individualBetRounds) {
      await freshDb.insert(individualBetRounds).values({
        betId: String(br['betId']),
        eventRoundId: String(br['eventRoundId']),
        tenantId: String(br['tenantId']),
        contextId: String(br['contextId']),
      });
    }

    // Recompute the matrix on the fresh DB.
    const matrixAfter = await computeMoneyMatrix(
      freshDb,
      s.eventId,
      s.organizerId,
      TENANT_ID,
    );
    // Deep-equal on the `matrix` shape (cells, anti-symmetry preserved).
    expect(matrixAfter.matrix).toEqual(matrixBefore);
  });

  // T10-1: AC-6 — raw-state export must include foursomeNumber on every
  // teamPressLog row. We seed a non-default (foursome_number=2) row so the
  // assertion verifies the projection propagates the STORED value rather
  // than silently defaulting. Row is located by a deterministic
  // (team, startHole, triggerType, contextId) tuple — no positional indexing.
  test('T10-1: teamPressLog projection includes foursomeNumber (non-default value)', async () => {
    const s = await seed({ populated: true });
    expect(s.roundId).not.toBeNull();
    const roundId = s.roundId!;
    const eventCtx = `event:${s.eventId}`;
    const knownPressId = randomUUID();
    // Use startHole=18 + team=teamB to minimize the chance a future fixture
    // adds a colliding (foursome_number, team, start_hole, trigger_type)
    // tuple under the new UNIQUE index. The end-of-round hole is rarely the
    // subject of a press in tests.
    const knownStartHole = 18;
    const knownTeam = 'teamB' as const;
    const knownTriggerType = 'manual' as const;
    await db.insert(teamPressLog).values({
      id: knownPressId,
      roundId,
      team: knownTeam,
      startHole: knownStartHole,
      triggerType: knownTriggerType,
      trigger: null,
      foursomeNumber: 2,
      multiplier: 2,
      firedAt: Date.now(),
      firedByPlayerId: s.organizerId,
      tenantId: TENANT_ID,
      contextId: eventCtx,
    });

    const app = buildApp({ id: s.organizerId, isOrganizer: true });
    const res = await app.request(`/api/events/${s.eventId}/export/raw`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { teamPressLog: Array<Record<string, unknown>> };

    // Deterministic lookup: (startHole, team, triggerType, contextId, id)
    // collectively pin the inserted row even if the fixture grows additional
    // press rows in the future.
    const found = body.teamPressLog.find(
      (p) =>
        p['startHole'] === knownStartHole &&
        p['team'] === knownTeam &&
        p['triggerType'] === knownTriggerType &&
        p['contextId'] === eventCtx &&
        p['id'] === knownPressId,
    );
    expect(found, 'inserted team_press_log row should appear in export').toBeDefined();
    expect(found!['foursomeNumber']).toBe(2);
  });

  test('filename slug edge cases', async () => {
    const { exportFilename } = await import('../services/export.js');
    const fixed = Date.UTC(2026, 4, 8, 4);
    expect(exportFilename('Pinehurst 2026', 'America/New_York', fixed)).toBe(
      'pinehurst-2026-20260508.raw.json',
    );
    expect(exportFilename('   ', 'America/New_York', fixed)).toBe('event-20260508.raw.json');
    expect(exportFilename('!@#$%^', 'America/New_York', fixed)).toBe(
      'event-20260508.raw.json',
    );
    const long = exportFilename('Long Name ' + 'x'.repeat(200), 'America/New_York', fixed);
    expect(long.endsWith('-20260508.raw.json')).toBe(true);
    expect(long.length).toBeLessThanOrEqual('long-name-'.length + 60 + '-20260508.raw.json'.length);
  });
});
