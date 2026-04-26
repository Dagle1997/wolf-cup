/**
 * T2-3 admin-courses router. Single route: POST /api/admin/courses/parse-pdf.
 *
 * Uploads a scorecard PDF → Anthropic Vision → structured JSON. Output is
 * NOT persisted (T2.5's admin UI persists after human review).
 *
 * Middleware chain (order matters):
 *   requireSession → requireOrganizer → bodyLimit → handler
 *
 * - Auth BEFORE bodyLimit: anonymous / non-organizer callers are rejected
 *   via header-only reads (cookie check) without consuming any request body,
 *   minimizing DoS surface to authenticated attackers (organizer-only in v1).
 * - bodyLimit: 10 MiB + 64 KiB multipart-framing slack. Strict 10 MiB
 *   PDF-file ceiling is enforced by the post-parse handler check —
 *   bodyLimit rejects total body >10.06 MiB so an actual 10 MiB PDF passes
 *   through. The middleware's default 413 is mapped to the route's
 *   consistent 400 `file_too_large` shape via onError.
 */

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireOrganizer } from '../middleware/require-organizer.js';
import { requireSession } from '../middleware/require-session.js';
import {
  type ParsedCourse,
  ParserError,
  parseCoursePdf,
} from '../lib/course-parser.js';

// 10 MiB (strict PDF-file ceiling enforced at the handler-level post-parse
// check). The bodyLimit middleware cap below adds 64 KiB multipart-framing
// slack so a 10 MiB PDF wrapped in multipart headers still passes through.
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const BODY_LIMIT_MAX_BYTES = MAX_PDF_BYTES + 65_536;

// PDF magic bytes: '%PDF' in ASCII = 0x25 0x50 0x44 0x46.
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];

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

    // MIME validation — extract main-type, lowercase, tolerate empty AND
    // `application/octet-stream` (many HTTP clients — curl, FormData in
    // Node/undici — default unspecified file parts to octet-stream). The
    // magic-byte check below is authoritative in those cases.
    const mainType = (pdf.type ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    const mimeIsAcceptable =
      mainType === '' ||
      mainType === 'application/pdf' ||
      mainType === 'application/octet-stream';
    if (!mimeIsAcceptable) {
      return c.json(
        { error: 'bad_upload', code: 'wrong_mime', requestId },
        400,
      );
    }

    // Buffer once. 10 MiB max is bounded by the checks above.
    const bytes = new Uint8Array(await pdf.arrayBuffer());

    // Magic-byte check — always authoritative.
    if (
      bytes.length < 4 ||
      bytes[0] !== PDF_MAGIC[0] ||
      bytes[1] !== PDF_MAGIC[1] ||
      bytes[2] !== PDF_MAGIC[2] ||
      bytes[3] !== PDF_MAGIC[3]
    ) {
      return c.json(
        { error: 'bad_upload', code: 'wrong_magic', requestId },
        400,
      );
    }

    // Invoke parser. Any failure → 503. Sub-codes are logged for
    // operator diagnosis but NOT leaked to the client.
    let parsed: ParsedCourse;
    try {
      parsed = await parseCoursePdf(bytes);
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
      courseName: parsed.name,
      teeCount: parsed.tees.length,
      holeCount: parsed.holes.length,
    });

    return c.json(parsed, 200);
  },
);
