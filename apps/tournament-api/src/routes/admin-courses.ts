/**
 * Admin-courses router.
 *
 * Routes:
 *   POST /api/admin/courses/parse-pdf  — T2-3/T2-3a: vision parse, no persist.
 *   POST /api/admin/courses            — T2-5: validated transactional save.
 *
 * Both routes share the same middleware spine:
 *   requireSession → requireOrganizer → bodyLimit → handler
 *
 * - Auth BEFORE bodyLimit: anonymous / non-organizer callers are rejected
 *   via header-only reads (cookie check) without consuming any request body,
 *   minimizing DoS surface to authenticated attackers (organizer-only in v1).
 * - parse-pdf bodyLimit: 10 MiB + 64 KiB multipart slack (image / PDF cap).
 *   Mapped 400 `bad_upload`/`file_too_large` via onError.
 * - save bodyLimit: 64 KiB (JSON: 18 holes × ~5 fields + 5 tees + header
 *   ≈ 4 KiB, 16× headroom). Mapped 400 `bad_request`/`body_too_large` via
 *   onError — distinct from parse-pdf's `bad_upload` shape because this is
 *   a JSON POST, not an upload.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { requireOrganizer } from '../middleware/require-organizer.js';
import { requireSession } from '../middleware/require-session.js';
import {
  type ParsedCourse,
  ParserError,
  detectContentKind,
  parseCoursePdf,
} from '../lib/course-parser.js';
import { db } from '../db/index.js';
import {
  courses,
  courseRevisions,
  courseTees,
  courseHoles,
} from '../db/schema/index.js';
import { validateCourse } from '../engine/validators/course.js';

// 10 MiB (strict PDF-file ceiling enforced at the handler-level post-parse
// check). The bodyLimit middleware cap below adds 64 KiB multipart-framing
// slack so a 10 MiB PDF wrapped in multipart headers still passes through.
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const BODY_LIMIT_MAX_BYTES = MAX_PDF_BYTES + 65_536;

// MIME-class allowlist for the soft pre-filter (T2-3a). Magic-byte
// detection is authoritative; this just rejects obvious non-payload MIMEs
// before we waste cycles buffering. HEIC/HEIF/GIF are deliberately
// included so the request reaches `detectContentKind` where we return
// the friendly tailored error codes (`unsupported_mime_heic`/`_gif`).
// Without HEIC/HEIF/GIF in this list those friendly codes would be
// unreachable — the request would be rejected at this stage with a
// generic `wrong_mime`. (Round-1 codex HIGH #1 — preserved as a regression
// hazard via test coverage.)
const ACCEPTED_MIMES = new Set([
  '',                          // some clients omit per-part Content-Type
  'application/pdf',           // T2-3 baseline
  'application/octet-stream',  // de-facto default in many clients
  'image/jpeg',                // T2-3a
  'image/jpg',                 // T2-3a — non-standard alias some clients emit
  'image/png',                 // T2-3a
  'image/webp',                // T2-3a
  'image/heic',                // T2-3a — accepted at MIME stage so magic-byte can return unsupported_mime_heic
  'image/heif',                // T2-3a — same family as HEIC; magic-byte returns unsupported_mime_heic
  'image/gif',                 // T2-3a — accepted at MIME stage so magic-byte can return unsupported_mime_gif
]);

export const adminCoursesRouter = new Hono();

adminCoursesRouter.post(
  '/courses/parse-pdf',
  requireSession,
  requireOrganizer,
  bodyLimit({
    maxSize: BODY_LIMIT_MAX_BYTES,
    onError: (c) => {
      const requestId = c.get('requestId');
      return c.json(
        { error: 'bad_upload', code: 'file_too_large', requestId },
        400,
      );
    },
  }),
  async (c) => {
    const requestId = c.get('requestId');
    const log = c.get('logger');

    // Parse multipart body. Hono's parseBody returns a plain object where
    // file fields are `File` (Web Fetch API) instances.
    const body = await c.req.parseBody({ all: false });
    const pdf = body['pdf'];

    if (!pdf || !(pdf instanceof File)) {
      return c.json(
        { error: 'bad_upload', code: 'missing_file', requestId },
        400,
      );
    }

    // Defense-in-depth size re-check (bodyLimit already rejected
    // oversize bodies, but a runtime / parser quirk could bypass it).
    if (pdf.size > MAX_PDF_BYTES) {
      return c.json(
        { error: 'bad_upload', code: 'file_too_large', requestId },
        400,
      );
    }

    // MIME validation (SOFT pre-filter) — extract full type/subtype,
    // lowercase, trim, and check against ACCEPTED_MIMES. Empty +
    // application/octet-stream tolerated (some clients omit MIME or
    // default to octet-stream). HEIC/HEIF/GIF accepted here so the
    // request reaches `detectContentKind` where it returns the friendly
    // tailored error code rather than generic wrong_mime.
    const mainType = (pdf.type ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!ACCEPTED_MIMES.has(mainType)) {
      return c.json(
        { error: 'bad_upload', code: 'wrong_mime', requestId },
        400,
      );
    }

    // Buffer once. 10 MiB max is bounded by the checks above.
    const bytes = new Uint8Array(await pdf.arrayBuffer());

    // Magic-byte detection (T2-3a) — bytes-only authoritative classifier.
    // Declared MIME from the prior step is NOT re-consulted: if the bytes
    // start with %PDF we parse as PDF regardless of declared MIME, and
    // vice versa. This matches T2-3's posture (broad MIME accept, trust
    // bytes). Discriminator narrowed exhaustively below — TypeScript
    // would fail to compile if a new MagicByteResult variant were added
    // without updating this switch.
    const detected = detectContentKind(bytes);
    let parseKind: { kind: 'pdf' } | { kind: 'image'; mime: 'image/jpeg' | 'image/png' | 'image/webp' };
    let inputKind: 'pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
    switch (detected.kind) {
      case 'pdf':
        parseKind = { kind: 'pdf' };
        inputKind = 'pdf';
        break;
      case 'image':
        parseKind = { kind: 'image', mime: detected.mime };
        inputKind = detected.mime;
        break;
      case 'unsupported_image':
        return c.json(
          {
            error: 'bad_upload',
            code: detected.mime === 'image/heic'
              ? 'unsupported_mime_heic'
              : 'unsupported_mime_gif',
            requestId,
          },
          400,
        );
      case 'mismatch':
        return c.json(
          { error: 'bad_upload', code: 'wrong_magic', requestId },
          400,
        );
    }

    // Invoke parser. Any failure → 503. Sub-codes are logged for
    // operator diagnosis but NOT leaked to the client.
    let parsed: ParsedCourse;
    try {
      parsed = await parseCoursePdf(bytes, parseKind);
    } catch (err) {
      const errorCode =
        err instanceof ParserError ? err.code : 'unknown';
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      // Per AC #8, surface the underlying cause via `toString()` so the
      // operator log captures the SDK error class name + status, not just
      // its `.message`. Stays in logs only — never sent in the HTTP body.
      // Reads `.cause` off any `Error` (not just `ParserError`) so the
      // defense-in-depth path keeps cause context too.
      const causeValue =
        err instanceof Error
          ? (err as Error & { cause?: unknown }).cause
          : undefined;
      const cause = causeValue !== undefined ? String(causeValue) : undefined;
      log.error({
        event: 'vision_parse_failed',
        fileSize: pdf.size,
        errorCode,
        errorMessage,
        ...(cause !== undefined ? { cause } : {}),
      });
      return c.json(
        {
          error: 'parser_unavailable',
          code: 'vision_api_failed',
          requestId,
        },
        503,
      );
    }

    log.info({
      event: 'vision_parse_success',
      fileSize: pdf.size,
      inputKind, // T2-3a: 'pdf' | 'image/jpeg' | 'image/png' | 'image/webp'
      courseName: parsed.name,
      teeCount: parsed.tees.length,
      holeCount: parsed.holes.length,
    });

    return c.json(parsed, 200);
  },
);

// ===========================================================================
// T2-5: POST /api/admin/courses — validated transactional save.
// ===========================================================================

const SAVE_BODY_LIMIT_BYTES = 64 * 1024;
const TENANT_ID = 'guyan';
const LIBRARY_CONTEXT_ID = 'library:guyan';
// libsql UNIQUE-violation sentinels (mirrors auth.ts isUniqueConstraintError).
const SQLITE_UNIQUE_RAW_CODE = 2067;

/**
 * Mirrors `ParsedCourseSchema` from course-parser.ts:191-199 so parse-pdf
 * output is directly POSTable here (snake_case fields throughout). Adds
 * `source_url` as optional + tightens `rating` to `.finite()` so Infinity
 * can't slip past `Math.round(rating * 10)`.
 */
