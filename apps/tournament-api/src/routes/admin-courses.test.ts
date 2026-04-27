import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

// ---------------------------------------------------------------------
// Mock the in-memory DB (T1-6a pattern). Declared BEFORE importing
// anything that uses `db`.
// ---------------------------------------------------------------------
vi.mock('../db/index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  return { client, db };
});

// Mock the course-parser module. The single `parseCoursePdf` export is
// stubbed per-test; `ParserError` is preserved from the real module so
// `throw new ParserError(...)` wiring in the route's catch works.
const mockParseCoursePdf = vi.fn();

vi.mock('../lib/course-parser.js', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/course-parser.js')>('../lib/course-parser.js');
  return {
    ...actual,
    parseCoursePdf: mockParseCoursePdf,
  };
});

// Imports AFTER the mocks.
const { db } = await import('../db/index.js');
const {
  players,
  sessions,
  courses,
  courseRevisions,
  courseTees,
  courseHoles,
} = await import('../db/schema/index.js');
const { adminCoursesRouter } = await import('./admin-courses.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');
const { ParserError } = await import('../lib/course-parser.js');
const { eq } = await import('drizzle-orm');

// Mirror the production app.ts mount: requestIdMiddleware before the router.
const testApp = new Hono();
testApp.use('*', requestIdMiddleware);
testApp.route('/api/admin', adminCoursesRouter);

const SESSION_COOKIE = 'tournament_session';
const TENANT_ID = 'guyan';

/**
 * Seeds an organizer (or regular) player + active session. Returns the
 * sessionId so tests can send it in the Cookie header.
 */
async function seedSession(opts: { isOrganizer: boolean }): Promise<string> {
  const now = Date.now();
  const playerId = randomUUID();
  await db.insert(players).values({
    id: playerId,
    isOrganizer: opts.isOrganizer,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: 'league:guyan-wolf-cup-friday',
  });

  // Session id must match the shape require-session expects: 16..128 chars,
  // base64url alphabet. `randomUUID()` is base64url-safe once dashes are
  // stripped, and length ~32 sits comfortably in the acceptance range.
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

/** Build a minimal valid PDF byte array starting with the %PDF magic. */
function makePdfBytes(
  size = 1024,
  magic: readonly number[] = [0x25, 0x50, 0x44, 0x46],
): Uint8Array {
  // Explicit ArrayBuffer backing so TS narrows to Uint8Array<ArrayBuffer>
  // (the Blob constructor's BlobPart union excludes SharedArrayBuffer).
  const bytes = new Uint8Array(new ArrayBuffer(size));
  for (let i = 0; i < magic.length && i < size; i++) {
    bytes[i] = magic[i]!;
  }
  return bytes;
}

/** Canonical parsed-course fixture that the mock returns on happy path. */
function canonicalParsed() {
  return {
    name: 'Pine Needles Lodge & Golf Club',
    club_name: 'Pine Needles Lodge & Golf Club',
    tees: [{ color: 'Medal', rating: 74.7, slope: 141 }],
    holes: Array.from({ length: 18 }, (_, i) => ({
      number: i + 1,
      par: i % 3 === 0 ? 5 : 4,
      si: i + 1,
      yardages: { Medal: 400 + i * 5 },
    })),
    totals: { out_total: 36, in_total: 35, course_total: 71 },
  };
}

/** Build a multipart FormData body with a single `pdf` file field. */
function pdfForm(bytes: Uint8Array, mime = 'application/pdf'): FormData {
  const form = new FormData();
  // Cast narrows the ArrayBufferLike backing to the ArrayBuffer that
  // BlobPart requires. Runtime behavior is identical.
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
  form.append('pdf', blob, 'scorecard.pdf');
  return form;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  mockParseCoursePdf.mockReset();
  // Order matters: child tables first (FK to course_revisions), then
  // course_revisions (FK to courses), then courses, then sessions/players.
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(sessions);
  await db.delete(players);
});

