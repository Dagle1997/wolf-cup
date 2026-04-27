import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  sessions,
  ruleSets,
  ruleSetRevisions,
  events,
  courses,
  courseRevisions,
} = await import('../db/schema/index.js');
const { adminRuleSetsRouter } = await import('./admin-rule-sets.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const testApp = new Hono();
testApp.use('*', requestIdMiddleware);
testApp.route('/api/admin', adminRuleSetsRouter);

const SESSION_COOKIE = 'tournament_session';
const TENANT_ID = 'guyan';

async function seedSession(opts: { isOrganizer: boolean }): Promise<string> {
  const now = Date.now();
  const playerId = randomUUID();
  await db.insert(players).values({
    id: playerId,
    isOrganizer: opts.isOrganizer,
    createdAt: now,
    name: 'Organizer',
    tenantId: TENANT_ID,
    contextId: 'league:guyan-wolf-cup-friday',
  });
  const sessionId = randomUUID().replace(/-/g, '');
  await db.insert(sessions).values({
    sessionId,
    playerId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    deviceInfo: null,
    tenantId: TENANT_ID,
    contextId: 'league:guyan-wolf-cup-friday',
  });
  return sessionId;
}

function cookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}`;
}

const validConfig = {
  sandies: true,
  autoPress: { enabled: true, downN: 2, multiplier: 2 },
  greenies: { carryover: false, validation: 'none' },
  individualBet: { matchPlayPerHoleCents: 100 },
  subGames: { defaultBuyInPerParticipantCents: 0 },
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(ruleSetRevisions);
  await db.delete(ruleSets);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(sessions);
  await db.delete(players);
});

describe('POST /api/admin/rule-sets', () => {
  it('happy path: organizer creates → 201; rule_sets + rule_set_revisions rows persisted', async () => {
    const sessionId = await seedSession({ isOrganizer: true });

    const res = await testApp.request('/api/admin/rule-sets', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Pinehurst stakes' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { ruleSetId: string; revisionId: string; revisionNumber: number };
    expect(typeof body.ruleSetId).toBe('string');
    expect(typeof body.revisionId).toBe('string');
    expect(body.revisionNumber).toBe(1);

    const ruleSetRows = await db.select().from(ruleSets).where(eq(ruleSets.id, body.ruleSetId));
    expect(ruleSetRows).toHaveLength(1);
    expect(ruleSetRows[0]!.name).toBe('Pinehurst stakes');
    expect(ruleSetRows[0]!.contextId).toBe('library:guyan');

    const revRows = await db
      .select()
      .from(ruleSetRevisions)
      .where(eq(ruleSetRevisions.ruleSetId, body.ruleSetId));
    expect(revRows).toHaveLength(1);
    expect(revRows[0]!.revisionNumber).toBe(1);
    expect(revRows[0]!.effectiveFromRoundId).toBeNull();
    expect(revRows[0]!.effectiveFromHole).toBe(1);
    // Default config is the baseline shape per spec.
    const cfg = JSON.parse(revRows[0]!.configJson) as typeof validConfig;
    expect(cfg.sandies).toBe(true);
    expect(cfg.autoPress.downN).toBe(2);
    expect(cfg.greenies.carryover).toBe(false);
    expect(cfg.greenies.validation).toBe('none');
  });

  it('Zod miss: missing name → 400 invalid_body', async () => {
    const sessionId = await seedSession({ isOrganizer: true });

    const res = await testApp.request('/api/admin/rule-sets', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('anonymous → 401 session_missing', async () => {
    const res = await testApp.request('/api/admin/rule-sets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    expect(res.status).toBe(401);
  });

  it('non-organizer → 403 not_organizer', async () => {
    const sessionId = await seedSession({ isOrganizer: false });

    const res = await testApp.request('/api/admin/rule-sets', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/rule-sets/:id', () => {
  it('happy path: returns deserialized config', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    // Create via the POST handler so the row state matches production.
    const create = await testApp.request('/api/admin/rule-sets', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Stakes' }),
    });
    const created = (await create.json()) as { ruleSetId: string };

    const res = await testApp.request(`/api/admin/rule-sets/${created.ruleSetId}`, {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      name: string;
      latestRevision: { revisionNumber: number; configJson: typeof validConfig } | null;
    };
    expect(body.id).toBe(created.ruleSetId);
    expect(body.name).toBe('Stakes');
    expect(body.latestRevision).not.toBeNull();
    expect(body.latestRevision!.revisionNumber).toBe(1);
    // configJson is the deserialized object, not a string.
    expect(body.latestRevision!.configJson.sandies).toBe(true);
    expect(body.latestRevision!.configJson.autoPress.downN).toBe(2);
  });

  it('404 rule_set_not_found: unknown id', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const res = await testApp.request(`/api/admin/rule-sets/${randomUUID()}`, {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('rule_set_not_found');
  });

  it('500 corrupt_config_json: stored config_json is not valid JSON', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const create = await testApp.request('/api/admin/rule-sets', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Stakes' }),
    });
    const created = (await create.json()) as { ruleSetId: string; revisionId: string };
    // Inject malformed JSON directly into the row (bypass the API's normal
    // serialize-on-write path). JSON.parse will throw on this string.
    await db
      .update(ruleSetRevisions)
      .set({ configJson: '{ this is not valid json' })
      .where(eq(ruleSetRevisions.id, created.revisionId));

    const res = await testApp.request(`/api/admin/rule-sets/${created.ruleSetId}`, {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('corrupt_config_json');
  });

  it('500 corrupt_config_shape: stored config_json fails RuleSetConfigSchema', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    // Create a rule_set via POST, then directly UPDATE the row with a
    // shape-invalid config_json (still parses as JSON but fails Zod).
    const create = await testApp.request('/api/admin/rule-sets', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Stakes' }),
    });
    const created = (await create.json()) as { ruleSetId: string; revisionId: string };
    await db
      .update(ruleSetRevisions)
      .set({ configJson: JSON.stringify({ sandies: 'not_a_boolean' }) })
      .where(eq(ruleSetRevisions.id, created.revisionId));

    const res = await testApp.request(`/api/admin/rule-sets/${created.ruleSetId}`, {
      headers: { cookie: cookie(sessionId) },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('corrupt_config_shape');
  });
});

describe('POST /api/admin/rule-sets/:id/revisions', () => {
  it('happy path: appends revision_number = max+1; prior rows BYTE-IDENTICAL', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const create = await testApp.request('/api/admin/rule-sets', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Stakes' }),
    });
    const created = (await create.json()) as { ruleSetId: string; revisionId: string };

    // Snapshot the original revision 1 row pre-call.
    const priorRevs = await db
      .select()
      .from(ruleSetRevisions)
      .where(eq(ruleSetRevisions.ruleSetId, created.ruleSetId));
    expect(priorRevs).toHaveLength(1);
    const priorSerialized = JSON.stringify(priorRevs[0]);

    const updated = { ...validConfig, sandies: false };
    const res = await testApp.request(
      `/api/admin/rule-sets/${created.ruleSetId}/revisions`,
      {
        method: 'POST',
        headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
        body: JSON.stringify(updated),
      },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { revisionId: string; revisionNumber: number };
    expect(body.revisionNumber).toBe(2);

    // Prior revision 1 is BYTE-IDENTICAL post-call (FD-8 immutability).
    const postRevs = await db
      .select()
      .from(ruleSetRevisions)
      .where(eq(ruleSetRevisions.id, created.revisionId));
    expect(postRevs).toHaveLength(1);
    expect(JSON.stringify(postRevs[0])).toBe(priorSerialized);

    // New revision row has the updated config.
    const newRev = await db
      .select()
      .from(ruleSetRevisions)
      .where(eq(ruleSetRevisions.id, body.revisionId));
    expect(newRev).toHaveLength(1);
    expect(newRev[0]!.revisionNumber).toBe(2);
    const newCfg = JSON.parse(newRev[0]!.configJson) as typeof validConfig;
    expect(newCfg.sandies).toBe(false);
  });

  it('events table BYTE-IDENTICAL post-call', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    // Seed an event (need course_revision FK).
    const organizerId = randomUUID();
    await db.insert(players).values({
      id: organizerId,
      isOrganizer: true,
      createdAt: Date.now(),
      name: 'Org',
      tenantId: TENANT_ID,
      contextId: 'league:guyan-wolf-cup-friday',
    });
    const eventId = randomUUID();
    await db.insert(events).values({
      id: eventId,
      name: 'Pinehurst',
      startDate: 1_000_000,
      endDate: 2_000_000,
      timezone: 'America/New_York',
      organizerPlayerId: organizerId,
      createdAt: Date.now(),
      tenantId: TENANT_ID,
      contextId: `event:${eventId}`,
    });
    const eventsBefore = JSON.stringify(await db.select().from(events).orderBy(events.id));

    const create = await testApp.request('/api/admin/rule-sets', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Stakes' }),
    });
    const created = (await create.json()) as { ruleSetId: string };
    await testApp.request(`/api/admin/rule-sets/${created.ruleSetId}/revisions`, {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(validConfig),
    });

    const eventsAfter = JSON.stringify(await db.select().from(events).orderBy(events.id));
    expect(eventsAfter).toBe(eventsBefore);
  });

  it('Zod miss: invalid greenie carryover/validation combo → 400 invalid_body', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const create = await testApp.request('/api/admin/rule-sets', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Stakes' }),
    });
    const created = (await create.json()) as { ruleSetId: string };

    // carryover=true with validation='none' violates the .refine.
    const invalid = {
      ...validConfig,
      greenies: { carryover: true, validation: 'none' },
    };
    const res = await testApp.request(
      `/api/admin/rule-sets/${created.ruleSetId}/revisions`,
      {
        method: 'POST',
        headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
        body: JSON.stringify(invalid),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('Zod miss: autoPress.downN out-of-range (5) → 400', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const create = await testApp.request('/api/admin/rule-sets', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Stakes' }),
    });
    const created = (await create.json()) as { ruleSetId: string };

    const invalid = { ...validConfig, autoPress: { ...validConfig.autoPress, downN: 5 } };
    const res = await testApp.request(
      `/api/admin/rule-sets/${created.ruleSetId}/revisions`,
      {
        method: 'POST',
        headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
        body: JSON.stringify(invalid),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('404 rule_set_not_found: unknown id pre-flight', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const res = await testApp.request(`/api/admin/rule-sets/${randomUUID()}/revisions`, {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(validConfig),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('rule_set_not_found');
  });

  it('body > 8 KiB → 400 body_too_large', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const create = await testApp.request('/api/admin/rule-sets', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Stakes' }),
    });
    const created = (await create.json()) as { ruleSetId: string };

    // Pad body with junk to exceed 8 KiB. Body shape is invalid Zod-wise
    // but bodyLimit fires first.
    const huge = JSON.stringify({ ...validConfig, _pad: 'x'.repeat(10_000) });
    const res = await testApp.request(
      `/api/admin/rule-sets/${created.ruleSetId}/revisions`,
      {
        method: 'POST',
        headers: {
          cookie: cookie(sessionId),
          'content-type': 'application/json',
          'content-length': String(huge.length),
        },
        body: huge,
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('body_too_large');
  });

  it('UNIQUE conflict on (rule_set_id, revision_number) → 409 revision_number_conflict', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const create = await testApp.request('/api/admin/rule-sets', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Stakes' }),
    });
    const created = (await create.json()) as { ruleSetId: string };

    // Mock db.transaction to throw the libsql UNIQUE-shape error directly.
    // Models the real concurrent-saves race where two organizers both
    // computed the same nextRevisionNumber and the second INSERT hit the
    // composite UNIQUE on (rule_set_id, revision_number).
    const transactionSpy = vi.spyOn(db, 'transaction').mockRejectedValueOnce({
      code: 'SQLITE_CONSTRAINT_UNIQUE',
      cause: { rawCode: 2067 },
    });

    const res = await testApp.request(
      `/api/admin/rule-sets/${created.ruleSetId}/revisions`,
      {
        method: 'POST',
        headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
        body: JSON.stringify(validConfig),
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('revision_number_conflict');

    transactionSpy.mockRestore();
  });

  it('generic DB failure → 500 save_failed', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const create = await testApp.request('/api/admin/rule-sets', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Stakes' }),
    });
    const created = (await create.json()) as { ruleSetId: string };

    const transactionSpy = vi
      .spyOn(db, 'transaction')
      .mockRejectedValueOnce(new Error('disk full'));

    const res = await testApp.request(
      `/api/admin/rule-sets/${created.ruleSetId}/revisions`,
      {
        method: 'POST',
        headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
        body: JSON.stringify(validConfig),
      },
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('save_failed');

    transactionSpy.mockRestore();
  });
});
