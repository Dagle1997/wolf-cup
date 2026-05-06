/**
 * T5-11 event-scoped rule-set revision endpoint integration tests.
 *
 * 10 cases (a)-(j) per AC-8.
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
  rounds,
  roundStates,
  ruleSets,
  ruleSetRevisions,
  auditLog,
} = await import('../db/schema/index.js');
const { eventRuleEditsRouter } = await import('./event-rule-edits.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');
const activityMod = await import('../lib/activity.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(ruleSetRevisions);
  await db.delete(ruleSets);
  await db.delete(roundStates);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface RoundSeed {
  /** event_rounds.round_number */
  roundNumber: number;
  /** Whether to seed a runtime `rounds` row + `round_states` row. */
  hasRound?: boolean;
  /** State to write into round_states. Only used when hasRound !== false. */
  state?:
    | 'not_started'
    | 'in_progress'
    | 'complete_editable'
    | 'finalized'
    | 'cancelled';
}

interface SeedOpts {
  /** Number of `rounds` to seed under the event. Defaults to single round_number=1. */
  rounds?: RoundSeed[];
  /** When true, seed an UNRELATED second event with its own event_round (used for cross-event boundary test). */
  secondEvent?: boolean;
  /** When true, seed a rule_set + initial revision (revision_number 1). Default true. */
  existingRuleSet?: boolean;
}

interface SeedResult {
  organizerId: string;
  outsiderId: string;
  eventId: string;
  /** event_rounds.id keyed by round_number for easy lookup in tests. */
  eventRoundIds: Map<number, string>;
  /** Map round_number → rounds.id (only for entries with hasRound !== false). */
  runtimeRoundIds: Map<number, string>;
  ruleSetId: string;
  /** Second event's eventId (only when secondEvent=true). */
  otherEventId: string | null;
  /** Second event's event_rounds.id (only when secondEvent=true). */
  otherEventRoundId: string | null;
}