describe('POST /api/admin/courses/parse-pdf', () => {
  it('happy path: organizer uploads valid PDF → 200 with parsed course shape', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    mockParseCoursePdf.mockResolvedValueOnce(canonicalParsed());

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: pdfForm(makePdfBytes(1024)),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(canonicalParsed());
    expect(mockParseCoursePdf).toHaveBeenCalledTimes(1);
  });

  it('unauthenticated (no cookie) → 401 session_missing', async () => {
    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      body: pdfForm(makePdfBytes(1024)),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('session_missing');
    expect(mockParseCoursePdf).not.toHaveBeenCalled();
  });

  it('non-organizer → 403 not_organizer', async () => {
    const sessionId = await seedSession({ isOrganizer: false });

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: pdfForm(makePdfBytes(1024)),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_organizer');
    expect(mockParseCoursePdf).not.toHaveBeenCalled();
  });

  it('missing pdf field → 400 missing_file', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const form = new FormData();
    form.append('not_pdf', 'hello');

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: form,
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('missing_file');
    expect(mockParseCoursePdf).not.toHaveBeenCalled();
  });

  it('wrong MIME (text/plain) → 400 wrong_mime', async () => {
    const sessionId = await seedSession({ isOrganizer: true });

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: pdfForm(makePdfBytes(1024), 'text/plain'),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('wrong_mime');
    expect(mockParseCoursePdf).not.toHaveBeenCalled();
  });

  it('empty MIME + valid magic bytes → 200 (magic-byte is authoritative)', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    mockParseCoursePdf.mockResolvedValueOnce(canonicalParsed());

    // Manually construct a FormData entry with no Content-Type on the file
    // part. The Blob constructor without `type` yields `''` for File.type.
    const form = new FormData();
    form.append(
      'pdf',
      new Blob([makePdfBytes(1024) as Uint8Array<ArrayBuffer>]),
      'scorecard.pdf',
    );

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: form,
    });

    expect(res.status).toBe(200);
    expect(mockParseCoursePdf).toHaveBeenCalledTimes(1);
  });

  it('wrong magic bytes → 400 wrong_magic', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    // Correct MIME but bytes start with "FAKE" not "%PDF".
    const bytes = makePdfBytes(1024, [0x46, 0x41, 0x4b, 0x45]);

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: pdfForm(bytes),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('wrong_magic');
    expect(mockParseCoursePdf).not.toHaveBeenCalled();
  });

  it('oversized body (> 10 MiB + slack) → 400 file_too_large', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    // 11 MiB — well above the bodyLimit of 10 MiB + 64 KiB slack.
    const bytes = makePdfBytes(11 * 1024 * 1024);

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: pdfForm(bytes),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('file_too_large');
    expect(mockParseCoursePdf).not.toHaveBeenCalled();
  });

  it('parser throws ParserError(rate_limited) → 503 vision_api_failed (sub-code not leaked)', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    mockParseCoursePdf.mockRejectedValueOnce(
      new ParserError({ code: 'rate_limited', message: 'throttled' }),
    );

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: pdfForm(makePdfBytes(1024)),
    });

    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['code']).toBe('vision_api_failed');
    // Sub-code MUST NOT appear in the response body — logged only.
    expect(JSON.stringify(body)).not.toContain('rate_limited');
    expect(JSON.stringify(body)).not.toContain('throttled');
  });

  it('parser throws generic Error → 503 vision_api_failed (defense-in-depth)', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    mockParseCoursePdf.mockRejectedValueOnce(new Error('something weird happened'));

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: pdfForm(makePdfBytes(1024)),
    });

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('vision_api_failed');
  });

  it('PDF bytes passed through unchanged to parser', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    mockParseCoursePdf.mockResolvedValueOnce(canonicalParsed());
    const originalBytes = makePdfBytes(1024);
    // Insert a recognizable marker after the magic bytes.
    originalBytes[4] = 0xab;
    originalBytes[5] = 0xcd;
    originalBytes[6] = 0xef;

    await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: pdfForm(originalBytes),
    });

    expect(mockParseCoursePdf).toHaveBeenCalledTimes(1);
    const capturedBytes = mockParseCoursePdf.mock.calls[0]![0] as Uint8Array;
    expect(capturedBytes).toBeInstanceOf(Uint8Array);
    expect(capturedBytes.length).toBe(originalBytes.length);
    expect(Array.from(capturedBytes.slice(0, 8))).toEqual(
      Array.from(originalBytes.slice(0, 8)),
    );
  });

  // ===========================================================================
  // T2-3a: phone-photographed scorecard input — image MIME variants
  // ===========================================================================

  /** Build a 1 KB image blob beginning with the given magic bytes. */
  function makeImageBytes(magic: readonly number[]): Uint8Array {
    const size = 1024;
    const bytes = new Uint8Array(new ArrayBuffer(size));
    for (let i = 0; i < magic.length && i < size; i++) {
      bytes[i] = magic[i]!;
    }
    return bytes;
  }

  /** Build a multipart FormData body with a single `pdf` field carrying an image. */
  function imageForm(bytes: Uint8Array, mime: string): FormData {
    const form = new FormData();
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
    form.append('pdf', blob, 'scorecard.img');
    return form;
  }

  it('T2-3a: JPEG happy path → 200, parser invoked with kind=image mime=image/jpeg', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    mockParseCoursePdf.mockResolvedValueOnce(canonicalParsed());

    const jpegBytes = makeImageBytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: imageForm(jpegBytes, 'image/jpeg'),
    });

    expect(res.status).toBe(200);
    expect(mockParseCoursePdf).toHaveBeenCalledTimes(1);
    const callArgs = mockParseCoursePdf.mock.calls[0]!;
    expect(callArgs[1]).toEqual({ kind: 'image', mime: 'image/jpeg' });
  });

  it('T2-3a: PNG happy path → 200, parser invoked with kind=image mime=image/png', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    mockParseCoursePdf.mockResolvedValueOnce(canonicalParsed());

    const pngBytes = makeImageBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: imageForm(pngBytes, 'image/png'),
    });

    expect(res.status).toBe(200);
    expect(mockParseCoursePdf).toHaveBeenCalledTimes(1);
    expect(mockParseCoursePdf.mock.calls[0]![1]).toEqual({
      kind: 'image',
      mime: 'image/png',
    });
  });

  it('T2-3a: WebP happy path → 200, parser invoked with kind=image mime=image/webp', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    mockParseCoursePdf.mockResolvedValueOnce(canonicalParsed());

    // RIFF + WEBP composite at bytes 0-3 and 8-11.
    const webpBytes = makeImageBytes([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // size
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: imageForm(webpBytes, 'image/webp'),
    });

    expect(res.status).toBe(200);
    expect(mockParseCoursePdf).toHaveBeenCalledTimes(1);
    expect(mockParseCoursePdf.mock.calls[0]![1]).toEqual({
      kind: 'image',
      mime: 'image/webp',
    });
  });

  it('T2-3a: HEIC rejection → 400 unsupported_mime_heic, parser NOT invoked', async () => {
    const sessionId = await seedSession({ isOrganizer: true });

    // ftyp box with `heic` brand at bytes 8-11.
    const heicBytes = makeImageBytes([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x68, 0x65, 0x69, 0x63, // brand: heic
    ]);

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: imageForm(heicBytes, 'image/heic'),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.error).toBe('bad_upload');
    expect(body.code).toBe('unsupported_mime_heic');
    expect(mockParseCoursePdf).not.toHaveBeenCalled();
  });

  it('T2-3a: GIF rejection → 400 unsupported_mime_gif, parser NOT invoked', async () => {
    const sessionId = await seedSession({ isOrganizer: true });

    // GIF89a header.
    const gifBytes = makeImageBytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: imageForm(gifBytes, 'image/gif'),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.error).toBe('bad_upload');
    expect(body.code).toBe('unsupported_mime_gif');
    expect(mockParseCoursePdf).not.toHaveBeenCalled();
  });

  it('T2-3a: MIME=image/jpeg but bytes=%PDF → 200 with PDF parse (magic wins; declared MIME ignored)', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    mockParseCoursePdf.mockResolvedValueOnce(canonicalParsed());

    // %PDF magic but declared as image/jpeg. Per the magic-byte authoritative
    // policy (Risk Acceptance §3 + §8), this MUST parse as PDF — the declared
    // MIME is a soft pre-filter only and is NOT re-consulted after buffering.
    const pdfBytesWithImageMime = makeImageBytes([0x25, 0x50, 0x44, 0x46]);

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: imageForm(pdfBytesWithImageMime, 'image/jpeg'),
    });

    expect(res.status).toBe(200);
    expect(mockParseCoursePdf).toHaveBeenCalledTimes(1);
    expect(mockParseCoursePdf.mock.calls[0]![1]).toEqual({ kind: 'pdf' });
  });
});