const SaveCourseRequestSchema = z.object({
  // .trim().min(1) — rejects whitespace-only names + normalizes leading
  // and trailing space so two courses that differ only by surrounding
  // whitespace don't bypass the (tenant, club_name, name) UNIQUE.
  name: z.string().trim().min(1),
  club_name: z.string().trim().min(1),
  tees: z
    .array(
      z.object({
        color: z.string().trim().min(1),
        rating: z.number().positive().finite(),
        slope: z.number().int().min(55).max(155),
      }),
    )
    .min(1),
  holes: z
    .array(
      z.object({
        number: z.number().int().min(1).max(18),
        par: z.number().int().min(3).max(5),
        si: z.number().int().min(1).max(18),
        yardages: z.record(z.string(), z.number().int().nonnegative()),
      }),
    )
    .length(18),
  totals: z.object({
    out_total: z.number().int().positive(),
    in_total: z.number().int().positive(),
    course_total: z.number().int().positive(),
  }),
  // Restrict to http(s) — Zod's .url() also accepts javascript:/data:/file:,
  // and source_url is persisted + may be rendered as a clickable link in a
  // future UI. Closing the stored-XSS path at the API boundary.
  source_url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), {
      message: 'source_url must use http or https scheme',
    })
    .optional(),
});

type SaveCourseRequest = z.infer<typeof SaveCourseRequestSchema>;

