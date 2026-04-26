/**
 * Defense-in-depth coverage for the handler-level `pdf.size > 10 MiB` check.
 *
 * Lives in its own file so we can mock `hono/body-limit` to a pass-through
 * middleware WITHOUT affecting the bodyLimit-realism in the sibling
 * `admin-courses.test.ts` suite. The split keeps each test file's mock
 * surface narrow and explicit (vi.mock is hoisted to module scope).
 *
 * AC #12 (file_too_large — post-parse defense-in-depth):
 *   "this test uses a Hono instance with bodyLimit middleware STUBBED ...
 *   + a real 10 MiB + 1 byte upload. Asserts handler's post-parseBody
 *   pdf.size check fires → 400 file_too_large."
 *
 * Regression target: if a future refactor accidentally drops the in-handler
 * size re-check, this test fails. Without it, the belt-and-suspenders layer
 * exists in code but has no test coverage and could rot silently.
 */

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

// In-memory DB (T1-6a pattern) — same shape as admin-courses.test.ts.
vi.mock('../db/index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  return { client, db };
});

// Stub the bodyLimit middleware to a pass-through so the request reaches the
// handler regardless of body size. The handler's own `pdf.size > 10 MiB`
// re-check is what we're asserting fires.
//
// Isolation contract: vitest defaults to file-level module isolation
// (`test.isolate = true`), so this mock does NOT leak into the sibling
// `admin-courses.test.ts` suite which exercises the real bodyLimit.
// See `apps/tournament-api/vitest.config.ts` — no override of `isolate`.
// If isolation is ever turned off, both suites must be re-audited or moved
// to separate vitest projects.
vi.mock('hono/body-limit', () => ({
  bodyLimit: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

// Stub the parser too — it must NOT be invoked when the size check rejects.
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

const testApp = new Hono();
testApp.use('*', requestIdMiddleware);
testApp.route('/api/admin', adminCoursesRouter);

const SESSION_COOKIE = 'tournament_session';
const TENANT_ID = 'guyan';

async function seedOrganizerSession(): Promise<string> {
  const now = Date.now();
  const playerId = randomUUID();
  await db.insert(players).values({
    id: playerId,
    isOrganizer: true,
    createdAt: now,
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

/** 10 MiB + 1 byte PDF — magic-byte present so MIME/magic gates pass. */
function makeOverlimitPdfBytes(): Uint8Array {
  const size = 10 * 1024 * 1024 + 1;
  const bytes = new Uint8Array(new ArrayBuffer(size));
  bytes[0] = 0x25;
  bytes[1] = 0x50;
  bytes[2] = 0x44;
  bytes[3] = 0x46;
  return bytes;
}

function pdfForm(bytes: Uint8Array): FormData {
  const form = new FormData();
  // Cast: bytes is narrowed to ArrayBuffer-backed at construction (see
  // makeOverlimitPdfBytes), but the function return type widens to
  // Uint8Array<ArrayBufferLike>. BlobPart excludes SharedArrayBuffer, so
  // the explicit cast restores the narrower type.
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type: 'application/pdf',
  });
  form.append('pdf', blob, 'card.pdf');
  return form;
}

beforeAll(async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const tempDb = drizzle(client);
  await migrate(tempDb, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(sessions);
  await db.delete(players);
  mockParseCoursePdf.mockReset();
});

describe('admin-courses — defense-in-depth size check (bodyLimit stubbed)', () => {
  it('handler rejects 10 MiB + 1 byte PDF with 400 file_too_large; parser NOT invoked', async () => {
    const sessionId = await seedOrganizerSession();
    const bytes = makeOverlimitPdfBytes();
    expect(bytes.length).toBe(10 * 1024 * 1024 + 1);

    const res = await testApp.request('/api/admin/courses/parse-pdf', {
      method: 'POST',
      headers: { cookie: cookie(sessionId) },
      body: pdfForm(bytes),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('file_too_large');
    expect(body.error).toBe('bad_upload');
    // Critical: the parser must not have been reached.
    expect(mockParseCoursePdf).not.toHaveBeenCalled();
  });
});