// ===========================================================================
// T2-5: POST /api/admin/courses — validated transactional save.
// ===========================================================================

/**
 * Returns a known-valid SaveCourseRequest payload that passes BOTH the
 * Zod schema AND the real T2-4 `validateCourse`. Pars sum: front 35,
 * back 36, course 71. SI is the bijection [1..18]. Single tee 'blue'.
 */
function validCourseRequest() {
  const pars = [
    4, 4, 3, 4, 5, 4, 4, 3, 4, // out = 35
    4, 4, 3, 4, 5, 4, 4, 3, 5, // in  = 36
  ];
  const yardages = [
    400, 420, 180, 440, 520, 410, 400, 170, 415,
    425, 430, 190, 445, 530, 420, 395, 160, 520,
  ];
  return {
    name: 'Test Course',
    club_name: 'Test Country Club',
    tees: [{ color: 'blue', rating: 72.3, slope: 130 }],
    holes: pars.map((par, i) => ({
      number: i + 1,
      par,
      si: i + 1,
      yardages: { blue: yardages[i]! },
    })),
    totals: { out_total: 35, in_total: 36, course_total: 71 },
  };
}

describe('POST /api/admin/courses', () => {
  it('happy path: organizer POSTs valid payload → 201, all 4 tables populated atomically', async () => {
    const sessionId = await seedSession({ isOrganizer: true });

    const res = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(validCourseRequest()),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; requestId: string };
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);

    // Verify the transaction landed all 4 table rows atomically.
    const courseRows = await db.select().from(courses).where(eq(courses.id, body.id));
    expect(courseRows).toHaveLength(1);
    expect(courseRows[0]!.name).toBe('Test Course');
    expect(courseRows[0]!.clubName).toBe('Test Country Club');
    expect(courseRows[0]!.tenantId).toBe('guyan');
    expect(courseRows[0]!.contextId).toBe('library:guyan');

    const revRows = await db
      .select()
      .from(courseRevisions)
      .where(eq(courseRevisions.courseId, body.id));
    expect(revRows).toHaveLength(1);
    expect(revRows[0]!.revisionNumber).toBe(1);
    expect(revRows[0]!.verified).toBe(true);
    expect(revRows[0]!.outTotal).toBe(35);
    expect(revRows[0]!.inTotal).toBe(36);
    expect(revRows[0]!.courseTotal).toBe(71);
    expect(revRows[0]!.sourceUrl).toBeNull();

    const teeRows = await db
      .select()
      .from(courseTees)
      .where(eq(courseTees.courseRevisionId, revRows[0]!.id));
    expect(teeRows).toHaveLength(1);
    expect(teeRows[0]!.teeColor).toBe('blue');
    // Rating × 10 transform: 72.3 → 723 (per AC #7).
    expect(teeRows[0]!.rating).toBe(723);

    const holeRows = await db
      .select()
      .from(courseHoles)
      .where(eq(courseHoles.courseRevisionId, revRows[0]!.id));
    expect(holeRows).toHaveLength(18);
    // Spot-check first + last + a par-3.
    const sortedHoles = [...holeRows].sort((a, b) => a.holeNumber - b.holeNumber);
    expect(sortedHoles[0]!.par).toBe(4);
    expect(sortedHoles[2]!.par).toBe(3);
    expect(sortedHoles[17]!.par).toBe(5);
    // Yardages JSON round-trips through storage.
    const firstYardages = JSON.parse(sortedHoles[0]!.yardagePerTeeJson) as Record<
      string,
      number
    >;
    expect(firstYardages).toEqual({ blue: 400 });
  });

  it('Zod rejection: par=6 on hole 4 → 400 invalid_body (caught by schema, NOT by validateCourse), no rows written', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const payload = validCourseRequest();
    payload.holes[3]!.par = 6 as 3 | 4 | 5;

    const res = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; issues: unknown[] };
    expect(body.code).toBe('invalid_body');
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);

    // Atomicity: no courses row created.
    const allCourses = await db.select().from(courses);
    expect(allCourses).toHaveLength(0);
  });

  it('T2-4 validation rejection: out_total mismatch → 400 validation_failed, no rows written', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const payload = validCourseRequest();
    // Real out_total is 35; claim 40 → T2-4 rule 14 violation.
    payload.totals.out_total = 40;
    payload.totals.course_total = 76; // keep course_total = out + in to isolate the rule-14 hit

    const res = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; errors: string[] };
    expect(body.code).toBe('validation_failed');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
    // At least one error mentions a totals concept.
    expect(body.errors.some((e) => /total/i.test(e))).toBe(true);

    const allCourses = await db.select().from(courses);
    expect(allCourses).toHaveLength(0);
  });

  it('T2-4 validation rejection: duplicate SI → 400 validation_failed (bijection), no rows written', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const payload = validCourseRequest();
    // Two holes share SI=5 → rule 9 bijection violation.
    payload.holes[0]!.si = 5;
    payload.holes[4]!.si = 5;

    const res = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; errors: string[] };
    expect(body.code).toBe('validation_failed');
    expect(body.errors.some((e) => /si/i.test(e))).toBe(true);

    const allCourses = await db.select().from(courses);
    expect(allCourses).toHaveLength(0);
  });

  it('UNIQUE conflict on (tenant, club, name) → 409 duplicate_course, no second row', async () => {
    const sessionId = await seedSession({ isOrganizer: true });

    // First save succeeds.
    const first = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(validCourseRequest()),
    });
    expect(first.status).toBe(201);

    // Same payload → UNIQUE violation on courses.uniq_courses_tenant_club_name.
    const second = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(validCourseRequest()),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string; code: string };
    expect(body.error).toBe('conflict');
    expect(body.code).toBe('duplicate_course');

    // Still only one course persisted.
    const allCourses = await db.select().from(courses);
    expect(allCourses).toHaveLength(1);
  });

  it('unauthenticated POST → 401 session_missing, no rows written', async () => {
    const res = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validCourseRequest()),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('session_missing');

    const allCourses = await db.select().from(courses);
    expect(allCourses).toHaveLength(0);
  });

  it('non-organizer POST → 403 not_organizer, no rows written', async () => {
    const sessionId = await seedSession({ isOrganizer: false });

    const res = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(validCourseRequest()),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_organizer');

    const allCourses = await db.select().from(courses);
    expect(allCourses).toHaveLength(0);
  });

  it('body > 64 KiB → 400 body_too_large (bodyLimit middleware fires before handler)', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    // Pad name with > 64 KiB of filler. The hono/body-limit middleware
    // reads Content-Length when present; in app.request() with a string
    // body, fetch doesn't auto-set the header, so we set it explicitly.
    // Production browsers always set Content-Length on POSTs, so this is
    // a test-environment-only consideration — the production path is the
    // header-present branch the explicit set models here.
    const payload = { ...validCourseRequest(), name: 'x'.repeat(70_000) };
    const bodyStr = JSON.stringify(payload);

    const res = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: {
        cookie: cookie(sessionId),
        'content-type': 'application/json',
        'content-length': String(bodyStr.length),
      },
      body: bodyStr,
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe('bad_request');
    expect(body.code).toBe('body_too_large');

    const allCourses = await db.select().from(courses);
    expect(allCourses).toHaveLength(0);
  });

  it('source_url with javascript: scheme → 400 invalid_body (Zod refine catches it)', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const payload = {
      ...validCourseRequest(),
      source_url: 'javascript:alert(1)',
    };

    const res = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');

    const allCourses = await db.select().from(courses);
    expect(allCourses).toHaveLength(0);
  });

  it('valid http(s) source_url is persisted to course_revisions.source_url', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const payload = {
      ...validCourseRequest(),
      source_url: 'https://example.com/scorecards/test.pdf',
    };

    const res = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    const revRows = await db
      .select()
      .from(courseRevisions)
      .where(eq(courseRevisions.courseId, body.id));
    expect(revRows[0]!.sourceUrl).toBe('https://example.com/scorecards/test.pdf');
  });

  it('rating=Infinity (becomes null via JSON) → 400 invalid_body, no rows written', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    // JSON.stringify(Infinity) → "null"; Zod's .number() rejects null at the
    // schema layer before .finite() ever runs. The .finite() guard is
    // defense-in-depth for any internal path that bypasses JSON encoding —
    // this test pins the observable behavior (Infinity input → 400).
    const payload = JSON.parse(
      JSON.stringify({
        ...validCourseRequest(),
        tees: [{ color: 'blue', rating: Infinity, slope: 130 }],
      }),
    ) as Record<string, unknown>;

    const res = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');

    const allCourses = await db.select().from(courses);
    expect(allCourses).toHaveLength(0);
  });

  it('whitespace-only name → 400 invalid_body (.trim().min(1) rejects)', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    const payload = { ...validCourseRequest(), name: '   ' };

    const res = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');

    const allCourses = await db.select().from(courses);
    expect(allCourses).toHaveLength(0);
  });

  it('leading/trailing whitespace on name is normalized before UNIQUE check', async () => {
    const sessionId = await seedSession({ isOrganizer: true });

    // First save with trailing whitespace.
    const first = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ ...validCourseRequest(), name: 'Test Course   ' }),
    });
    expect(first.status).toBe(201);

    // Second save with leading whitespace + same trimmed name → UNIQUE
    // conflict because trim() runs at the schema layer before persistence.
    const second = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify({ ...validCourseRequest(), name: '  Test Course' }),
    });
    expect(second.status).toBe(409);

    // Persisted name is the trimmed form.
    const courseRows = await db.select().from(courses);
    expect(courseRows).toHaveLength(1);
    expect(courseRows[0]!.name).toBe('Test Course');
  });

  it('non-UNIQUE DB failure (transaction throws generic Error) → 500 save_failed (NOT 409)', async () => {
    const sessionId = await seedSession({ isOrganizer: true });
    // Force a non-UNIQUE failure by stubbing db.transaction to throw a
    // generic error. Asserts the predicate correctly distinguishes UNIQUE
    // from other DB failures — without this guard, a regression that
    // re-broadens isUniqueConstraintError (e.g., re-adding the
    // SQLITE_CONSTRAINT match) would silently misclassify FK / NOT NULL
    // / CHECK violations as duplicate_course.
    const transactionSpy = vi
      .spyOn(db, 'transaction')
      .mockRejectedValueOnce(new Error('disk full'));

    const res = await testApp.request('/api/admin/courses', {
      method: 'POST',
      headers: { cookie: cookie(sessionId), 'content-type': 'application/json' },
      body: JSON.stringify(validCourseRequest()),
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe('internal');
    expect(body.code).toBe('save_failed');

    transactionSpy.mockRestore();

    // Defense in depth: even though the spy intercepted, no rows landed.
    const allCourses = await db.select().from(courses);
    expect(allCourses).toHaveLength(0);
  });
});
