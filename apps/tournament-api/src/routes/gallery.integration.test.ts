/**
 * T7-4 gallery routes integration tests. Exercises the upload / list /
 * delete endpoints against an in-memory libsql DB. R2 client + presigner
 * are stubbed via vi.mock — real-R2 behavior is verified manually before
 * commit (Definition of Done smoke checklist).
 */

import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

// In-memory shared DB so the schema migration runs once and every test sees
// the same tables.
vi.mock('../db/index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

// Test-controlled session: tests reassign __testPlayer to flip
// participant/organizer/anonymous identity per case.
let __testPlayer:
  | { id: string; isOrganizer: boolean }
  | null = null;
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

// Stub R2 client: r2Configured boolean is mutable per-test; upload/delete
// resolve no-op and getSignedDownloadUrl returns a deterministic stub URL
// containing X-Amz-Signature so downstream assertions on signed-shape pass.
const r2State = {
  configured: true,
  uploadCalls: [] as Array<{ key: string; contentType: string }>,
  deleteCalls: [] as string[],
  signCalls: [] as string[],
  failUpload: false,
  failDelete: false,
};
vi.mock('../lib/r2-client.js', () => ({
  get r2Configured() {
    return r2State.configured;
  },
  uploadToR2: vi.fn(async (key: string, _body: unknown, contentType: string) => {
    r2State.uploadCalls.push({ key, contentType });
    if (r2State.failUpload) throw new Error('R2 upload boom');
  }),
  deleteFromR2: vi.fn(async (key: string) => {
    r2State.deleteCalls.push(key);
    if (r2State.failDelete) throw new Error('R2 delete boom');
  }),
  getSignedDownloadUrl: vi.fn(async (key: string, _ttl?: number) => {
    r2State.signCalls.push(key);
    return `https://stub.r2/${encodeURIComponent(key)}?X-Amz-Signature=stub&X-Amz-Expires=3600`;
  }),
}));

const { db } = await import('../db/index.js');
const {
  galleryPhotos,
  events,
  eventRounds,
  rounds,
  roundStates,
  groups,
  groupMembers,
  players,
  courses,
  courseRevisions,
  auditLog,
} = await import('../db/schema/index.js');
const { galleryRouter } = await import('./gallery.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX_LEAGUE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(galleryPhotos);
  await db.delete(auditLog);
  await db.delete(roundStates);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
  __testPlayer = null;
  r2State.configured = true;
  r2State.uploadCalls = [];
  r2State.deleteCalls = [];
  r2State.signCalls = [];
  r2State.failUpload = false;
  r2State.failDelete = false;
});

interface SeedResult {
  organizerId: string;
  participantId: string;
  outsiderId: string;
  eventId: string;
  roundId: string | null;
  eventRoundId: string | null;
}

interface SeedOpts {
  withActiveRound?: boolean;
  roundState?: 'in_progress' | 'complete_editable' | 'finalized' | 'cancelled' | 'not_started';
  withSecondRound?: boolean;
}

