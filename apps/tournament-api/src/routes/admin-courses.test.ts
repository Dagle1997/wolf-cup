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
const { players, sessions } = await import('../db/schema/index.js');
const { adminCoursesRouter } = await import('./admin-courses.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');
const { ParserError } = await import('../lib/course-parser.js');

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