/**
 * libsql UNIQUE-violation predicate. Mirrors `isUniqueConstraintError` in
 * auth.ts (private — duplicated rather than exported, per the codebase's
 * "no refactor beyond the task" rule). The third consumer should promote
 * this to a shared util.
 *
 * Drizzle 0.45+ wraps libsql driver errors in `DrizzleQueryError` with the
 * original `LibsqlError` on `.cause`; older drizzle bubbles the raw error.
 * Match on either layer + any of the three sentinel fields.
 */
function isUniqueConstraintError(err: unknown): boolean {
  if (matchUniqueSentinel(err)) return true;
  if (err && typeof err === 'object') {
    const cause = (err as { cause?: unknown }).cause;
    if (matchUniqueSentinel(cause)) return true;
  }
  return false;
}

function matchUniqueSentinel(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; extendedCode?: unknown; rawCode?: unknown };
  // UNIQUE-specific sentinels only. The generic 'SQLITE_CONSTRAINT' code
  // also covers FK / NOT NULL / CHECK violations — matching it would
  // misclassify those as duplicate_course (409) instead of the AC #6
  // save_failed (500). Keep this UNIQUE-only.
  return (
    e.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    e.extendedCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
    e.rawCode === SQLITE_UNIQUE_RAW_CODE
  );
}