async function seed(opts: SeedOpts = {}): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    participantId: randomUUID(),
    outsiderId: randomUUID(),
    eventId: randomUUID(),
    courseId: randomUUID(),
    revId: randomUUID(),
    erId: randomUUID(),
    er2Id: randomUUID(),
    roundId: randomUUID(),
    round2Id: randomUUID(),
    groupId: randomUUID(),
  };
  const ctx = `event:${ids.eventId}`;

  for (const [id, name, isOrg] of [
    [ids.organizerId, 'Organizer', true],
    [ids.participantId, 'Participant', false],
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
  await db.insert(groupMembers).values({
    groupId: ids.groupId,
    playerId: ids.participantId,
    tenantId: TENANT_ID,
    contextId: ctx,
  });
  await db.insert(groupMembers).values({
    groupId: ids.groupId,
    playerId: ids.organizerId,
    tenantId: TENANT_ID,
    contextId: ctx,
  });

  let roundId: string | null = null;
  let eventRoundId: string | null = null;

  if (opts.withActiveRound) {
    await db.insert(rounds).values({
      id: ids.roundId,
      eventId: ids.eventId,
      eventRoundId: ids.erId,
      holesToPlay: 18,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    await db.insert(roundStates).values({
      roundId: ids.roundId,
      state: opts.roundState ?? 'in_progress',
      enteredAt: now,
      enteredByPlayerId: ids.organizerId,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    roundId = ids.roundId;
    eventRoundId = ids.erId;
  }

  if (opts.withSecondRound) {
    await db.insert(eventRounds).values({
      id: ids.er2Id,
      eventId: ids.eventId,
      roundNumber: 2,
      roundDate: now + 86400000,
      courseRevisionId: ids.revId,
      teeColor: 'blue',
      holesToPlay: 18,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
    await db.insert(rounds).values({
      id: ids.round2Id,
      eventId: ids.eventId,
      eventRoundId: ids.er2Id,
      holesToPlay: 18,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx,
    });
  }

  return {
    organizerId: ids.organizerId,
    participantId: ids.participantId,
    outsiderId: ids.outsiderId,
    eventId: ids.eventId,
    roundId,
    eventRoundId,
  };
}

function buildApp(player: { id: string; isOrganizer: boolean } | null): Hono {
  __testPlayer = player;
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/events', galleryRouter);
  return app;
}

function buildMultipart(
  field: string,
  filename: string,
  bytes: Uint8Array,
  contentType: string,
  extraFields: Record<string, string> = {},
): { body: Uint8Array; contentTypeHeader: string } {
  const boundary = '----TestBoundary' + randomUUID().replace(/-/g, '');
  const parts: Array<Uint8Array> = [];
  for (const [k, v] of Object.entries(extraFields)) {
    const txt =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${k}"\r\n\r\n` +
      `${v}\r\n`;
    parts.push(new TextEncoder().encode(txt));
  }
  const fileHeader =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  parts.push(new TextEncoder().encode(fileHeader));
  parts.push(bytes);
  parts.push(new TextEncoder().encode('\r\n'));
  parts.push(new TextEncoder().encode(`--${boundary}--\r\n`));

  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const body = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    body.set(p, o);
    o += p.byteLength;
  }
  return {
    body,
    contentTypeHeader: `multipart/form-data; boundary=${boundary}`,
  };
}

async function postUpload(
  app: Hono,
  eventId: string,
  fileBytes: Uint8Array,
  fileType = 'image/jpeg',
  extraFields: Record<string, string> = {},
): Promise<Response> {
  const { body, contentTypeHeader } = buildMultipart(
    'photo',
    'p.jpg',
    fileBytes,
    fileType,
    extraFields,
  );
  return app.request(`/api/events/${eventId}/gallery`, {
    method: 'POST',
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    headers: { 'content-type': contentTypeHeader },
  });
}

describe('POST /api/events/:eventId/gallery', () => {
  test('happy path — DB row + audit row written; response includes signedUrl', async () => {
    const s = await seed({ withActiveRound: true });
    const app = buildApp({ id: s.participantId, isOrganizer: false });

    const res = await postUpload(app, s.eventId, new Uint8Array([0xff, 0xd8, 0xff]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      roundId: string | null;
      signedUrl: string;
    };
    expect(body.id).toMatch(/[a-f0-9-]{36}/);
    expect(body.roundId).toBe(s.roundId);
    expect(body.signedUrl).toContain('X-Amz-Signature');

    const rows = await db
      .select()
      .from(galleryPhotos)
      .where(eq(galleryPhotos.id, body.id));
    expect(rows.length).toBe(1);
    expect(rows[0]!.eventId).toBe(s.eventId);
    expect(rows[0]!.roundId).toBe(s.roundId);
    expect(rows[0]!.r2Key.startsWith(`tournament/events/${s.eventId}/`)).toBe(true);
    expect(rows[0]!.contentType).toBe('image/jpeg');

    expect(r2State.uploadCalls.length).toBe(1);
    expect(r2State.uploadCalls[0]!.contentType).toBe('image/jpeg');

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, body.id));
    expect(audits.length).toBe(1);
    expect(audits[0]!.eventType).toBe('gallery.uploaded');
    expect(audits[0]!.entityType).toBe('gallery_photo');
    expect(audits[0]!.actorPlayerId).toBe(s.participantId);
  });

  test('round_id NULL when no active round exists', async () => {
    const s = await seed();
    const app = buildApp({ id: s.participantId, isOrganizer: false });

    const res = await postUpload(app, s.eventId, new Uint8Array([0xff, 0xd8, 0xff]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; roundId: string | null };
    expect(body.roundId).toBeNull();

    const rows = await db
      .select()
      .from(galleryPhotos)
      .where(eq(galleryPhotos.id, body.id));
    expect(rows[0]!.roundId).toBeNull();
  });

  test('round_id NULL when only round is finalized (state outside in_progress|complete_editable)', async () => {
    const s = await seed({ withActiveRound: true, roundState: 'finalized' });
    const app = buildApp({ id: s.participantId, isOrganizer: false });

    const res = await postUpload(app, s.eventId, new Uint8Array([0xff, 0xd8, 0xff]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roundId: string | null };
    expect(body.roundId).toBeNull();
  });

  test('explicit roundId form field overrides auto-resolution', async () => {
    const s = await seed({ withActiveRound: true, withSecondRound: true });
    const app = buildApp({ id: s.participantId, isOrganizer: false });

    // Find the second round id (different from active).
    const all = await db.select({ id: rounds.id }).from(rounds);
    const otherId = all.find((r) => r.id !== s.roundId)!.id;

    const res = await postUpload(
      app,
      s.eventId,
      new Uint8Array([0xff, 0xd8, 0xff]),
      'image/jpeg',
      { roundId: otherId },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roundId: string | null };
    expect(body.roundId).toBe(otherId);
  });

  test('explicit roundId not in this event → 400 invalid_round_id', async () => {
    const s = await seed({ withActiveRound: true });
    const app = buildApp({ id: s.participantId, isOrganizer: false });

    const res = await postUpload(
      app,
      s.eventId,
      new Uint8Array([0xff, 0xd8, 0xff]),
      'image/jpeg',
      { roundId: randomUUID() },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_round_id');
  });

  test('503 storage_not_configured when R2 envs missing', async () => {
    r2State.configured = false;
    const s = await seed({ withActiveRound: true });
    const app = buildApp({ id: s.participantId, isOrganizer: false });

    const res = await postUpload(app, s.eventId, new Uint8Array([0xff]));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('storage_not_configured');
  });

  test('400 missing_photo when photo field absent', async () => {
    const s = await seed();
    const app = buildApp({ id: s.participantId, isOrganizer: false });

    // Construct a multipart body with no photo field.
    const boundary = '----NoPhoto';
    const body = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="other"\r\n\r\nx\r\n--${boundary}--\r\n`,
    );
    const res = await app.request(`/api/events/${s.eventId}/gallery`, {
      method: 'POST',
      body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('missing_photo');
  });

  test('400 invalid_file_type when content-type not in allowlist', async () => {
    const s = await seed();
    const app = buildApp({ id: s.participantId, isOrganizer: false });

    const res = await postUpload(
      app,
      s.eventId,
      new Uint8Array([1, 2, 3]),
      'application/pdf',
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; allowed: string[] };
    expect(body.error).toBe('invalid_file_type');
    expect(body.allowed).toContain('image/jpeg');
  });

  test('400 file_too_large when photo > 10 MB but request still under bodyLimit', async () => {
    // bodyLimit cap is 12 MB; pre-shape a 10.5 MB file so request is under cap
    // but per-photo cap fails. (Multipart slop is small.)
    const s = await seed();
    const app = buildApp({ id: s.participantId, isOrganizer: false });

    const tenAndAHalfMb = new Uint8Array(10 * 1024 * 1024 + 512 * 1024);
    tenAndAHalfMb.set([0xff, 0xd8, 0xff], 0);
    const res = await postUpload(app, s.eventId, tenAndAHalfMb, 'image/jpeg');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('file_too_large');
  });

  test('413 request_too_large when total body > 12 MB', async () => {
    const s = await seed();
    const app = buildApp({ id: s.participantId, isOrganizer: false });

    const oversize = new Uint8Array(12 * 1024 * 1024 + 1024 * 1024);
    oversize.set([0xff, 0xd8, 0xff], 0);
    const res = await postUpload(app, s.eventId, oversize, 'image/jpeg');
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe('request_too_large');
  });

  test('502 r2_upload_failed when R2 PUT throws — no DB row written', async () => {
    r2State.failUpload = true;
    const s = await seed();
    const app = buildApp({ id: s.participantId, isOrganizer: false });

    const res = await postUpload(app, s.eventId, new Uint8Array([0xff, 0xd8, 0xff]));
    expect(res.status).toBe(502);

    const rows = await db.select().from(galleryPhotos);
    expect(rows.length).toBe(0);
  });

  test('500 + R2 cleanup when DB tx fails after R2 PUT succeeds', async () => {
    // Spy on `writeAudit` so the route's INSERT runs but the audit step
    // throws inside the transaction. The toHaveBeenCalledTimes(1)
    // assertion is load-bearing: it proves the route actually hit the
    // post-PUT-pre-commit path, not an artifact of vitest module hoisting
    // (codex impl-codex round-2 High was about spy reliability across
    // imported bindings; the assertion turns that risk into a hard fail).
    const s = await seed();
    const app = buildApp({ id: s.participantId, isOrganizer: false });

    const auditModule = await import('../lib/audit-log.js');
    const auditSpy = vi
      .spyOn(auditModule, 'writeAudit')
      .mockImplementationOnce(async () => {
        throw new Error('audit disk full');
      });

    try {
      const res = await postUpload(app, s.eventId, new Uint8Array([0xff, 0xd8, 0xff]));
      expect(res.status).toBe(500);

      // Spy MUST have been called once — proves the route reached the
      // writeAudit call site (the post-PUT-pre-commit path) before throwing.
      expect(auditSpy).toHaveBeenCalledTimes(1);

      // No gallery row persisted (tx rolled back).
      const rows = await db.select().from(galleryPhotos);
      expect(rows.length).toBe(0);

      // R2 cleanup attempted: one PUT and one DELETE for the same key.
      expect(r2State.uploadCalls.length).toBe(1);
      expect(r2State.deleteCalls.length).toBe(1);
      expect(r2State.deleteCalls[0]).toBe(r2State.uploadCalls[0]!.key);
    } finally {
      // finally so a failed assertion doesn't leak the spy into later tests.
      auditSpy.mockRestore();
    }
  });

  test('401 anonymous → no_test_player from session middleware', async () => {
    const s = await seed();
    const app = buildApp(null);
    const res = await postUpload(app, s.eventId, new Uint8Array([0xff]));
    expect(res.status).toBe(401);
  });

  test('403 non-participant', async () => {
    const s = await seed();
    const app = buildApp({ id: s.outsiderId, isOrganizer: false });
    const res = await postUpload(app, s.eventId, new Uint8Array([0xff, 0xd8, 0xff]));
    expect(res.status).toBe(403);
  });

});

describe('GET /api/events/:eventId/gallery', () => {
  test('groups by round; round_date DESC; unassociated bucket LAST', async () => {
    const s = await seed({ withActiveRound: true, withSecondRound: true });
    const app = buildApp({ id: s.participantId, isOrganizer: false });

    // Resolve round 2's id once (the "with second round" round, which has a
    // later round_date). We DO NOT delete any rounds in this test — we want
    // to assert the ordering rules with rounds intact.
    const allRounds = await db
      .select({ id: rounds.id })
      .from(rounds);
    const round2Id = allRounds.find((r) => r.id !== s.roundId)!.id;

    // Upload 3 photos:
    //   - photo A: auto-link to active round (round 1)
    //   - photo B: explicit roundId override → round 2
    //   - photo C: explicit roundId omitted AND no active round at upload
    //     time → unassociated. Achieve this by switching the active round's
    //     state to 'finalized' before this upload, then back.
    await postUpload(app, s.eventId, new Uint8Array([0xff, 0xd8, 0xff]));
    await postUpload(
      app,
      s.eventId,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      'image/png',
      { roundId: round2Id },
    );
    // Move round 1 out of in_progress so the next upload doesn't auto-link.
    await db
      .update(roundStates)
      .set({ state: 'finalized' })
      .where(eq(roundStates.roundId, s.roundId!));
    await postUpload(app, s.eventId, new Uint8Array([0xff, 0xd8, 0xff]));

    const res = await app.request(`/api/events/${s.eventId}/gallery`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as {
      groups: Array<{
        roundId: string | null;
        roundDate: number | null;
        roundNumber: number | null;
        photos: Array<{ id: string; signedUrl: string }>;
      }>;
    };

    expect(body.groups.length).toBe(3);
    // Round 2 has the LATER round_date → first; round 1 second; unassociated last.
    expect(body.groups[0]!.roundId).toBe(round2Id);
    expect(body.groups[0]!.roundNumber).toBe(2);
    expect(body.groups[1]!.roundId).toBe(s.roundId);
    expect(body.groups[1]!.roundNumber).toBe(1);
    expect(body.groups[2]!.roundId).toBeNull();
    // Every photo carries a signed URL with the SigV4 signature param.
    for (const g of body.groups) {
      for (const p of g.photos) {
        expect(p.signedUrl).toContain('X-Amz-Signature');
      }
    }
  });

  test('graceful empty `{ groups: [] }` when r2Configured = false', async () => {
    r2State.configured = false;
    const s = await seed();
    const app = buildApp({ id: s.participantId, isOrganizer: false });
    const res = await app.request(`/api/events/${s.eventId}/gallery`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { groups: unknown[] };
    expect(body.groups).toEqual([]);
  });

  test('403 non-participant', async () => {
    const s = await seed();
    const app = buildApp({ id: s.outsiderId, isOrganizer: false });
    const res = await app.request(`/api/events/${s.eventId}/gallery`);
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/events/:eventId/gallery/:photoId', () => {
  test('204 by organizer; R2 delete + DB delete + audit row', async () => {
    const s = await seed();
    const uploaderApp = buildApp({ id: s.participantId, isOrganizer: false });
    const upload = await postUpload(uploaderApp, s.eventId, new Uint8Array([0xff, 0xd8, 0xff]));
    const photoId = ((await upload.json()) as { id: string }).id;

    const adminApp = buildApp({ id: s.organizerId, isOrganizer: true });
    const res = await adminApp.request(
      `/api/events/${s.eventId}/gallery/${photoId}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(204);

    const rows = await db
      .select()
      .from(galleryPhotos)
      .where(eq(galleryPhotos.id, photoId));
    expect(rows.length).toBe(0);

    expect(r2State.deleteCalls.length).toBe(1);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, photoId));
    const deleteAudits = audits.filter((a) => a.eventType === 'gallery.deleted');
    expect(deleteAudits.length).toBe(1);
  });

  test('403 non-organizer participant', async () => {
    const s = await seed();
    const app = buildApp({ id: s.participantId, isOrganizer: false });
    const upload = await postUpload(app, s.eventId, new Uint8Array([0xff, 0xd8, 0xff]));
    const photoId = ((await upload.json()) as { id: string }).id;

    const res = await app.request(
      `/api/events/${s.eventId}/gallery/${photoId}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_organizer');
  });

  test('404 photo from a different event (cross-event isolation)', async () => {
    const s = await seed();

    // Upload a photo to event 1.
    const upload = await postUpload(
      buildApp({ id: s.participantId, isOrganizer: false }),
      s.eventId,
      new Uint8Array([0xff, 0xd8, 0xff]),
    );
    const photoId = ((await upload.json()) as { id: string }).id;

    // Seed a second event in the same DB (sharing the existing course +
    // organizer to avoid the courses UNIQUE collision).
    const event2Id = randomUUID();
    const ctx2 = `event:${event2Id}`;
    const now = Date.now();
    await db.insert(events).values({
      id: event2Id,
      name: 'Other Event',
      startDate: now,
      endDate: now + 86_400_000,
      timezone: 'America/New_York',
      organizerPlayerId: s.organizerId,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx2,
    });
    const group2Id = randomUUID();
    await db.insert(groups).values({
      id: group2Id,
      eventId: event2Id,
      name: 'B',
      moneyVisibilityMode: 'open',
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: ctx2,
    });
    await db.insert(groupMembers).values({
      groupId: group2Id,
      playerId: s.organizerId,
      tenantId: TENANT_ID,
      contextId: ctx2,
    });

    // Call DELETE on event 1's photo via event 2's URL → 404, not 200.
    const adminApp = buildApp({ id: s.organizerId, isOrganizer: true });
    const res = await adminApp.request(
      `/api/events/${event2Id}/gallery/${photoId}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(404);
  });

  test('500 when DELETE tx fails — R2 delete is NOT attempted', async () => {
    const s = await seed();
    const upload = await postUpload(
      buildApp({ id: s.participantId, isOrganizer: false }),
      s.eventId,
      new Uint8Array([0xff, 0xd8, 0xff]),
    );
    const photoId = ((await upload.json()) as { id: string }).id;

    // Reset R2 mock state — record only the next deleteFromR2 call.
    r2State.deleteCalls = [];

    const auditModule = await import('../lib/audit-log.js');
    const auditSpy = vi
      .spyOn(auditModule, 'writeAudit')
      .mockImplementationOnce(async () => {
        throw new Error('audit disk full');
      });

    try {
      const adminApp = buildApp({ id: s.organizerId, isOrganizer: true });
      const res = await adminApp.request(
        `/api/events/${s.eventId}/gallery/${photoId}`,
        { method: 'DELETE' },
      );
      expect(res.status).toBe(500);

      // Spy fired → the route reached the writeAudit call site.
      expect(auditSpy).toHaveBeenCalledTimes(1);

      // DB row still present (tx rolled back).
      const rows = await db
        .select()
        .from(galleryPhotos)
        .where(eq(galleryPhotos.id, photoId));
      expect(rows.length).toBe(1);

      // R2 delete was NOT attempted — the row still exists, the bucket
      // object would still be needed.
      expect(r2State.deleteCalls.length).toBe(0);
    } finally {
      auditSpy.mockRestore();
    }
  });

  test('204 even if R2 delete fails — DB delete still proceeds', async () => {
    const s = await seed();
    const upload = await postUpload(
      buildApp({ id: s.participantId, isOrganizer: false }),
      s.eventId,
      new Uint8Array([0xff, 0xd8, 0xff]),
    );
    const photoId = ((await upload.json()) as { id: string }).id;

    r2State.failDelete = true;
    const adminApp = buildApp({ id: s.organizerId, isOrganizer: true });
    const res = await adminApp.request(
      `/api/events/${s.eventId}/gallery/${photoId}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(204);

    const rows = await db
      .select()
      .from(galleryPhotos)
      .where(eq(galleryPhotos.id, photoId));
    expect(rows.length).toBe(0);
  });
});

describe('FK SET NULL on round deletion (AC-9)', () => {
  test('deleting parent round nulls round_id on photos, NOT cascade-delete', async () => {
    const s = await seed({ withActiveRound: true });
    const upload = await postUpload(
      buildApp({ id: s.participantId, isOrganizer: false }),
      s.eventId,
      new Uint8Array([0xff, 0xd8, 0xff]),
    );
    const photoId = ((await upload.json()) as { id: string }).id;

    const before = await db
      .select()
      .from(galleryPhotos)
      .where(eq(galleryPhotos.id, photoId));
    expect(before[0]!.roundId).toBe(s.roundId);

    await db.delete(roundStates).where(eq(roundStates.roundId, s.roundId!));
    await db.delete(rounds).where(eq(rounds.id, s.roundId!));

    const after = await db
      .select()
      .from(galleryPhotos)
      .where(eq(galleryPhotos.id, photoId));
    expect(after.length).toBe(1);
    expect(after[0]!.roundId).toBeNull();
    expect(after[0]!.eventId).toBe(s.eventId);
  });
});