async function seed(opts: SeedOpts = {}): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    outsiderId: randomUUID(),
    eventId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    ruleSetId: randomUUID(),
    initialRevisionId: randomUUID(),
    otherEventId: opts.secondEvent ? randomUUID() : null,
    otherEventRoundId: opts.secondEvent ? randomUUID() : null,
    otherEventOrganizerId: opts.secondEvent ? randomUUID() : null,
  };
  const ctx = `event:${ids.eventId}`;

  // Players.
  await db.insert(players).values({
    id: ids.organizerId,
    isOrganizer: false,
    createdAt: now,
    name: 'Organizer',
    tenantId: TENANT_ID,
    contextId: CTX_BASE,
  });
  await db.insert(players).values({
    id: ids.outsiderId,
    isOrganizer: false,
    createdAt: now,
    name: 'Outsider',
    tenantId: TENANT_ID,
    contextId: CTX_BASE,
  });
  if (ids.otherEventOrganizerId) {
    await db.insert(players).values({
      id: ids.otherEventOrganizerId,
      isOrganizer: false,
      createdAt: now,
      name: 'OtherOrganizer',
      tenantId: TENANT_ID,
      contextId: CTX_BASE,
    });
  }

  // Course + revision (shared by both events).
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

  // Primary event.
  await db.insert(events).values({
    id: ids.eventId,
    name: 'Primary Event',
    startDate: now,
    endDate: now + 4 * 86400000,
    timezone: 'America/New_York',
    organizerPlayerId: ids.organizerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });

  const roundSpecs: RoundSeed[] = opts.rounds ?? [
    { roundNumber: 1, hasRound: true, state: 'not_started' },
  ];
  const eventRoundIds = new Map<number, string>();
  const runtimeRoundIds = new Map<number, string>();

  for (const r of roundSpecs) {
    const eventRoundId = randomUUID();
    eventRoundIds.set(r.roundNumber, eventRoundId);
    await db.insert(eventRounds).values({
      id: eventRoundId,
      eventId: ids.eventId,
      roundNumber: r.roundNumber,
      roundDate: now + (r.roundNumber - 1) * 86400000,
      courseRevisionId: ids.courseRevId,
      teeColor: 'blue',
      holesToPlay: 18,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    if (r.hasRound !== false) {
      const runtimeRoundId = randomUUID();
      runtimeRoundIds.set(r.roundNumber, runtimeRoundId);
      await db.insert(rounds).values({
        id: runtimeRoundId,
        eventId: ids.eventId,
        eventRoundId,
        holesToPlay: 18,
        createdAt: now,
        tenantId: TENANT_ID,
        contextId: ctx,
      });
      if (r.state) {
        await db.insert(roundStates).values({
          roundId: runtimeRoundId,
          state: r.state,
          enteredAt: now,
          tenantId: TENANT_ID,
          contextId: ctx,
        });
      }
    }
  }

  // Optional second event for cross-event boundary tests.
  if (
    opts.secondEvent &&
    ids.otherEventId &&
    ids.otherEventRoundId &&
    ids.otherEventOrganizerId
  ) {
    const otherCtx = `event:${ids.otherEventId}`;
    await db.insert(events).values({
      id: ids.otherEventId,
      name: 'Other Event',
      startDate: now,
      endDate: now + 86400000,
      timezone: 'America/New_York',
      organizerPlayerId: ids.otherEventOrganizerId,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: otherCtx,
    });
    await db.insert(eventRounds).values({
      id: ids.otherEventRoundId,
      eventId: ids.otherEventId,
      roundNumber: 1,
      roundDate: now,
      courseRevisionId: ids.courseRevId,
      teeColor: 'blue',
      holesToPlay: 18,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: otherCtx,
    });
  }

  // Rule set + initial revision (revision_number 1) — present by default so
  // tests can assert MAX(revision_number) → 2 after the new edit.
  if (opts.existingRuleSet !== false) {
    await db.insert(ruleSets).values({
      id: ids.ruleSetId,
      name: 'Test RuleSet',
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: `library:${TENANT_ID}`,
    });
    await db.insert(ruleSetRevisions).values({
      id: ids.initialRevisionId,
      ruleSetId: ids.ruleSetId,
      revisionNumber: 1,
      configJson: JSON.stringify({ sandies: false, version: 1 }),
      effectiveFromRoundId: null,
      effectiveFromHole: 1,
      createdByPlayerId: ids.organizerId,
      reason: null,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: `library:${TENANT_ID}`,
    });
  }

  return {
    organizerId: ids.organizerId,
    outsiderId: ids.outsiderId,
    eventId: ids.eventId,
    eventRoundIds,
    runtimeRoundIds,
    ruleSetId: ids.ruleSetId,
    otherEventId: ids.otherEventId,
    otherEventRoundId: ids.otherEventRoundId,
  };
}

function buildApp(playerId: string): Hono {
  __testPlayer = { id: playerId, isOrganizer: false };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/events', eventRuleEditsRouter);
  return app;
}

async function postRevision(
  app: Hono,
  eventId: string,
  ruleSetId: string,
  body: unknown,
): Promise<Response> {
  return await app.request(
    `/api/events/${eventId}/rule-sets/${ruleSetId}/revisions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('POST /api/events/:eventId/rule-sets/:ruleSetId/revisions', () => {
  test('(a) mid-round happy path — effectiveFromHole=12, no finalized rounds → 200', async () => {
    const s = await seed({
      rounds: [
        { roundNumber: 1, hasRound: true, state: 'in_progress' },
        { roundNumber: 2, hasRound: false },
      ],
    });
    const app = buildApp(s.organizerId);
    const eventRoundId = s.eventRoundIds.get(1)!;
    const emitSpy = vi.spyOn(activityMod, 'emitActivity');

    const res = await postRevision(app, s.eventId, s.ruleSetId, {
      configJson: { sandies: true, version: 2 },
      effectiveFromRoundId: eventRoundId,
      effectiveFromHole: 12,
      reason: 'enable sandies starting hole 12',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      revisionId: string;
      revisionNumber: number;
      effectiveFromRoundId: string;
      effectiveFromHole: number;
    };
    expect(body.ok).toBe(true);
    expect(body.revisionNumber).toBe(2);
    expect(body.effectiveFromRoundId).toBe(eventRoundId);
    expect(body.effectiveFromHole).toBe(12);

    // Revision row written.
    const revisions = await db
      .select()
      .from(ruleSetRevisions)
      .where(eq(ruleSetRevisions.id, body.revisionId));
    expect(revisions.length).toBe(1);
    expect(revisions[0]!.revisionNumber).toBe(2);
    expect(revisions[0]!.effectiveFromRoundId).toBe(eventRoundId);
    expect(revisions[0]!.effectiveFromHole).toBe(12);
    expect(revisions[0]!.contextId).toBe(`event:${s.eventId}`);
    expect(revisions[0]!.createdByPlayerId).toBe(s.organizerId);
    expect(revisions[0]!.reason).toBe('enable sandies starting hole 12');

    // Audit row written.
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'rule_set.revised'));
    expect(audits.length).toBe(1);
    expect(audits[0]!.entityId).toBe(s.ruleSetId);
    expect(audits[0]!.actorPlayerId).toBe(s.organizerId);
    const auditPayload = JSON.parse(audits[0]!.payloadJson) as {
      eventId: string;
      ruleSetId: string;
      revisionId: string;
      fromRevisionNumber: number;
      toRevisionNumber: number;
      effectiveFromRoundId: string;
      effectiveFromHole: number;
      priorConfig: { sandies: boolean; version: number };
      newConfig: { sandies: boolean; version: number };
    };
    expect(auditPayload.eventId).toBe(s.eventId);
    expect(auditPayload.fromRevisionNumber).toBe(1);
    expect(auditPayload.toRevisionNumber).toBe(2);
    expect(auditPayload.priorConfig.sandies).toBe(false);
    expect(auditPayload.newConfig.sandies).toBe(true);

    // T8-1: typed activity emit. Spy verifies the new typed call shape.
    expect(emitSpy).toHaveBeenCalledTimes(1);
    const emitArgs = emitSpy.mock.calls[0]![1] as {
      type: 'rule_set.revised';
      eventId: string;
      ruleSetId: string;
      revisionId: string;
      effectiveFromRoundId?: string;
      effectiveFromHole?: number;
    };
    expect(emitArgs.type).toBe('rule_set.revised');
    expect(emitArgs.eventId).toBe(s.eventId);
    expect(emitArgs.ruleSetId).toBe(s.ruleSetId);
    expect(emitArgs.effectiveFromHole).toBe(12);
    emitSpy.mockRestore();
  });

  test('(b) between-rounds happy path — effectiveFromHole=19, no finalized rounds → 200', async () => {
    const s = await seed({
      rounds: [
        { roundNumber: 1, hasRound: true, state: 'complete_editable' },
        { roundNumber: 2, hasRound: false },
      ],
    });
    const app = buildApp(s.organizerId);
    const eventRoundId = s.eventRoundIds.get(1)!;

    const res = await postRevision(app, s.eventId, s.ruleSetId, {
      configJson: { sandies: true },
      effectiveFromRoundId: eventRoundId,
      effectiveFromHole: 19,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { effectiveFromHole: number };
    expect(body.effectiveFromHole).toBe(19);

    const revisions = await db
      .select()
      .from(ruleSetRevisions)
      .where(eq(ruleSetRevisions.ruleSetId, s.ruleSetId));
    expect(revisions.find((r) => r.revisionNumber === 2)!.effectiveFromHole).toBe(19);
  });

  test('(c) frozen-round freeze-window — finalized round in window → 422 rule_edit_would_recompute_finalized_round', async () => {
    const s = await seed({
      rounds: [
        { roundNumber: 1, hasRound: true, state: 'in_progress' },
        { roundNumber: 2, hasRound: true, state: 'finalized' },
        { roundNumber: 3, hasRound: false },
      ],
    });
    const app = buildApp(s.organizerId);
    // Edit anchored at round 1 hole 10 → window includes round 1 + round 2 + round 3.
    const eventRoundId = s.eventRoundIds.get(1)!;
    const round2EventRoundId = s.eventRoundIds.get(2)!;

    const res = await postRevision(app, s.eventId, s.ruleSetId, {
      configJson: { sandies: true },
      effectiveFromRoundId: eventRoundId,
      effectiveFromHole: 10,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      code: string;
      frozenRoundIds: string[];
    };
    expect(body.code).toBe('rule_edit_would_recompute_finalized_round');
    expect(body.frozenRoundIds).toContain(round2EventRoundId);

    // No revision row created (rolled back).
    const revisions = await db
      .select()
      .from(ruleSetRevisions)
      .where(eq(ruleSetRevisions.ruleSetId, s.ruleSetId));
    expect(revisions.length).toBe(1); // only the seeded rev1
    // No audit row created.
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'rule_set.revised'));
    expect(audits.length).toBe(0);
  });

  test('(c2) hole=19 SKIPS the anchor — finalized anchor is allowed because boundary is between rounds', async () => {
    const s = await seed({
      rounds: [
        { roundNumber: 1, hasRound: true, state: 'finalized' },
        { roundNumber: 2, hasRound: false },
      ],
    });
    const app = buildApp(s.organizerId);
    const eventRoundId = s.eventRoundIds.get(1)!;

    const res = await postRevision(app, s.eventId, s.ruleSetId, {
      configJson: { sandies: true },
      effectiveFromRoundId: eventRoundId,
      effectiveFromHole: 19,
    });
    expect(res.status).toBe(200);
  });

  test('(d0) 422 effective_from_round_not_found — effectiveFromRoundId is a UUID with no matching event_round', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const fakeRoundId = randomUUID();

    const res = await postRevision(app, s.eventId, s.ruleSetId, {
      configJson: { sandies: true },
      effectiveFromRoundId: fakeRoundId,
      effectiveFromHole: 5,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('effective_from_round_not_found');
  });

  test('(d) cross-event boundary — effectiveFromRoundId belongs to a different event → 422 round_not_in_event', async () => {
    const s = await seed({ secondEvent: true });
    const app = buildApp(s.organizerId);

    const res = await postRevision(app, s.eventId, s.ruleSetId, {
      configJson: { sandies: true },
      effectiveFromRoundId: s.otherEventRoundId!,
      effectiveFromHole: 5,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('round_not_in_event');
  });

  test('(e) 403 non-organizer — caller is a participant but not the event organizer', async () => {
    const s = await seed();
    const app = buildApp(s.outsiderId);
    const eventRoundId = s.eventRoundIds.get(1)!;

    const res = await postRevision(app, s.eventId, s.ruleSetId, {
      configJson: { sandies: true },
      effectiveFromRoundId: eventRoundId,
      effectiveFromHole: 10,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_rule_edit');
  });

  test('(f) 403 nonexistent-event no-existence-leak — outsider on a NONEXISTENT eventId returns 403 (NOT 404)', async () => {
    const s = await seed();
    const app = buildApp(s.outsiderId);
    const eventRoundId = s.eventRoundIds.get(1)!;
    const fakeEventId = randomUUID();

    const res = await postRevision(app, fakeEventId, s.ruleSetId, {
      configJson: { sandies: true },
      effectiveFromRoundId: eventRoundId,
      effectiveFromHole: 10,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_authorized_for_rule_edit');
  });

  test('(g) 400 invalid_event_id / invalid_rule_set_id — malformed UUID in path', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const eventRoundId = s.eventRoundIds.get(1)!;

    const res1 = await postRevision(app, 'not-a-uuid', s.ruleSetId, {
      configJson: {},
      effectiveFromRoundId: eventRoundId,
      effectiveFromHole: 5,
    });
    expect(res1.status).toBe(400);
    expect(((await res1.json()) as { code: string }).code).toBe(
      'invalid_event_id',
    );

    const res2 = await postRevision(app, s.eventId, 'still-not-a-uuid', {
      configJson: {},
      effectiveFromRoundId: eventRoundId,
      effectiveFromHole: 5,
    });
    expect(res2.status).toBe(400);
    expect(((await res2.json()) as { code: string }).code).toBe(
      'invalid_rule_set_id',
    );
  });

  test('(h) 200 hole-1, first-round IS allowed (Section 5b — no use_setup_endpoint rejection)', async () => {
    const s = await seed({
      rounds: [
        { roundNumber: 1, hasRound: true, state: 'not_started' },
        { roundNumber: 2, hasRound: false },
      ],
    });
    const app = buildApp(s.organizerId);
    const eventRoundId = s.eventRoundIds.get(1)!;

    const res = await postRevision(app, s.eventId, s.ruleSetId, {
      configJson: { sandies: true, version: 'setup-style' },
      effectiveFromRoundId: eventRoundId,
      effectiveFromHole: 1,
      reason: 'fix sandies misconfig at start',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revisionNumber: number };
    expect(body.revisionNumber).toBe(2);

    // Revision row carries effectiveFromHole=1 + the anchor round.
    const revisions = await db
      .select()
      .from(ruleSetRevisions)
      .where(
        and(
          eq(ruleSetRevisions.ruleSetId, s.ruleSetId),
          eq(ruleSetRevisions.revisionNumber, 2),
        ),
      );
    expect(revisions[0]!.effectiveFromHole).toBe(1);
    expect(revisions[0]!.effectiveFromRoundId).toBe(eventRoundId);
  });

  test('(i) AC-5 breadcrumb — happy path emits rule_revision_pending_t6_recompute AFTER tx commit', async () => {
    const s = await seed({
      rounds: [
        { roundNumber: 1, hasRound: true, state: 'in_progress' },
      ],
    });
    const app = buildApp(s.organizerId);
    const eventRoundId = s.eventRoundIds.get(1)!;
    const { logger } = await import('../lib/log.js');
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    try {
      const res = await postRevision(app, s.eventId, s.ruleSetId, {
        configJson: { sandies: true },
        effectiveFromRoundId: eventRoundId,
        effectiveFromHole: 7,
      });
      expect(res.status).toBe(200);
      const breadcrumb = infoSpy.mock.calls.find((call) => {
        const arg = call[0];
        return (
          arg !== null &&
          typeof arg === 'object' &&
          (arg as { event?: string }).event === 'rule_revision_pending_t6_recompute'
        );
      });
      expect(breadcrumb).toBeDefined();
      const payload = breadcrumb![0] as {
        eventId: string;
        ruleSetId: string;
        effectiveFromHole: number;
      };
      expect(payload.eventId).toBe(s.eventId);
      expect(payload.ruleSetId).toBe(s.ruleSetId);
      expect(payload.effectiveFromHole).toBe(7);
    } finally {
      infoSpy.mockRestore();
    }
  });

  test('(j) 404 rule-set scope check — :ruleSetId not in tenant scope returns rule_set_not_found', async () => {
    const s = await seed();
    const app = buildApp(s.organizerId);
    const eventRoundId = s.eventRoundIds.get(1)!;
    const fakeRuleSetId = randomUUID();

    const res = await postRevision(app, s.eventId, fakeRuleSetId, {
      configJson: {},
      effectiveFromRoundId: eventRoundId,
      effectiveFromHole: 5,
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('rule_set_not_found');
  });
});
