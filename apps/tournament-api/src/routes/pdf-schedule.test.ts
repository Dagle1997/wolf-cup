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
  events,
  eventRounds,
  groups,
  groupMembers,
  invites,
  pairings,
  pairingMembers,
  courses,
  courseRevisions,
} = await import('../db/schema/index.js');
const { pdfScheduleRouter } = await import('./pdf-schedule.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CONTEXT_LEAGUE = 'league:guyan-wolf-cup-friday';

const testApp = new Hono();
testApp.use('*', requestIdMiddleware);
testApp.route('/api/events', pdfScheduleRouter);

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(invites);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface SeedResult {
  organizerId: string;
  eventId: string;
  eventRoundId: string;
  groupId: string;
  playerIds: string[];
  inviteToken: string;
}

async function seed(opts: { withPairings: boolean }): Promise<SeedResult> {
  const now = Date.now();
  const organizerId = randomUUID();
  await db.insert(players).values({
    id: organizerId,
    isOrganizer: true,
    createdAt: now,
    name: 'Organizer',
    tenantId: TENANT_ID,
    contextId: CONTEXT_LEAGUE,
  });

  const courseId = randomUUID();
  await db.insert(courses).values({
    id: courseId,
    name: 'Pinehurst No. 2',
    clubName: 'Pinehurst Resort',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: 'library:guyan',
  });
  const courseRevisionId = randomUUID();
  await db.insert(courseRevisions).values({
    id: courseRevisionId,
    courseId,
    revisionNumber: 1,
    outTotal: 36,
    inTotal: 36,
    courseTotal: 72,
    verified: true,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: 'library:guyan',
  });

  const eventId = randomUUID();
  await db.insert(events).values({
    id: eventId,
    name: 'Pinehurst Test',
    startDate: 1_715_040_000_000,
    endDate: 1_715_300_000_000,
    timezone: 'America/New_York',
    organizerPlayerId: organizerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: `event:${eventId}`,
  });

  const eventRoundId = randomUUID();
  await db.insert(eventRounds).values({
    id: eventRoundId,
    eventId,
    roundNumber: 1,
    roundDate: now,
    courseRevisionId,
    teeColor: 'blue',
    holesToPlay: 18,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: `event:${eventId}`,
  });

  const groupId = randomUUID();
  await db.insert(groups).values({
    id: groupId,
    eventId,
    name: 'Pinehurst Crew',
    moneyVisibilityMode: 'open',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: `event:${eventId}`,
  });

  const playerIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const pid = randomUUID();
    playerIds.push(pid);
    await db.insert(players).values({
      id: pid,
      isOrganizer: false,
      createdAt: now,
      name: `Player ${String.fromCharCode(65 + i)}`,
      manualHandicapIndex: 10 + i,
      tenantId: TENANT_ID,
      contextId: CONTEXT_LEAGUE,
    });
    await db.insert(groupMembers).values({
      groupId,
      playerId: pid,
      tenantId: TENANT_ID,
      contextId: `event:${eventId}`,
    });
  }

  if (opts.withPairings) {
    const pairingId = randomUUID();
    await db.insert(pairings).values({
      id: pairingId,
      eventRoundId,
      foursomeNumber: 1,
      locked: false,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: `event:${eventId}`,
    });
    for (let i = 0; i < 4; i++) {
      await db.insert(pairingMembers).values({
        pairingId,
        playerId: playerIds[i]!,
        slotNumber: i + 1,
        tenantId: TENANT_ID,
        contextId: `event:${eventId}`,
      });
    }
  }

  // 43-char base64url token (matches T3-2's randomBytes(32).toString shape).
  const inviteToken = 'a'.repeat(43);
  await db.insert(invites).values({
    id: randomUUID(),
    eventId,
    token: inviteToken,
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    createdByPlayerId: organizerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: `event:${eventId}`,
  });

  return { organizerId, eventId, eventRoundId, groupId, playerIds, inviteToken };
}

describe('GET /api/events/:eventId/pdf/schedule/:token', () => {
  it('happy path: returns 200 + Content-Type pdf + Content-Disposition attachment', async () => {
    const s = await seed({ withPairings: true });
    const res = await testApp.request(
      `/api/events/${s.eventId}/pdf/schedule/${s.inviteToken}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain('.pdf');
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('404 from Hono router: GET without :token in URL → no route match', async () => {
    const s = await seed({ withPairings: true });
    const res = await testApp.request(
      `/api/events/${s.eventId}/pdf/schedule`,
    );
    expect(res.status).toBe(404);
  });

  it('401 invite_token_invalid: malformed token in URL', async () => {
    await seed({ withPairings: true });
    const res = await testApp.request(
      `/api/events/some-event-id/pdf/schedule/not-a-token`,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invite_token_invalid');
  });

  it('401 invite_expired: expired token row in DB', async () => {
    const s = await seed({ withPairings: true });
    // Force the invite to expired.
    await db
      .update(invites)
      .set({ expiresAt: Date.now() - 1000 })
      .where(eq(invites.token, s.inviteToken));
    const res = await testApp.request(
      `/api/events/${s.eventId}/pdf/schedule/${s.inviteToken}`,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invite_expired');
  });

  it('422 pairings_missing: event with no pairings rows', async () => {
    const s = await seed({ withPairings: false });
    const res = await testApp.request(
      `/api/events/${s.eventId}/pdf/schedule/${s.inviteToken}`,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('event_pairings_not_saved');
  });

  it('403 event_token_mismatch: URL eventId differs from token event_id', async () => {
    const s = await seed({ withPairings: true });
    // Use a different (UUID-shaped) eventId in the URL while keeping
    // the valid token (which is bound to s.eventId).
    const otherEventId = randomUUID();
    const res = await testApp.request(
      `/api/events/${otherEventId}/pdf/schedule/${s.inviteToken}`,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('event_token_mismatch');
  });

  it('cross-tenant: foreign-tenant invite row → 401 invite_not_found', async () => {
    const s = await seed({ withPairings: true });
    await db
      .update(invites)
      .set({ tenantId: 'other-tenant' })
      .where(eq(invites.token, s.inviteToken));
    const res = await testApp.request(
      `/api/events/${s.eventId}/pdf/schedule/${s.inviteToken}`,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invite_not_found');
  });
});