adminCoursesRouter.post(
  '/courses',
  requireSession,
  requireOrganizer,
  bodyLimit({
    maxSize: SAVE_BODY_LIMIT_BYTES,
    onError: (c) => {
      const requestId = c.get('requestId');
      return c.json(
        { error: 'bad_request', code: 'body_too_large', requestId },
        400,
      );
    },
  }),
  async (c) => {
    const requestId = c.get('requestId');
    const log = c.get('logger');

    // 1. Parse JSON body — wrap in try/catch so a malformed body (truncated
    // upload, wrong content-type) returns the same 400 shape as a Zod miss
    // rather than crashing into Hono's 500 default.
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { error: 'bad_request', code: 'invalid_body', requestId, issues: [] },
        400,
      );
    }

    // 2. Zod parse against SaveCourseRequestSchema.
    const parseResult = SaveCourseRequestSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        {
          error: 'bad_request',
          code: 'invalid_body',
          requestId,
          issues: parseResult.error.issues,
        },
        400,
      );
    }
    const body: SaveCourseRequest = parseResult.data;

    // 3. T2-4 validateCourse — pure function, accepts ParsedCourse-shape
    // input and ignores extras like source_url. Runs BEFORE the DB
    // transaction so a validation miss never opens a tx.
    const validation = validateCourse(body);
    if (!validation.valid) {
      return c.json(
        {
          error: 'bad_request',
          code: 'validation_failed',
          requestId,
          errors: validation.errors,
        },
        400,
      );
    }

    // 4. Transactional persist across courses + course_revisions +
    // course_tees + course_holes. drizzle-orm/libsql auto-rolls-back on
    // any thrown error — UNIQUE conflict, FK violation, or unexpected
    // failure all leave the DB clean.
    const courseId = randomUUID();
    const now = Date.now();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(courses).values({
          id: courseId,
          name: body.name,
          clubName: body.club_name,
          createdAt: now,
          tenantId: TENANT_ID,
          contextId: LIBRARY_CONTEXT_ID,
        });

        const revisionId = randomUUID();
        await tx.insert(courseRevisions).values({
          id: revisionId,
          courseId,
          revisionNumber: 1,
          sourceUrl: body.source_url ?? null,
          extractionDate: now,
          verified: true,
          outTotal: body.totals.out_total,
          inTotal: body.totals.in_total,
          courseTotal: body.totals.course_total,
          createdAt: now,
          tenantId: TENANT_ID,
          contextId: LIBRARY_CONTEXT_ID,
        });

        await tx.insert(courseTees).values(
          body.tees.map((tee) => ({
            id: randomUUID(),
            courseRevisionId: revisionId,
            teeColor: tee.color,
            // Integer × 10 storage discipline (e.g. 72.3 → 723).
            // `.finite()` on the schema guarantees no Infinity here.
            rating: Math.round(tee.rating * 10),
            slope: tee.slope,
            tenantId: TENANT_ID,
            contextId: LIBRARY_CONTEXT_ID,
          })),
        );

        await tx.insert(courseHoles).values(
          body.holes.map((hole) => ({
            id: randomUUID(),
            courseRevisionId: revisionId,
            holeNumber: hole.number,
            par: hole.par,
            si: hole.si,
            yardagePerTeeJson: JSON.stringify(hole.yardages),
            tenantId: TENANT_ID,
            contextId: LIBRARY_CONTEXT_ID,
          })),
        );
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return c.json(
          { error: 'conflict', code: 'duplicate_course', requestId },
          409,
        );
      }
      const e = err as { message?: unknown; cause?: unknown } | null;
      log.error({
        event: 'admin_course_save_failed',
        courseName: body.name,
        clubName: body.club_name,
        message: e?.message ?? null,
        cause: e?.cause ? String(e.cause) : null,
      });
      return c.json(
        { error: 'internal', code: 'save_failed', requestId },
        500,
      );
    }

    log.info({
      event: 'admin_course_saved',
      courseId,
      courseName: body.name,
      clubName: body.club_name,
      teeCount: body.tees.length,
      hasSourceUrl: body.source_url !== undefined,
    });

    return c.json({ id: courseId, requestId }, 201);
  },
);
